declare const require: (name: string) => any
const { describe, test, expect, beforeEach, afterEach } = require("bun:test")
import {
  BackgroundManager,
  ConcurrencyManager,
  MIN_IDLE_TIME_MS,
  MockBackgroundManager,
  TASK_TTL_MS,
  checkAndInterruptStaleTasksForTest,
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

describe("BackgroundManager.handleEvent - early session.idle deferral", () => {
  test("should defer and retry when session.idle fires before MIN_IDLE_TIME_MS", async () => {
    //#given - a running task started less than MIN_IDLE_TIME_MS ago
    const sessionID = "session-early-idle"
    const messagesCalls: string[] = []
    const realDateNow = Date.now
    const baseNow = realDateNow()

    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async (args: { path: { id: string } }) => {
          messagesCalls.push(args.path.id)
          return {
            data: [
              {
                info: { role: "assistant" },
                parts: [{ type: "text", text: "ok" }],
              },
            ],
          }
        },
        todo: async () => ({ data: [] }),
      },
    }

    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    stubNotifyParentSession(manager)

    const remainingMs = 1200
    const task: BackgroundTask = {
      id: "task-early-idle",
      sessionID,
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "early idle task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(baseNow),
    }

    getTaskMap(manager).set(task.id, task)

    //#when - session.idle fires
    try {
      Date.now = () => baseNow + (MIN_IDLE_TIME_MS - 100)
      manager.handleEvent({ type: "session.idle", properties: { sessionID } })

      // Advance time so deferred callback (if any) sees elapsed >= MIN_IDLE_TIME_MS
      Date.now = () => baseNow + (MIN_IDLE_TIME_MS + 10)

      //#then - idle should be deferred (not dropped), and task should eventually complete
      expect(task.status).toBe("running")
      await new Promise((resolve) => setTimeout(resolve, 220))
      expect(task.status).toBe("completed")
      expect(messagesCalls).toEqual([sessionID])
    } finally {
      Date.now = realDateNow
      manager.shutdown()
    }
  })

  test("should not defer when session.idle fires after MIN_IDLE_TIME_MS", async () => {
    //#given - a running task started more than MIN_IDLE_TIME_MS ago
    const sessionID = "session-late-idle"
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({
          data: [
            {
              info: { role: "assistant" },
              parts: [{ type: "text", text: "ok" }],
            },
          ],
        }),
        todo: async () => ({ data: [] }),
      },
    }

    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-late-idle",
      sessionID,
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "late idle task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - (MIN_IDLE_TIME_MS + 10)),
    }

    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({ type: "session.idle", properties: { sessionID } })

    //#then - should be processed immediately
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(task.status).toBe("completed")

    manager.shutdown()
  })

  test("should not process deferred idle if task already completed by other means", async () => {
    //#given - a running task
    const sessionID = "session-deferred-noop"
    let messagesCallCount = 0
    const realDateNow = Date.now
    const baseNow = realDateNow()

    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
        messages: async () => {
          messagesCallCount += 1
          return {
            data: [
              {
                info: { role: "assistant" },
                parts: [{ type: "text", text: "ok" }],
              },
            ],
          }
        },
        todo: async () => ({ data: [] }),
      },
    }

    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    stubNotifyParentSession(manager)

    const remainingMs = 120
    const task: BackgroundTask = {
      id: "task-deferred-noop",
      sessionID,
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "deferred noop task",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(baseNow),
    }
    getTaskMap(manager).set(task.id, task)

    //#when - session.idle fires early, then task completes via another path before defer timer
    try {
      Date.now = () => baseNow + (MIN_IDLE_TIME_MS - remainingMs)
      manager.handleEvent({ type: "session.idle", properties: { sessionID } })
      expect(messagesCallCount).toBe(0)

      await tryCompleteTaskForTest(manager, task)
      expect(task.status).toBe("completed")

      // Advance time so deferred callback (if any) sees elapsed >= MIN_IDLE_TIME_MS
      Date.now = () => baseNow + (MIN_IDLE_TIME_MS + 10)

      //#then - deferred callback should be a no-op
      await new Promise((resolve) => setTimeout(resolve, remainingMs + 80))
      expect(task.status).toBe("completed")
      expect(messagesCallCount).toBe(0)
    } finally {
      Date.now = realDateNow
      manager.shutdown()
    }
  })
})

