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
  test("should NOT interrupt task when session is running, even with stale lastUpdate", async () => {
    //#given
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
      id: "task-running-session",
      sessionID: "session-running",
      parentSessionID: "parent-rs",
      parentMessageID: "msg-rs",
      description: "Task with running session",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    }

    getTaskMap(manager).set(task.id, task)

    //#when 鈥?session is actively running
    await checkAndInterruptStaleTasksForTest(manager, { "session-running": { type: "running" } })

    //#then 鈥?task survives because session is running
    expect(task.status).toBe("running")
  })

  test("should interrupt task when session is idle and lastUpdate exceeds stale timeout", async () => {
    //#given
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
      id: "task-idle-session",
      sessionID: "session-idle",
      parentSessionID: "parent-is",
      parentMessageID: "msg-is",
      description: "Task with idle session",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    }

    getTaskMap(manager).set(task.id, task)

    //#when 鈥?session is idle
    await checkAndInterruptStaleTasksForTest(manager, { "session-idle": { type: "idle" } })

    //#then 鈥?killed because session is idle with stale lastUpdate
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  test("should NOT interrupt running session even with very old lastUpdate (no safety net)", async () => {
    //#given
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
      id: "task-long-running",
      sessionID: "session-long",
      parentSessionID: "parent-lr",
      parentMessageID: "msg-lr",
      description: "Long running task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 900_000),
      progress: {
        toolCalls: 5,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    }

    getTaskMap(manager).set(task.id, task)

    //#when 鈥?session is running, lastUpdate 15min old
    await checkAndInterruptStaleTasksForTest(manager, { "session-long": { type: "running" } })

    //#then 鈥?running sessions are NEVER stale-killed
    expect(task.status).toBe("running")
  })

  test("should NOT interrupt running session with no progress (undefined lastUpdate)", async () => {
    //#given 鈥?no progress at all, but session is running
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, {
      messageStalenessTimeoutMs: 600_000,
    })

    const task: BackgroundTask = {
      id: "task-running-no-progress",
      sessionID: "session-rnp",
      parentSessionID: "parent-rnp",
      parentMessageID: "msg-rnp",
      description: "Running no progress",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    }

    getTaskMap(manager).set(task.id, task)

    //#when 鈥?session is running despite no progress
    await checkAndInterruptStaleTasksForTest(manager, { "session-rnp": { type: "running" } })

    //#then 鈥?running sessions are NEVER killed
    expect(task.status).toBe("running")
  })

  test("should interrupt task with no lastUpdate after messageStalenessTimeout", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, {
      messageStalenessTimeoutMs: 600_000,
    })
    stubNotifyParentSession(manager)

    const task: BackgroundTask = {
      id: "task-no-update",
      sessionID: "session-no-update",
      parentSessionID: "parent-nu",
      parentMessageID: "msg-nu",
      description: "No update task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    }

    getTaskMap(manager).set(task.id, task)

    //#when 鈥?no progress update for 15 minutes
    await checkAndInterruptStaleTasksForTest(manager, {})

    //#then 鈥?killed after messageStalenessTimeout
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("no activity")
  })

  test("should NOT interrupt task with no lastUpdate within messageStalenessTimeout", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, {
      messageStalenessTimeoutMs: 600_000,
    })

    const task: BackgroundTask = {
      id: "task-fresh-no-update",
      sessionID: "session-fresh",
      parentSessionID: "parent-fn",
      parentMessageID: "msg-fn",
      description: "Fresh no-update task",
      prompt: "Test",
      agent: "test-agent",
      status: "running",
      startedAt: new Date(Date.now() - 5 * 60 * 1000),
      progress: undefined,
    }

    getTaskMap(manager).set(task.id, task)

    //#when 鈥?only 5 min since start, within 10min timeout
    await checkAndInterruptStaleTasksForTest(manager, {})

    //#then 鈥?task survives
    expect(task.status).toBe("running")
  })
})
