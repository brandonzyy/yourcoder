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

describe("BackgroundManager queue processing - error tasks are skipped", () => {
  test("does not start tasks with status=error", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, {
      defaultConcurrency: 1,
    })

    const key = "test-key"
    const task: BackgroundTask = {
      id: "task-error-queued",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "queued error task",
      prompt: "test",
      agent: "test-agent",
      status: "error",
      queuedAt: new Date(),
    }

    const input: import("./types").LaunchInput = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionID: task.parentSessionID,
      parentMessageID: task.parentMessageID,
    }

    let startCalled = false
    ;(manager as unknown as { startTask: (item: unknown) => Promise<void> }).startTask = async () => {
      startCalled = true
    }

    getTaskMap(manager).set(task.id, task)
    getQueuesByKey(manager).set(key, [{ task, input }])

    //#when
    await processKeyForTest(manager, key)

    //#then
    expect(startCalled).toBe(false)
    expect(getQueuesByKey(manager).get(key)?.length ?? 0).toBe(0)

    manager.shutdown()
  })
})

describe("BackgroundManager.pruneStaleTasksAndNotifications - removes pruned tasks from queuesByKey", () => {
  test("removes stale pending task from queue", () => {
    //#given
    const manager = createBackgroundManager()
    const queuedAt = new Date(Date.now() - 31 * 60 * 1000)
    const task: BackgroundTask = {
      id: "task-stale-pending",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "stale pending",
      prompt: "test",
      agent: "test-agent",
      status: "pending",
      queuedAt,
    }
    const key = task.agent

    const input: import("./types").LaunchInput = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionID: task.parentSessionID,
      parentMessageID: task.parentMessageID,
    }

    getTaskMap(manager).set(task.id, task)
    getQueuesByKey(manager).set(key, [{ task, input }])

    //#when
    pruneStaleTasksAndNotificationsForTest(manager)

    //#then
    expect(getQueuesByKey(manager).get(key)).toBeUndefined()

    manager.shutdown()
  })

  test("removes stale task from toast manager", () => {
    //#given
    const { removeTaskCalls, resetToastManager } = createToastRemoveTaskTracker()
    const manager = createBackgroundManager()
    const staleTask = createMockTask({
      id: "task-stale-toast",
      sessionID: "session-stale-toast",
      parentSessionID: "parent-session",
      status: "running",
      startedAt: new Date(Date.now() - 31 * 60 * 1000),
    })
    getTaskMap(manager).set(staleTask.id, staleTask)

    //#when
    pruneStaleTasksAndNotificationsForTest(manager)

    //#then
    expect(removeTaskCalls).toContain(staleTask.id)

    manager.shutdown()
    resetToastManager()
  })
})

describe("BackgroundManager.completionTimers - Memory Leak Fix", () => {
  function setCompletionTimer(manager: BackgroundManager, taskId: string): void {
    const completionTimers = getCompletionTimers(manager)
    const timer = setTimeout(
      () => {
        completionTimers.delete(taskId)
      },
      5 * 60 * 1000,
    )
    completionTimers.set(taskId, timer)
  }

  test("should have completionTimers Map initialized", () => {
    // given
    const manager = createBackgroundManager()

    // when
    const completionTimers = getCompletionTimers(manager)

    // then
    expect(completionTimers).toBeDefined()
    expect(completionTimers).toBeInstanceOf(Map)
    expect(completionTimers.size).toBe(0)

    manager.shutdown()
  })

  test("should start cleanup timers only after all tasks complete", async () => {
    // given
    const client = {
      session: {
        prompt: async () => ({}),
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    const taskA: BackgroundTask = {
      id: "task-timer-a",
      sessionID: "session-timer-a",
      parentSessionID: "parent-session",
      parentMessageID: "msg-a",
      description: "Task A",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    const taskB: BackgroundTask = {
      id: "task-timer-b",
      sessionID: "session-timer-b",
      parentSessionID: "parent-session",
      parentMessageID: "msg-b",
      description: "Task B",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getTaskMap(manager).set(taskA.id, taskA)
    getTaskMap(manager).set(taskB.id, taskB)
    ;(manager as unknown as { pendingByParent: Map<string, Set<string>> }).pendingByParent.set(
      "parent-session",
      new Set([taskA.id, taskB.id]),
    )

    // when
    await (manager as unknown as { notifyParentSession: (task: BackgroundTask) => Promise<void> }).notifyParentSession(
      taskA,
    )

    // then
    const completionTimers = getCompletionTimers(manager)
    expect(completionTimers.size).toBe(0)

    // when
    await (manager as unknown as { notifyParentSession: (task: BackgroundTask) => Promise<void> }).notifyParentSession(
      taskB,
    )

    // then
    expect(completionTimers.size).toBe(2)
    expect(completionTimers.has(taskA.id)).toBe(true)
    expect(completionTimers.has(taskB.id)).toBe(true)

    manager.shutdown()
  })

  test("should clear all completion timers on shutdown", () => {
    // given
    const manager = createBackgroundManager()
    setCompletionTimer(manager, "task-1")
    setCompletionTimer(manager, "task-2")

    const completionTimers = getCompletionTimers(manager)
    expect(completionTimers.size).toBe(2)

    // when
    manager.shutdown()

    // then
    expect(completionTimers.size).toBe(0)
  })

  test("should cancel timer when task is deleted via session.deleted", () => {
    // given
    const manager = createBackgroundManager()
    const task: BackgroundTask = {
      id: "task-timer-4",
      sessionID: "session-timer-4",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "Test task",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
    }
    getTaskMap(manager).set(task.id, task)
    setCompletionTimer(manager, task.id)

    const completionTimers = getCompletionTimers(manager)
    expect(completionTimers.size).toBe(1)

    // when
    manager.handleEvent({
      type: "session.deleted",
      properties: {
        info: { id: "session-timer-4" },
      },
    })

    // then
    expect(completionTimers.has(task.id)).toBe(false)

    manager.shutdown()
  })

  test("should not leak timers across multiple shutdown calls", () => {
    // given
    const manager = createBackgroundManager()
    setCompletionTimer(manager, "task-1")

    // when
    manager.shutdown()
    manager.shutdown()

    // then
    const completionTimers = getCompletionTimers(manager)
    expect(completionTimers.size).toBe(0)
  })
})
