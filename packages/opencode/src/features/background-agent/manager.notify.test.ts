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

type CurrentMessage = {
  agent?: string
  model?: {
    providerID?: string
    modelID?: string
  }
}

describe("BackgroundManager.notifyParentSession - dynamic message lookup", () => {
  test("should skip compaction agent and use nearest non-compaction message", async () => {
    //#given
    let capturedBody: Record<string, unknown> | undefined
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async (args: { body: Record<string, unknown> }) => {
          capturedBody = args.body
          return {}
        },
        abort: async () => ({}),
        messages: async () => ({
          data: [
            {
              info: {
                agent: "sisyphus",
                model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
              },
            },
            {
              info: {
                agent: "compaction",
                model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
              },
            },
          ],
        }),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    const task: BackgroundTask = {
      id: "task-skip-compaction",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task with compaction at tail",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "fallback-agent",
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id, "still-running"]))

    //#when
    await (manager as unknown as { notifyParentSession: (value: BackgroundTask) => Promise<void> }).notifyParentSession(
      task,
    )

    //#then
    expect(capturedBody?.agent).toBe("sisyphus")
    expect(capturedBody?.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })

    manager.shutdown()
  })

  test("should use currentMessage model/agent when available", async () => {
    // given - currentMessage has model and agent
    const task: BackgroundTask = {
      id: "task-1",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task with dynamic lookup",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "OldAgent",
      parentModel: { providerID: "old", modelID: "old-model" },
    }
    const currentMessage: CurrentMessage = {
      agent: "sisyphus",
      model: { providerID: "anthropic", modelID: "claude-opus-4-6" },
    }

    // when
    const promptBody = buildNotificationPromptBody(task, currentMessage)

    // then - uses currentMessage values, not task.parentModel/parentAgent
    expect(promptBody.agent).toBe("sisyphus")
    expect(promptBody.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6" })
  })

  test("should fallback to parentAgent when currentMessage.agent is undefined", async () => {
    // given
    const task: BackgroundTask = {
      id: "task-2",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task fallback agent",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "FallbackAgent",
      parentModel: undefined,
    }
    const currentMessage: CurrentMessage = { agent: undefined, model: undefined }

    // when
    const promptBody = buildNotificationPromptBody(task, currentMessage)

    // then - falls back to task.parentAgent
    expect(promptBody.agent).toBe("FallbackAgent")
    expect("model" in promptBody).toBe(false)
  })

  test("should not pass model when currentMessage.model is incomplete", async () => {
    // given - model missing modelID
    const task: BackgroundTask = {
      id: "task-3",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task incomplete model",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "sisyphus",
      parentModel: { providerID: "anthropic", modelID: "claude-opus" },
    }
    const currentMessage: CurrentMessage = {
      agent: "sisyphus",
      model: { providerID: "anthropic" },
    }

    // when
    const promptBody = buildNotificationPromptBody(task, currentMessage)

    // then - model not passed due to incomplete data
    expect(promptBody.agent).toBe("sisyphus")
    expect("model" in promptBody).toBe(false)
  })

  test("should handle null currentMessage gracefully", async () => {
    // given - no message found (messageDir lookup failed)
    const task: BackgroundTask = {
      id: "task-4",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task no message",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      parentAgent: "sisyphus",
      parentModel: { providerID: "anthropic", modelID: "claude-opus" },
    }

    // when
    const promptBody = buildNotificationPromptBody(task, null)

    // then - falls back to task.parentAgent, no model
    expect(promptBody.agent).toBe("sisyphus")
    expect("model" in promptBody).toBe(false)
  })
})

