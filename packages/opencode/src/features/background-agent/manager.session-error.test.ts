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

describe("BackgroundManager.handleEvent - session.error", () => {
  const defaultRetryFallbackChain = [
    { providers: ["anthropic"], model: "claude-opus-4-6", variant: "max" },
    { providers: ["anthropic"], model: "gpt-5.3-codex", variant: "high" },
  ]

  const stubProcessKey = (manager: BackgroundManager) => {
    ;(manager as unknown as { processKey: (key: string) => Promise<void> }).processKey = async () => {}
  }

  const createRetryTask = (
    manager: BackgroundManager,
    input: {
      id: string
      sessionID: string
      description: string
      concurrencyKey?: string
      fallbackChain?: typeof defaultRetryFallbackChain
    },
  ) => {
    const task = createMockTask({
      id: input.id,
      sessionID: input.sessionID,
      parentSessionID: "parent-session",
      parentMessageID: "msg-retry",
      description: input.description,
      agent: "sisyphus",
      status: "running",
      concurrencyKey: input.concurrencyKey,
      model: { providerID: "anthropic", modelID: "claude-opus-4-6-thinking" },
      fallbackChain: input.fallbackChain ?? defaultRetryFallbackChain,
      attemptCount: 0,
    })
    getTaskMap(manager).set(task.id, task)
    return task
  }

  test("sets task to error, releases concurrency, and cleans up", async () => {
    //#given
    const manager = createBackgroundManager()
    const concurrencyManager = getConcurrencyManager(manager)
    const concurrencyKey = "test-provider/test-model"
    await concurrencyManager.acquire(concurrencyKey)

    const sessionID = "ses_error_1"
    const task = createMockTask({
      id: "task-session-error",
      sessionID,
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "task that errors",
      agent: "explore",
      status: "running",
      concurrencyKey,
    })
    getTaskMap(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionID, new Set([task.id]))

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID,
        error: {
          name: "UnknownError",
          data: { message: "Model not found: kimi-for-coding/k2p5." },
        },
      },
    })

    //#then
    expect(task.status).toBe("error")
    expect(task.error).toBe("Model not found: kimi-for-coding/k2p5.")
    expect(task.completedAt).toBeInstanceOf(Date)
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)
    expect(getTaskMap(manager).has(task.id)).toBe(false)
    expect(getPendingByParent(manager).get(task.parentSessionID)).toBeUndefined()

    manager.shutdown()
  })

  test("removes errored task from toast manager", () => {
    //#given
    const { removeTaskCalls, resetToastManager } = createToastRemoveTaskTracker()
    const manager = createBackgroundManager()
    const sessionID = "ses_error_toast"
    const task = createMockTask({
      id: "task-session-error-toast",
      sessionID,
      parentSessionID: "parent-session",
      status: "running",
    })
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID,
        error: { name: "UnknownError", message: "boom" },
      },
    })

    //#then
    expect(removeTaskCalls).toContain(task.id)

    manager.shutdown()
    resetToastManager()
  })

  test("ignores session.error for non-running tasks", () => {
    //#given
    const manager = createBackgroundManager()
    const sessionID = "ses_error_ignored"
    const task = createMockTask({
      id: "task-non-running",
      sessionID,
      parentSessionID: "parent-session",
      parentMessageID: "msg-1",
      description: "task already done",
      agent: "explore",
      status: "completed",
    })
    task.completedAt = new Date()
    task.error = "previous"
    getTaskMap(manager).set(task.id, task)

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID,
        error: { name: "UnknownError", message: "should not matter" },
      },
    })

    //#then
    expect(task.status).toBe("completed")
    expect(task.error).toBe("previous")
    expect(getTaskMap(manager).has(task.id)).toBe(true)

    manager.shutdown()
  })

  test("ignores session.error for unknown session", () => {
    //#given
    const manager = createBackgroundManager()

    //#when
    const handler = () =>
      manager.handleEvent({
        type: "session.error",
        properties: {
          sessionID: "ses_unknown",
          error: { name: "UnknownError", message: "Model not found" },
        },
      })

    //#then
    expect(handler).not.toThrow()

    manager.shutdown()
  })

  test("retry path releases current concurrency slot and prefers current provider in fallback entry", async () => {
    //#given
    const manager = createBackgroundManager()
    const concurrencyManager = getConcurrencyManager(manager)
    const concurrencyKey = "anthropic/claude-opus-4-6-thinking"
    await concurrencyManager.acquire(concurrencyKey)

    stubProcessKey(manager)

    const sessionID = "ses_error_retry"
    const task = createRetryTask(manager, {
      id: "task-session-error-retry",
      sessionID,
      description: "task that should retry",
      concurrencyKey,
      fallbackChain: [
        { providers: ["anthropic"], model: "claude-opus-4-6", variant: "max" },
        { providers: ["anthropic"], model: "claude-opus-4-5", variant: "max" },
      ],
    })

    //#when
    manager.handleEvent({
      type: "session.error",
      properties: {
        sessionID,
        error: {
          name: "UnknownError",
          data: {
            message: 'Bad Gateway: {"error":{"message":"unknown provider for model claude-opus-4-6-thinking"}}',
          },
        },
      },
    })

    //#then
    expect(task.status).toBe("pending")
    expect(task.attemptCount).toBe(1)
    expect(task.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      variant: "max",
    })
    expect(task.concurrencyKey).toBeUndefined()
    expect(concurrencyManager.getCount(concurrencyKey)).toBe(0)

    manager.shutdown()
  })

  test("retry path triggers on session.status retry events", async () => {
    //#given
    const manager = createBackgroundManager()
    stubProcessKey(manager)

    const sessionID = "ses_status_retry"
    const task = createRetryTask(manager, {
      id: "task-status-retry",
      sessionID,
      description: "task that should retry on status",
    })

    //#when
    manager.handleEvent({
      type: "session.status",
      properties: {
        sessionID,
        status: {
          type: "retry",
          message: "Provider is overloaded",
        },
      },
    })

    //#then
    expect(task.status).toBe("pending")
    expect(task.attemptCount).toBe(1)
    expect(task.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      variant: "max",
    })

    manager.shutdown()
  })

  test("retry path triggers on message.updated assistant error events", async () => {
    //#given
    const manager = createBackgroundManager()
    stubProcessKey(manager)

    const sessionID = "ses_message_updated_retry"
    const task = createRetryTask(manager, {
      id: "task-message-updated-retry",
      sessionID,
      description: "task that should retry on message.updated",
    })

    //#when
    manager.handleEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg_errored",
          sessionID,
          role: "assistant",
          error: {
            name: "UnknownError",
            data: {
              message: 'Bad Gateway: {"error":{"message":"unknown provider for model claude-opus-4-6-thinking"}}',
            },
          },
        },
      },
    } as never)

    //#then
    expect(task.status).toBe("pending")
    expect(task.attemptCount).toBe(1)
    expect(task.model).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-6",
      variant: "max",
    })

    manager.shutdown()
  })
})
