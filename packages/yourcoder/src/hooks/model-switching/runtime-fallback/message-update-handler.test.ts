import { describe, expect, it, mock } from "bun:test"
import { DEFAULT_CONFIG } from "./constants"
import { createFallbackState } from "./fallback-state"
import { createMessageUpdateHandler, hasVisibleAssistantResponse } from "./message-update-handler"

function deps(
  opts?: Partial<{
    enabled: boolean
    pluginConfig: Record<string, unknown>
    messages: () => Promise<unknown>
  }>,
) {
  const toast = mock(async () => ({}))
  const messages = mock(opts?.messages ?? (async () => ({ data: [] })))
  const dep: Parameters<typeof createMessageUpdateHandler>[0] = {
    ctx: {
      directory: "/tmp/project",
      client: {
        session: {
          messages: messages as never,
          promptAsync: mock(async () => ({})) as never,
          abort: mock(async () => ({})) as never,
        } as unknown as Parameters<typeof createMessageUpdateHandler>[0]["ctx"]["client"]["session"],
        tui: {
          showToast: toast as never,
        } as unknown as Parameters<typeof createMessageUpdateHandler>[0]["ctx"]["client"]["tui"],
      } as unknown as Parameters<typeof createMessageUpdateHandler>[0]["ctx"]["client"],
    } as unknown as Parameters<typeof createMessageUpdateHandler>[0]["ctx"],
    config: { ...DEFAULT_CONFIG, enabled: opts?.enabled ?? true },
    options: undefined,
    pluginConfig: opts?.pluginConfig,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
  }
  return {
    toast,
    messages,
    deps: dep,
  }
}

function helpers() {
  const help: Parameters<typeof createMessageUpdateHandler>[1] = {
    abortSessionRequest: mock(async () => {}),
    clearSessionFallbackTimeout: mock(() => {}),
    scheduleSessionFallbackTimeout: mock(() => {}),
    autoRetryWithFallback: mock(async () => {}),
    resolveAgentForSessionFromContext: mock(async (_sid: string, agent?: string) => agent),
    cleanupStaleSessions: mock(() => {}),
  }
  return help
}

describe("hasVisibleAssistantResponse", () => {
  it("returns true only when the last assistant message has visible text", async () => {
    const env = deps({
      messages: async () => ({
        data: [
          {
            info: { role: "assistant" },
            parts: [{ type: "text", text: "done" }],
          },
        ],
      }),
    })

    const ok = await hasVisibleAssistantResponse(() => undefined)(
      env.deps.ctx,
      "ses-visible",
      undefined,
    )

    expect(ok).toBe(true)
  })
})

describe("createMessageUpdateHandler", () => {
  it("clears pending fallback after a visible assistant response arrives", async () => {
    const sid = "ses-visible-clear"
    const env = deps({
      messages: async () => ({
        data: [
          {
            info: { role: "assistant" },
            parts: [{ type: "text", text: "final answer" }],
          },
        ],
      }),
    })
    const help = helpers()
    const state = createFallbackState("anthropic/claude-sonnet-4")
    state.pendingFallbackModel = "openai/gpt-5"
    env.deps.sessionStates.set(sid, state)
    env.deps.sessionAwaitingFallbackResult.add(sid)

    await createMessageUpdateHandler(env.deps, help)({
      info: {
        sessionID: sid,
        role: "assistant",
        model: "openai/gpt-5",
      },
      parts: [{ type: "text", text: "final answer" }],
    })

    expect(env.deps.sessionAwaitingFallbackResult.has(sid)).toBe(false)
    expect(state.pendingFallbackModel).toBeUndefined()
    expect(help.clearSessionFallbackTimeout).toHaveBeenCalledWith(sid)
    expect(help.autoRetryWithFallback).not.toHaveBeenCalled()
  })

  it("creates fallback state from agent config and retries on retryable assistant errors", async () => {
    const sid = "ses-retryable"
    const env = deps({
      pluginConfig: {
        agents: {
          yac: {
            model: "openai/gpt-4.1",
            fallback_models: ["anthropic/claude-sonnet-4"],
          },
        },
      },
    })
    const help = helpers()

    await createMessageUpdateHandler(env.deps, help)({
      info: {
        sessionID: sid,
        role: "assistant",
        agent: "yc",
        error: {
          statusCode: 429,
          message: "Rate limit exceeded",
        },
      },
    })

    const state = env.deps.sessionStates.get(sid)

    expect(state).toBeDefined()
    expect(state?.originalModel).toBe("openai/gpt-4.1")
    expect(state?.currentModel).toBe("anthropic/claude-sonnet-4")
    expect(state?.pendingFallbackModel).toBe("anthropic/claude-sonnet-4")
    expect(state?.attemptCount).toBe(1)
    expect(env.deps.sessionLastAccess.has(sid)).toBe(true)
    expect(help.clearSessionFallbackTimeout).toHaveBeenCalledWith(sid)
    expect(help.autoRetryWithFallback).toHaveBeenCalledWith(
      sid,
      "anthropic/claude-sonnet-4",
      "yc",
      "message.updated",
    )
    expect(env.toast).toHaveBeenCalled()
  })

  it("skips fallback on non-retryable assistant errors", async () => {
    const sid = "ses-non-retryable"
    const env = deps({
      pluginConfig: {
        agents: {
          yac: {
            model: "openai/gpt-4.1",
            fallback_models: ["anthropic/claude-sonnet-4"],
          },
        },
      },
    })
    const help = helpers()

    await createMessageUpdateHandler(env.deps, help)({
      info: {
        sessionID: sid,
        role: "assistant",
        agent: "yc",
        model: "openai/gpt-4.1",
        error: {
          statusCode: 400,
          message: "Bad request",
        },
      },
    })

    expect(env.deps.sessionStates.has(sid)).toBe(false)
    expect(help.autoRetryWithFallback).not.toHaveBeenCalled()
    expect(env.toast).not.toHaveBeenCalled()
  })
})
