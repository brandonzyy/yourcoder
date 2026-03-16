declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
import {
  BackgroundManager,
  ConcurrencyManager,
  MIN_IDLE_TIME_MS,
  MockBackgroundManager,
  TASK_TTL_MS,
  createBackgroundManager,
  createMockTask,
  createToastRemoveTaskTracker,
  getCleanupSignals,
  getCompletionTimers,
  getConcurrencyManager,
  getListenerCounts,
  getPendingByParent,
  getPendingNotifications,
  getQueuesByKey,
  getTaskMap,
  processKeyForTest,
  pruneStaleTasksAndNotificationsForTest,
  resetProcessCleanup,
  stubNotifyParentSession,
  tmpdir,
  tryCompleteTaskForTest,
  type BackgroundTask,
  type LaunchInput,
  type PluginInput,
  type ResumeInput,
} from "./manager.test.helpers"

describe("BackgroundManager.tryCompleteTask", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    // given
    manager = createBackgroundManager()
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("should release concurrency and clear key on completion", async () => {
    // given
    const concurrencyKey = "anthropic/claude-opus-4-6"
    const concurrencyManager = getConcurrencyManager(manager)
    await concurrencyManager.acquire(concurrencyKey)

    const task: BackgroundTask = {
      id: "task-1",
      sessionID: "session-1",
      parentSessionID: "session-parent",
      parentMessageID: "msg-1",
      description: "test task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
      concurrencyKey,
    }

    // when
    const completed = await tryCompleteTaskForTest(manager, task)

    // then
    expect(completed).toBe(true)
    expect(task.status).toBe("completed")
    expect(task.concurrencyKey).toBeUndefined()
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)
  })

  test("should prevent double completion and double release", async () => {
    // given
    const concurrencyKey = "anthropic/claude-opus-4-6"
    const concurrencyManager = getConcurrencyManager(manager)
    await concurrencyManager.acquire(concurrencyKey)

    const task: BackgroundTask = {
      id: "task-1",
      sessionID: "session-1",
      parentSessionID: "session-parent",
      parentMessageID: "msg-1",
      description: "test task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
      concurrencyKey,
    }

    // when
    await tryCompleteTaskForTest(manager, task)
    const secondAttempt = await tryCompleteTaskForTest(manager, task)

    // then
    expect(secondAttempt).toBe(false)
    expect(task.status).toBe("completed")
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)
  })

  test("should abort session on completion", async () => {
    // #given
    const abortedSessionIDs: string[] = []
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async (args: { path: { id: string } }) => {
          abortedSessionIDs.push(args.path.id)
          return {}
        },
        messages: async () => ({ data: [] }),
      },
    }
    manager.shutdown()
    manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-1",
      sessionID: "session-1",
      parentSessionID: "session-parent",
      parentMessageID: "msg-1",
      description: "test task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
    }

    // #when
    await tryCompleteTaskForTest(manager, task)

    // #then
    expect(abortedSessionIDs).toEqual(["session-1"])
  })

  test("should clean pendingByParent even when notifyParentSession throws", async () => {
    // given
    ;(manager as unknown as { notifyParentSession: () => Promise<void> }).notifyParentSession = async () => {
      throw new Error("notify failed")
    }

    const task: BackgroundTask = {
      id: "task-pending-cleanup",
      sessionID: "session-pending-cleanup",
      parentSessionID: "parent-pending-cleanup",
      parentMessageID: "msg-1",
      description: "pending cleanup task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
    }
    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionID, new Set([task.id]))

    // when
    await tryCompleteTaskForTest(manager, task)

    // then
    expect(task.status).toBe("completed")
    expect(getPendingByParent(manager).get(task.parentSessionID)).toBeUndefined()
  })

  test("should avoid overlapping promptAsync calls when tasks complete concurrently", async () => {
    // given
    type PromptAsyncBody = Record<string, unknown> & { noReply?: boolean }

    let resolveMessages: ((value: { data: unknown[] }) => void) | undefined
    const messagesBarrier = new Promise<{ data: unknown[] }>((resolve) => {
      resolveMessages = resolve
    })

    const promptBodies: PromptAsyncBody[] = []
    let promptInFlight = false
    let rejectedCount = 0
    let promptCallCount = 0

    let releaseFirstPrompt: (() => void) | undefined
    let resolveFirstStarted: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => {
      resolveFirstStarted = resolve
    })

    const client = {
      session: {
        prompt: async () => ({}),
        abort: async () => ({}),
        messages: async () => messagesBarrier,
        promptAsync: async (args: { path: { id: string }; body: PromptAsyncBody }) => {
          promptBodies.push(args.body)

          if (!promptInFlight) {
            promptCallCount += 1
            if (promptCallCount === 1) {
              promptInFlight = true
              resolveFirstStarted?.()
              return await new Promise((resolve) => {
                releaseFirstPrompt = () => {
                  promptInFlight = false
                  resolve({})
                }
              })
            }

            return {}
          }

          rejectedCount += 1
          throw new Error("BUSY")
        },
      },
    }

    manager.shutdown()
    manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)

    const parentSessionID = "parent-session"
    const taskA = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID,
    })
    const taskB = createMockTask({
      id: "task-b",
      sessionID: "session-b",
      parentSessionID,
    })

    getTaskMap(manager).set(taskA.id, taskA)
    getTaskMap(manager).set(taskB.id, taskB)
    getPendingByParent(manager).set(parentSessionID, new Set([taskA.id, taskB.id]))

    // when
    const completionA = tryCompleteTaskForTest(manager, taskA)
    const completionB = tryCompleteTaskForTest(manager, taskB)
    resolveMessages?.({ data: [] })

    await firstStarted

    // Give the second completion a chance to attempt promptAsync while the first is in-flight.
    // In the buggy implementation, this triggers an overlap and increments rejectedCount.
    for (let i = 0; i < 20; i++) {
      await Promise.resolve()
      if (rejectedCount > 0) break
      if (promptBodies.length >= 2) break
    }

    releaseFirstPrompt?.()
    await Promise.all([completionA, completionB])

    // then
    expect(rejectedCount).toBe(0)
    expect(promptBodies.length).toBe(2)
    expect(promptBodies.some((b) => b.noReply === false)).toBe(true)
  })
})

