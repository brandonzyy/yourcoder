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

describe("BackgroundManager.shutdown session abort", () => {
  test("should call session.abort for all running tasks during shutdown", () => {
    // given
    const abortedSessionIDs: string[] = []
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async (args: { path: { id: string } }) => {
          abortedSessionIDs.push(args.path.id)
          return {}
        },
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)

    const task1: BackgroundTask = {
      id: "task-1",
      sessionID: "session-1",
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      description: "Running task 1",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(),
    }
    const task2: BackgroundTask = {
      id: "task-2",
      sessionID: "session-2",
      parentSessionID: "parent-2",
      parentMessageID: "msg-2",
      description: "Running task 2",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(),
    }

    getTaskMap(manager).set(task1.id, task1)
    getTaskMap(manager).set(task2.id, task2)

    // when
    manager.shutdown()

    // then
    expect(abortedSessionIDs).toContain("session-1")
    expect(abortedSessionIDs).toContain("session-2")
    expect(abortedSessionIDs).toHaveLength(2)
  })

  test("should not call session.abort for completed or cancelled tasks", () => {
    // given
    const abortedSessionIDs: string[] = []
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async (args: { path: { id: string } }) => {
          abortedSessionIDs.push(args.path.id)
          return {}
        },
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)

    const completedTask: BackgroundTask = {
      id: "task-completed",
      sessionID: "session-completed",
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      description: "Completed task",
      prompt: "Test",
      agent: "test-agent",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    const cancelledTask: BackgroundTask = {
      id: "task-cancelled",
      sessionID: "session-cancelled",
      parentSessionID: "parent-2",
      parentMessageID: "msg-2",
      description: "Cancelled task",
      prompt: "Test",
      agent: "test-agent",
      status: "cancelled",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    const pendingTask: BackgroundTask = {
      id: "task-pending",
      parentSessionID: "parent-3",
      parentMessageID: "msg-3",
      description: "Pending task",
      prompt: "Test",
      agent: "test-agent",
      status: "pending",
      queuedAt: new Date(),
    }

    getTaskMap(manager).set(completedTask.id, completedTask)
    getTaskMap(manager).set(cancelledTask.id, cancelledTask)
    getTaskMap(manager).set(pendingTask.id, pendingTask)

    // when
    manager.shutdown()

    // then
    expect(abortedSessionIDs).toHaveLength(0)
  })

  test("should call onShutdown callback during shutdown", () => {
    // given
    let shutdownCalled = false
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, undefined, {
      onShutdown: () => {
        shutdownCalled = true
      },
    })

    // when
    manager.shutdown()

    // then
    expect(shutdownCalled).toBe(true)
  })

  test("should not throw when onShutdown callback throws", () => {
    // given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, undefined, {
      onShutdown: () => {
        throw new Error("cleanup failed")
      },
    })

    // when / #then
    expect(() => manager.shutdown()).not.toThrow()
  })
})

describe("BackgroundManager.handleEvent - session.deleted cascade", () => {
  test("should cancel descendant tasks when parent session is deleted", () => {
    // given
    const manager = createBackgroundManager()
    const parentSessionID = "session-parent"
    const childTask = createMockTask({
      id: "task-child",
      sessionID: "session-child",
      parentSessionID,
      status: "running",
    })
    const siblingTask = createMockTask({
      id: "task-sibling",
      sessionID: "session-sibling",
      parentSessionID,
      status: "running",
    })
    const grandchildTask = createMockTask({
      id: "task-grandchild",
      sessionID: "session-grandchild",
      parentSessionID: "session-child",
      status: "pending",
      startedAt: undefined,
      queuedAt: new Date(),
    })
    const unrelatedTask = createMockTask({
      id: "task-unrelated",
      sessionID: "session-unrelated",
      parentSessionID: "other-parent",
      status: "running",
    })

    const taskMap = getTaskMap(manager)
    taskMap.set(childTask.id, childTask)
    taskMap.set(siblingTask.id, siblingTask)
    taskMap.set(grandchildTask.id, grandchildTask)
    taskMap.set(unrelatedTask.id, unrelatedTask)

    const pendingByParent = getPendingByParent(manager)
    pendingByParent.set(parentSessionID, new Set([childTask.id, siblingTask.id]))
    pendingByParent.set("session-child", new Set([grandchildTask.id]))

    // when
    manager.handleEvent({
      type: "session.deleted",
      properties: { info: { id: parentSessionID } },
    })

    // then
    expect(taskMap.has(childTask.id)).toBe(false)
    expect(taskMap.has(siblingTask.id)).toBe(false)
    expect(taskMap.has(grandchildTask.id)).toBe(false)
    expect(taskMap.has(unrelatedTask.id)).toBe(true)
    expect(childTask.status).toBe("cancelled")
    expect(siblingTask.status).toBe("cancelled")
    expect(grandchildTask.status).toBe("cancelled")
    expect(pendingByParent.get(parentSessionID)).toBeUndefined()
    expect(pendingByParent.get("session-child")).toBeUndefined()

    manager.shutdown()
  })

  test("should remove tasks from toast manager when session is deleted", () => {
    //#given
    const { removeTaskCalls, resetToastManager } = createToastRemoveTaskTracker()
    const manager = createBackgroundManager()
    const parentSessionID = "session-parent-toast"
    const childTask = createMockTask({
      id: "task-child-toast",
      sessionID: "session-child-toast",
      parentSessionID,
      status: "running",
    })
    const grandchildTask = createMockTask({
      id: "task-grandchild-toast",
      sessionID: "session-grandchild-toast",
      parentSessionID: "session-child-toast",
      status: "pending",
      startedAt: undefined,
      queuedAt: new Date(),
    })
    const taskMap = getTaskMap(manager)
    taskMap.set(childTask.id, childTask)
    taskMap.set(grandchildTask.id, grandchildTask)

    //#when
    manager.handleEvent({
      type: "session.deleted",
      properties: { info: { id: parentSessionID } },
    })

    //#then
    expect(removeTaskCalls).toContain(childTask.id)
    expect(removeTaskCalls).toContain(grandchildTask.id)

    manager.shutdown()
    resetToastManager()
  })

  test("should clean pending notifications for deleted sessions", () => {
    //#given
    const manager = createBackgroundManager()
    const sessionID = "session-pending-notifications"

    manager.queuePendingNotification(sessionID, "<system-reminder>queued</system-reminder>")
    expect(getPendingNotifications(manager).get(sessionID)).toEqual(["<system-reminder>queued</system-reminder>"])

    //#when
    manager.handleEvent({
      type: "session.deleted",
      properties: { info: { id: sessionID } },
    })

    //#then
    expect(getPendingNotifications(manager).has(sessionID)).toBe(false)

    manager.shutdown()
  })
})
