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

describe("BackgroundManager.resume", () => {
  let manager: MockBackgroundManager

  beforeEach(() => {
    // given
    manager = new MockBackgroundManager()
  })

  test("should throw error when task not found", () => {
    // given - empty manager

    // when / #then
    expect(() =>
      manager.resume({
        sessionId: "non-existent",
        prompt: "continue",
        parentSessionID: "session-new",
        parentMessageID: "msg-new",
      }),
    ).toThrow("Task not found for session: non-existent")
  })

  test("should resume existing task and reset state to running", () => {
    // given
    const completedTask = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "completed",
    })
    completedTask.completedAt = new Date()
    completedTask.error = "previous error"
    manager.addTask(completedTask)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "continue the work",
      parentSessionID: "session-new-parent",
      parentMessageID: "msg-new",
    })

    // then
    expect(result.status).toBe("running")
    expect(result.completedAt).toBeUndefined()
    expect(result.error).toBeUndefined()
    expect(result.parentSessionID).toBe("session-new-parent")
    expect(result.parentMessageID).toBe("msg-new")
  })

  test("should preserve task identity while updating parent context", () => {
    // given
    const existingTask = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "old-parent",
      description: "original description",
      agent: "explore",
      status: "completed",
    })
    manager.addTask(existingTask)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "new prompt",
      parentSessionID: "new-parent",
      parentMessageID: "new-msg",
      parentModel: { providerID: "anthropic", modelID: "claude-opus" },
    })

    // then
    expect(result.id).toBe("task-a")
    expect(result.sessionID).toBe("session-a")
    expect(result.description).toBe("original description")
    expect(result.agent).toBe("explore")
    expect(result.parentModel).toEqual({ providerID: "anthropic", modelID: "claude-opus" })
  })

  test("should track resume calls with prompt", () => {
    // given
    const task = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "completed",
    })
    manager.addTask(task)

    // when
    manager.resume({
      sessionId: "session-a",
      prompt: "continue with additional context",
      parentSessionID: "session-new",
      parentMessageID: "msg-new",
    })

    // then
    expect(manager.resumeCalls).toHaveLength(1)
    expect(manager.resumeCalls[0]).toEqual({
      sessionId: "session-a",
      prompt: "continue with additional context",
    })
  })

  test("should preserve existing tool call count in progress", () => {
    // given
    const taskWithProgress = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "completed",
    })
    taskWithProgress.progress = {
      toolCalls: 42,
      lastTool: "read",
      lastUpdate: new Date(),
    }
    manager.addTask(taskWithProgress)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "continue",
      parentSessionID: "session-new",
      parentMessageID: "msg-new",
    })

    // then
    expect(result.progress?.toolCalls).toBe(42)
  })

  test("should ignore resume when task is already running", () => {
    // given
    const runningTask = createMockTask({
      id: "task-a",
      sessionID: "session-a",
      parentSessionID: "session-parent",
      status: "running",
    })
    manager.addTask(runningTask)

    // when
    const result = manager.resume({
      sessionId: "session-a",
      prompt: "resume should be ignored",
      parentSessionID: "new-parent",
      parentMessageID: "new-msg",
    })

    // then
    expect(result.parentSessionID).toBe("session-parent")
    expect(manager.resumeCalls).toHaveLength(0)
  })
})

describe("LaunchInput.skillContent", () => {
  test("skillContent should be optional in LaunchInput type", () => {
    // given
    const input: import("./types").LaunchInput = {
      description: "test",
      prompt: "test prompt",
      agent: "explore",
      parentSessionID: "parent-session",
      parentMessageID: "parent-msg",
    }

    // when / #then - should compile without skillContent
    expect(input.skillContent).toBeUndefined()
  })

  test("skillContent can be provided in LaunchInput", () => {
    // given
    const input: import("./types").LaunchInput = {
      description: "test",
      prompt: "test prompt",
      agent: "explore",
      parentSessionID: "parent-session",
      parentMessageID: "parent-msg",
      skillContent: "You are a playwright expert",
    }

    // when / #then
    expect(input.skillContent).toBe("You are a playwright expert")
  })
})

interface CurrentMessage {
  agent?: string
  model?: { providerID?: string; modelID?: string }
}
