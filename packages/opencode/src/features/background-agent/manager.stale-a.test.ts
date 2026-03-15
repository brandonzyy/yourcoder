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

describe("BackgroundManager.checkAndInterruptStaleTasks", () => {
  test("should NOT interrupt task running less than 30 seconds (min runtime guard)", async () => {
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

    const task: BackgroundTask = {
      id: "task-1",
      sessionID: "session-1",
      parentSessionID: "parent-1",
      parentMessageID: "msg-1",
      description: "Test task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 20_000),
      progress: {
        toolCalls: 0,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    }

    getTaskMap(manager).set(task.id, task)

    await checkAndInterruptStaleTasksForTest(manager)

    expect(task.status).toBe("running")
  })

  test("should NOT interrupt task with recent lastUpdate", async () => {
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

    const task: BackgroundTask = {
      id: "task-2",
      sessionID: "session-2",
      parentSessionID: "parent-2",
      parentMessageID: "msg-2",
      description: "Test task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 60_000),
      progress: {
        toolCalls: 5,
        lastUpdate: new Date(Date.now() - 30_000),
      },
    }

    getTaskMap(manager).set(task.id, task)

    await checkAndInterruptStaleTasksForTest(manager)

    expect(task.status).toBe("running")
  })

  test("should interrupt task with stale lastUpdate (> 3min)", async () => {
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
      id: "task-3",
      sessionID: "session-3",
      parentSessionID: "parent-3",
      parentMessageID: "msg-3",
      description: "Stale task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    }

    getTaskMap(manager).set(task.id, task)

    await checkAndInterruptStaleTasksForTest(manager)

    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
    expect(task.error).toContain("3min")
    expect(task.completedAt).toBeDefined()
  })

  test("should respect custom staleTimeoutMs config", async () => {
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, {
      staleTimeoutMs: 60_000,
    })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-4",
      sessionID: "session-4",
      parentSessionID: "parent-4",
      parentMessageID: "msg-4",
      description: "Custom timeout task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 120_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 90_000),
      },
    }

    getTaskMap(manager).set(task.id, task)

    await checkAndInterruptStaleTasksForTest(manager)

    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  test("should release concurrency before abort", async () => {
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
      id: "task-5",
      sessionID: "session-5",
      parentSessionID: "parent-5",
      parentMessageID: "msg-5",
      description: "Concurrency test",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
      concurrencyKey: "test-agent",
    }

    getTaskMap(manager).set(task.id, task)

    await checkAndInterruptStaleTasksForTest(manager)

    expect(task.concurrencyKey).toBeUndefined()
    expect(task.status).toBe("cancelled")
  })

  test("should handle multiple stale tasks in same poll cycle", async () => {
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

    const task1: BackgroundTask = {
      id: "task-6",
      sessionID: "session-6",
      parentSessionID: "parent-6",
      parentMessageID: "msg-6",
      description: "Stale 1",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    }

    const task2: BackgroundTask = {
      id: "task-7",
      sessionID: "session-7",
      parentSessionID: "parent-7",
      parentMessageID: "msg-7",
      description: "Stale 2",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 400_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 250_000),
      },
    }

    getTaskMap(manager).set(task1.id, task1)
    getTaskMap(manager).set(task2.id, task2)

    await checkAndInterruptStaleTasksForTest(manager)

    expect(task1.status).toBe("cancelled")
    expect(task2.status).toBe("cancelled")
  })

  test("should use default timeout when config not provided", async () => {
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-8",
      sessionID: "session-8",
      parentSessionID: "parent-8",
      parentMessageID: "msg-8",
      description: "Default timeout",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    }

    getTaskMap(manager).set(task.id, task)

    await checkAndInterruptStaleTasksForTest(manager)

    expect(task.status).toBe("cancelled")
  })
})