describe("BackgroundManager.handleEvent - non-tool event lastUpdate", () => {
  test("should update lastUpdate on text-type message.part.updated event", () => {
    //#given - a running task with stale lastUpdate
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)

    const oldUpdate = new Date(Date.now() - 300_000)
    const task: BackgroundTask = {
      id: "task-text-1",
      sessionID: "session-text-1",
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      description: "Thinking task",
      prompt: "Think deeply",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 600_000),
      progress: {
        toolCalls: 2,
        lastUpdate: oldUpdate,
      },
    }
    getTaskMap(manager).set(task.id, task)

    //#when - a text-type message.part.updated event arrives
    manager.handleEvent({
      type: "message.part.updated",
      properties: { sessionID: "session-text-1", type: "text" },
    })

    //#then - lastUpdate should be refreshed, toolCalls should NOT change
    expect(task.progress!.lastUpdate.getTime()).toBeGreaterThan(oldUpdate.getTime())
    expect(task.progress!.toolCalls).toBe(2)
  })

  test("should update lastUpdate on thinking-type message.part.updated event", () => {
    //#given - a running task with stale lastUpdate
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)

    const oldUpdate = new Date(Date.now() - 300_000)
    const task: BackgroundTask = {
      id: "task-thinking-1",
      sessionID: "session-thinking-1",
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      description: "Reasoning task",
      prompt: "Reason about architecture",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 600_000),
      progress: {
        toolCalls: 0,
        lastUpdate: oldUpdate,
      },
    }
    getTaskMap(manager).set(task.id, task)

    //#when - a thinking-type message.part.updated event arrives
    manager.handleEvent({
      type: "message.part.updated",
      properties: { sessionID: "session-thinking-1", type: "thinking" },
    })

    //#then - lastUpdate should be refreshed, toolCalls should remain 0
    expect(task.progress!.lastUpdate.getTime()).toBeGreaterThan(oldUpdate.getTime())
    expect(task.progress!.toolCalls).toBe(0)
  })

  test("should initialize progress on first non-tool event", () => {
    //#given - a running task with NO progress field
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)

    const task: BackgroundTask = {
      id: "task-init-1",
      sessionID: "session-init-1",
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      description: "New task",
      prompt: "Start thinking",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 60_000),
    }
    getTaskMap(manager).set(task.id, task)

    //#when - a text-type event arrives before any tool call
    manager.handleEvent({
      type: "message.part.updated",
      properties: { sessionID: "session-init-1", type: "text" },
    })

    //#then - progress should be initialized with toolCalls: 0 and fresh lastUpdate
    expect(task.progress).toBeDefined()
    expect(task.progress!.toolCalls).toBe(0)
    expect(task.progress!.lastUpdate.getTime()).toBeGreaterThan(Date.now() - 5000)
  })

  test("should NOT mark thinking model as stale when text events refresh lastUpdate", async () => {
    //#given - a running task where text events keep lastUpdate fresh
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, {
      staleTimeoutMs: 180_000,
    })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-alive-1",
      sessionID: "session-alive-1",
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      description: "Long thinking task",
      prompt: "Deep reasoning",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 600_000),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    }
    getTaskMap(manager).set(task.id, task)

    //#when - a text event arrives, then stale check runs
    manager.handleEvent({
      type: "message.part.updated",
      properties: { sessionID: "session-alive-1", type: "text" },
    })
    await checkAndInterruptStaleTasksForTest(manager)

    //#then - task should still be running (text event refreshed lastUpdate)
    expect(task.status).toBe("running")
  })

  test("should refresh lastUpdate on message.part.delta events (OpenCode >=1.2.0)", async () => {
    //#given - a running task with stale lastUpdate
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, {
      staleTimeoutMs: 180_000,
    })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-delta-1",
      sessionID: "session-delta-1",
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      description: "Reasoning task with delta events",
      prompt: "Extended thinking",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 600_000),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    }
    getTaskMap(manager).set(task.id, task)

    //#when - a message.part.delta event arrives (reasoning-delta or text-delta in OpenCode >=1.2.0)
    manager.handleEvent({
      type: "message.part.delta",
      properties: { sessionID: "session-delta-1", field: "text", delta: "thinking..." },
    })
    await checkAndInterruptStaleTasksForTest(manager)

    //#then - task should still be running (delta event refreshed lastUpdate)
    expect(task.status).toBe("running")
  })
})
