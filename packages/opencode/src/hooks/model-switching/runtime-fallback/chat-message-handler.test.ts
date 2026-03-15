import { describe, expect, it, mock } from "bun:test"
import { DEFAULT_CONFIG } from "./constants"
import { createChatMessageHandler } from "./chat-message-handler"
import { createFallbackState } from "./fallback-state"

function deps(enabled = true) {
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
    config: { ...DEFAULT_CONFIG, enabled },
    options: undefined,
    pluginConfig: undefined,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
  } as never
}

describe("createChatMessageHandler", () => {
  it("clears pending fallback when the requested model matches it", async () => {
    const sid = "ses-pending"
    const dep = deps()
    const state = createFallbackState("anthropic/claude-sonnet-4")
    state.pendingFallbackModel = "openai/gpt-5"
    dep.sessionStates.set(sid, state)

    await createChatMessageHandler(dep)(
      {
        sessionID: sid,
        model: {
          providerID: "openai",
          modelID: "gpt-5",
        },
      },
      { message: {} },
    )

    expect(state.pendingFallbackModel).toBeUndefined()
    expect(dep.sessionStates.get(sid)).toBe(state)
    expect(dep.sessionLastAccess.has(sid)).toBe(true)
  })

  it("resets fallback state after a manual model change", async () => {
    const sid = "ses-reset"
    const dep = deps()
    const state = createFallbackState("anthropic/claude-sonnet-4")
    dep.sessionStates.set(sid, state)

    await createChatMessageHandler(dep)(
      {
        sessionID: sid,
        model: {
          providerID: "openai",
          modelID: "gpt-5",
        },
      },
      { message: {} },
    )

    expect(dep.sessionStates.get(sid)).toEqual(createFallbackState("openai/gpt-5"))
    expect(dep.sessionLastAccess.has(sid)).toBe(true)
  })

  it("overrides the outgoing model while a fallback model is active", async () => {
    const sid = "ses-override"
    const dep = deps()
    const state = createFallbackState("anthropic/claude-sonnet-4")
    state.currentModel = "openai/gpt-5/mini"
    dep.sessionStates.set(sid, state)
    const out = { message: {} as { model?: { providerID: string; modelID: string } } }

    await createChatMessageHandler(dep)(
      {
        sessionID: sid,
      },
      out,
    )

    expect(out.message.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5/mini",
    })
  })

  it("does nothing when disabled", async () => {
    const sid = "ses-disabled"
    const dep = deps(false)
    const state = createFallbackState("anthropic/claude-sonnet-4")
    dep.sessionStates.set(sid, state)
    const out = { message: {} as { model?: { providerID: string; modelID: string } } }

    await createChatMessageHandler(dep)(
      {
        sessionID: sid,
        model: {
          providerID: "openai",
          modelID: "gpt-5",
        },
      },
      out,
    )

    expect(dep.sessionLastAccess.has(sid)).toBe(false)
    expect(dep.sessionStates.get(sid)).toBe(state)
    expect(out.message.model).toBeUndefined()
  })
})
