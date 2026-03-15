import { afterEach, describe, expect, it, mock } from "bun:test"
import { DEFAULT_CONFIG } from "./constants"
import { createFallbackState } from "./fallback-state"
import { createEventHandler } from "./event-handler"
import { SessionCategoryRegistry } from "../../../session/session-category-registry"

function deps(
  pluginConfig?: Record<string, unknown>,
) {
  return {
    ctx: {
      directory: "/tmp/project",
      client: {
        session: {
          messages: mock(async () => ({ data: [] })),
          promptAsync: mock(async () => ({})),
          abort: mock(async () => ({})),
        },
        tui: {
          showToast: mock(async () => ({})),
        },
      },
    },
    config: { ...DEFAULT_CONFIG, enabled: true },
    options: undefined,
    pluginConfig,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
  } as never
}

function helpers() {
  return {
    abortSessionRequest: mock(async () => {}),
    clearSessionFallbackTimeout: mock(() => {}),
    scheduleSessionFallbackTimeout: mock(() => {}),
    autoRetryWithFallback: mock(async () => {}),
    resolveAgentForSessionFromContext: mock(async (_sid: string, agent?: string) => agent),
    cleanupStaleSessions: mock(() => {}),
  } as never
}

afterEach(() => {
  SessionCategoryRegistry.clear()
})

describe("createEventHandler", () => {
  it("creates state on session.created and clears it on session.deleted", async () => {
    const sid = "ses-life"
    const dep = deps()
    const help = helpers()
    const run = createEventHandler(dep, help)

    await run({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: sid,
            model: "anthropic/claude-sonnet-4",
          },
        },
      },
    })

    expect(dep.sessionStates.get(sid)).toEqual(createFallbackState("anthropic/claude-sonnet-4"))
    expect(dep.sessionLastAccess.has(sid)).toBe(true)

    SessionCategoryRegistry.register(sid, "test")
    dep.sessionRetryInFlight.add(sid)
    dep.sessionAwaitingFallbackResult.add(sid)

    await run({
      event: {
        type: "session.deleted",
        properties: {
          info: {
            id: sid,
          },
        },
      },
    })

    expect(dep.sessionStates.has(sid)).toBe(false)
    expect(dep.sessionLastAccess.has(sid)).toBe(false)
    expect(dep.sessionRetryInFlight.has(sid)).toBe(false)
    expect(dep.sessionAwaitingFallbackResult.has(sid)).toBe(false)
    expect(SessionCategoryRegistry.get(sid)).toBeUndefined()
    expect(help.clearSessionFallbackTimeout).toHaveBeenCalledWith(sid)
  })

  it("aborts fallback retry state on session.stop", async () => {
    const sid = "ses-stop"
    const dep = deps()
    const help = helpers()
    const state = createFallbackState("anthropic/claude-sonnet-4")
    state.pendingFallbackModel = "openai/gpt-5"
    dep.sessionStates.set(sid, state)
    dep.sessionRetryInFlight.add(sid)
    dep.sessionAwaitingFallbackResult.add(sid)

    await createEventHandler(dep, help)({
      event: {
        type: "session.stop",
        properties: {
          sessionID: sid,
        },
      },
    })

    expect(help.clearSessionFallbackTimeout).toHaveBeenCalledWith(sid)
    expect(help.abortSessionRequest).toHaveBeenCalledWith(sid, "session.stop")
    expect(dep.sessionRetryInFlight.has(sid)).toBe(false)
    expect(dep.sessionAwaitingFallbackResult.has(sid)).toBe(false)
    expect(state.pendingFallbackModel).toBeUndefined()
  })

  it("derives the current model from agent config and retries on session.error", async () => {
    const sid = "ses-error"
    const dep = deps({
      agents: {
        sisyphus: {
          model: "openai/gpt-4.1",
          fallback_models: ["anthropic/claude-sonnet-4"],
        },
      },
    })
    const help = helpers()

    await createEventHandler(dep, help)({
      event: {
        type: "session.error",
        properties: {
          sessionID: sid,
          agent: "sisyphus",
          error: {
            statusCode: 429,
            message: "Rate limit exceeded",
          },
        },
      },
    })

    const state = dep.sessionStates.get(sid)

    expect(state).toBeDefined()
    expect(state?.originalModel).toBe("openai/gpt-4.1")
    expect(state?.currentModel).toBe("anthropic/claude-sonnet-4")
    expect(state?.pendingFallbackModel).toBe("anthropic/claude-sonnet-4")
    expect(state?.attemptCount).toBe(1)
    expect(dep.sessionLastAccess.has(sid)).toBe(true)
    expect(help.clearSessionFallbackTimeout).toHaveBeenCalledWith(sid)
    expect(help.autoRetryWithFallback).toHaveBeenCalledWith(
      sid,
      "anthropic/claude-sonnet-4",
      "sisyphus",
      "session.error",
    )
    expect(dep.ctx.client.tui.showToast).toHaveBeenCalled()
  })
})