describe("BackgroundManager.trackTask", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    // given
    manager = createBackgroundManager()
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("should not double acquire on duplicate registration", async () => {
    // given
    const input = {
      taskId: "task-1",
      sessionID: "session-1",
      parentSessionID: "parent-session",
      description: "external task",
      agent: "task",
      concurrencyKey: "external-key",
    }

    // when
    await manager.trackTask(input)
    await manager.trackTask(input)

    // then
    const concurrencyManager = getConcurrencyManager(manager)
    expect(concurrencyManager.getCount("external-key")).toBe(1)
    expect(getTaskMap(manager).size).toBe(1)
  })
})

describe("BackgroundManager.resume concurrency key", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    // given
    manager = createBackgroundManager()
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("should re-acquire using external task concurrency key", async () => {
    // given
    const task = await manager.trackTask({
      taskId: "task-1",
      sessionID: "session-1",
      parentSessionID: "parent-session",
      description: "external task",
      agent: "task",
      concurrencyKey: "external-key",
    })

    await tryCompleteTaskForTest(manager, task)

    // when
    await manager.resume({
      sessionId: "session-1",
      prompt: "resume",
      parentSessionID: "parent-session-2",
      parentMessageID: "msg-2",
    })

    // then
    const concurrencyManager = getConcurrencyManager(manager)
    expect(concurrencyManager.getCount("external-key")).toBe(1)
    expect(task.concurrencyKey).toBe("external-key")
  })
})

describe("BackgroundManager.resume model persistence", () => {
  let manager: BackgroundManager
  let promptCalls: Array<{ path: { id: string }; body: Record<string, unknown> }>

  beforeEach(() => {
    // given
    promptCalls = []
    const promptMock = async (args: { path: { id: string }; body: Record<string, unknown> }) => {
      promptCalls.push(args)
      return {}
    }
    const client = {
      session: {
        prompt: promptMock,
        promptAsync: promptMock,
        abort: async () => ({}),
      },
    }
    manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    stubNotifyParentSession(manager)
  })

  afterEach(() => {
    manager.shutdown()
  })

  test("should pass model when task has a configured model", async () => {
    // given - task with model from category config
    const taskWithModel: BackgroundTask = {
      id: "task-with-model",
      sessionID: "session-1",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "task with model override",
      prompt: "original prompt",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" },
      concurrencyGroup: "explore",
    }
    getTaskMap(manager).set(taskWithModel.id, taskWithModel)

    // when
    await manager.resume({
      sessionId: "session-1",
      prompt: "continue the work",
      parentSessionID: "parent-session-2",
      parentMessageID: "msg-2",
    })

    // then - model should be passed in prompt body
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0].body.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-4-20250514" })
    expect(promptCalls[0].body.agent).toBe("explore")
  })

  test("should NOT pass model when task has no model (backward compatibility)", async () => {
    // given - task without model (default behavior)
    const taskWithoutModel: BackgroundTask = {
      id: "task-no-model",
      sessionID: "session-2",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "task without model",
      prompt: "original prompt",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      concurrencyGroup: "explore",
    }
    getTaskMap(manager).set(taskWithoutModel.id, taskWithoutModel)

    // when
    await manager.resume({
      sessionId: "session-2",
      prompt: "continue the work",
      parentSessionID: "parent-session-2",
      parentMessageID: "msg-2",
    })

    // then - model should NOT be in prompt body
    expect(promptCalls).toHaveLength(1)
    expect("model" in promptCalls[0].body).toBe(false)
    expect(promptCalls[0].body.agent).toBe("explore")
  })
})

describe("BackgroundManager process cleanup", () => {
  test("should remove listeners after last shutdown", () => {
    // given
    resetProcessCleanup()
    const signals = getCleanupSignals()
    const baseline = getListenerCounts(signals)
    const managerA = createBackgroundManager()
    const managerB = createBackgroundManager()

    // when
    const afterCreate = getListenerCounts(signals)
    managerA.shutdown()
    const afterFirstShutdown = getListenerCounts(signals)
    managerB.shutdown()
    const afterSecondShutdown = getListenerCounts(signals)

    // then
    for (const signal of signals) {
      expect(afterCreate[signal]).toBe(baseline[signal] + 1)
      expect(afterFirstShutdown[signal]).toBe(baseline[signal] + 1)
      expect(afterSecondShutdown[signal]).toBe(baseline[signal])
    }
    resetProcessCleanup()
  })
})