describe("BackgroundManager.notifyParentSession - aborted parent", () => {
  test("should fall back and still notify when parent session messages are aborted", async () => {
    //#given
    let promptCalled = false
    const promptMock = async () => {
      promptCalled = true
      return {}
    }
    const client = {
      session: {
        prompt: promptMock,
        promptAsync: promptMock,
        abort: async () => ({}),
        messages: async () => {
          const error = new Error("User aborted")
          error.name = "MessageAbortedError"
          throw error
        },
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    const task: BackgroundTask = {
      id: "task-aborted-parent",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task aborted parent",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id, "task-remaining"]))

    //#when
    await (manager as unknown as { notifyParentSession: (task: BackgroundTask) => Promise<void> }).notifyParentSession(
      task,
    )

    //#then
    expect(promptCalled).toBe(true)

    manager.shutdown()
  })

  test("should swallow aborted error from prompt", async () => {
    //#given
    let promptCalled = false
    const promptMock = async () => {
      promptCalled = true
      const error = new Error("User aborted")
      error.name = "MessageAbortedError"
      throw error
    }
    const client = {
      session: {
        prompt: promptMock,
        promptAsync: promptMock,
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    const task: BackgroundTask = {
      id: "task-aborted-prompt",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task aborted prompt",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id]))

    //#when
    await (manager as unknown as { notifyParentSession: (task: BackgroundTask) => Promise<void> }).notifyParentSession(
      task,
    )

    //#then
    expect(promptCalled).toBe(true)

    manager.shutdown()
  })

  test("should queue notification when promptAsync aborts while parent is idle", async () => {
    //#given
    const promptMock = async () => {
      const error = new Error("Request aborted while waiting for input")
      error.name = "MessageAbortedError"
      throw error
    }
    const client = {
      session: {
        prompt: promptMock,
        promptAsync: promptMock,
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
    const task: BackgroundTask = {
      id: "task-aborted-idle-queue",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task idle queue",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id]))

    //#when
    await (manager as unknown as { notifyParentSession: (task: BackgroundTask) => Promise<void> }).notifyParentSession(
      task,
    )

    //#then
    const queuedNotifications = getPendingNotifications(manager).get("session-parent") ?? []
    expect(queuedNotifications).toHaveLength(1)
    expect(queuedNotifications[0]).toContain("<system-reminder>")
    expect(queuedNotifications[0]).toContain("[ALL BACKGROUND TASKS COMPLETE]")

    manager.shutdown()
  })
})

describe("BackgroundManager.notifyParentSession - notifications toggle", () => {
  test("should skip parent prompt injection when notifications are disabled", async () => {
    //#given
    let promptCalled = false
    const promptMock = async () => {
      promptCalled = true
      return {}
    }
    const client = {
      session: {
        prompt: promptMock,
        promptAsync: promptMock,
        abort: async () => ({}),
        messages: async () => ({ data: [] }),
      },
    }
    const manager = new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput, undefined, {
      enableParentSessionNotifications: false,
    })
    const task: BackgroundTask = {
      id: "task-no-parent-notification",
      sessionID: "session-child",
      parentSessionID: "session-parent",
      parentMessageID: "msg-parent",
      description: "task notifications disabled",
      prompt: "test",
      agent: "explore",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
    }
    getPendingByParent(manager).set("session-parent", new Set([task.id]))

    //#when
    await (manager as unknown as { notifyParentSession: (task: BackgroundTask) => Promise<void> }).notifyParentSession(
      task,
    )

    //#then
    expect(promptCalled).toBe(false)

    manager.shutdown()
  })
})

describe("BackgroundManager.injectPendingNotificationsIntoChatMessage", () => {
  test("should prepend queued notifications to first text part and clear queue", () => {
    // given
    const manager = createBackgroundManager()
    manager.queuePendingNotification("session-parent", "<system-reminder>queued-one</system-reminder>")
    manager.queuePendingNotification("session-parent", "<system-reminder>queued-two</system-reminder>")
    const output = {
      parts: [{ type: "text", text: "User prompt" }],
    }

    // when
    manager.injectPendingNotificationsIntoChatMessage(output, "session-parent")

    // then
    expect(output.parts[0].text).toContain("<system-reminder>queued-one</system-reminder>")
    expect(output.parts[0].text).toContain("<system-reminder>queued-two</system-reminder>")
    expect(output.parts[0].text).toContain("User prompt")
    expect(getPendingNotifications(manager).get("session-parent")).toBeUndefined()

    manager.shutdown()
  })
})

function buildNotificationPromptBody(
  task: BackgroundTask,
  currentMessage: CurrentMessage | null,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    parts: [{ type: "text", text: `[BACKGROUND TASK COMPLETED] Task "${task.description}" finished.` }],
  }

  const agent = currentMessage?.agent ?? task.parentAgent
  const model =
    currentMessage?.model?.providerID && currentMessage?.model?.modelID
      ? { providerID: currentMessage.model.providerID, modelID: currentMessage.model.modelID }
      : undefined

  if (agent !== undefined) {
    body.agent = agent
  }
  if (model !== undefined) {
    body.model = model
  }

  return body
}
