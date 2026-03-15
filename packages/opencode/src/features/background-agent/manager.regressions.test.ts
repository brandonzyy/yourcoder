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

describe("BackgroundManager regression fixes - resume and aborted notification", () => {
  test("should keep resumed task in memory after previous completion timer deadline", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)

    const task: BackgroundTask = {
      id: "task-resume-timer-regression",
      sessionID: "session-resume-timer-regression",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "resume timer regression",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      concurrencyGroup: "explore",
    }
    getTaskMap(manager).set(task.id, task)

    const completionTimers = getCompletionTimers(manager)
    const timer = setTimeout(() => {
      completionTimers.delete(task.id)
      getTaskMap(manager).delete(task.id)
    }, 25)
    completionTimers.set(task.id, timer)

    //#when
    await manager.resume({
      sessionId: "session-resume-timer-regression",
      prompt: "resume task",
      parentSessionID: "parent-session-2",
      parentMessageID: "msg-2",
    })
    await new Promise((resolve) => setTimeout(resolve, 60))

    //#then
    expect(getTaskMap(manager).has(task.id)).toBe(true)
    expect(completionTimers.has(task.id)).toBe(false)

    manager.shutdown()
  })

  test("should start cleanup timer even when promptAsync aborts", async () => {
    //#given
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => {
          const error = new Error("User aborted")
          error.name = "MessageAbortedError"
          throw error
        },
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    const task: BackgroundTask = {
      id: "task-aborted-cleanup-regression",
      sessionID: "session-aborted-cleanup-regression",
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "aborted prompt cleanup regression",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionID, new Set([task.id]))

    //#when
    await (manager as unknown as { notifyParentSession: (task: BackgroundTask) => Promise<void> }).notifyParentSession(
      task,
    )

    //#then
    expect(getCompletionTimers(manager).has(task.id)).toBe(true)

    manager.shutdown()
  })
})

describe("BackgroundManager - tool permission spread order", () => {
  test("startTask uses the fixed background tool set", async () => {
    //#given
    let capturedTools: Record<string, unknown> | undefined
    const client = {
      session: {
        get: async () => ({ data: { directory: "/test/dir" } }),
        create: async () => ({ data: { id: "session-1" } }),
        promptAsync: async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          capturedTools = args.body.tools as Record<string, unknown>
          return {}
        },
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    const task: BackgroundTask = {
      id: "task-1",
      status: "pending",
      queuedAt: new Date(),
      description: "test task",
      prompt: "test prompt",
      agent: "manon-explorer",
      parentSessionID: "parent-session",
      parentMessageID: "parent-message",
    }
    const input: import("./types").LaunchInput = {
      description: task.description,
      prompt: task.prompt,
      agent: task.agent,
      parentSessionID: task.parentSessionID,
      parentMessageID: task.parentMessageID,
    }

    //#when
    await (
      manager as unknown as {
        startTask: (item: { task: BackgroundTask; input: import("./types").LaunchInput }) => Promise<void>
      }
    ).startTask({ task, input })

    //#then
    expect(capturedTools).toBeDefined()
    expect(capturedTools?.call_omo_agent).toBe(true)
    expect(capturedTools?.task).toBe(false)
    expect(capturedTools?.question).toBe(false)
    expect(capturedTools?.write).toBeUndefined()
    expect(capturedTools?.edit).toBeUndefined()

    manager.shutdown()
  })

  test("resume uses the fixed background tool set", async () => {
    //#given
    let capturedTools: Record<string, unknown> | undefined
    const client = {
      session: {
        promptAsync: async (args: { path: { id: string }; body: Record<string, unknown> }) => {
          capturedTools = args.body.tools as Record<string, unknown>
          return {}
        },
        abort: async () => ({}),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    const task: BackgroundTask = {
      id: "task-2",
      sessionID: "session-2",
      parentSessionID: "parent-session",
      parentMessageID: "parent-message",
      description: "resume task",
      prompt: "resume prompt",
      agent: "manon-explorer",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getTaskMap(manager).set(task.id, task)

    //#when
    await manager.resume({
      sessionId: "session-2",
      prompt: "continue",
      parentSessionID: "parent-session",
      parentMessageID: "parent-message",
    })

    //#then
    expect(capturedTools).toBeDefined()
    expect(capturedTools?.call_omo_agent).toBe(true)
    expect(capturedTools?.task).toBe(false)
    expect(capturedTools?.question).toBe(false)
    expect(capturedTools?.write).toBeUndefined()
    expect(capturedTools?.edit).toBeUndefined()

    manager.shutdown()
  })
})
