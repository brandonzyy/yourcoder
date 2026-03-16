import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { createRuntimeFallbackHook } from "./hook"
import * as cfg from "../../../plugin/plugin-config"
import * as retry from "./auto-retry"
import * as event from "./event-handler"
import * as update from "./message-update-handler"
import * as chat from "./chat-message-handler"
import * as logger from "../../../util/logger"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

function ctx() {
  return {
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
  } as never
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("createRuntimeFallbackHook", () => {
  it("routes message.updated to the update handler and other events to the base handler", async () => {
    const clean = mock(() => {})
    const unref = mock(() => {})
    const base = mock(async () => {})
    const msg = mock(async () => {})
    const chatHandler = mock(async () => {})

    add(spyOn(retry, "createAutoRetryHelpers").mockReturnValue({
      cleanupStaleSessions: clean,
    } as never))
    add(spyOn(event, "createEventHandler").mockReturnValue(base))
    add(spyOn(update, "createMessageUpdateHandler").mockReturnValue(msg))
    add(spyOn(chat, "createChatMessageHandler").mockReturnValue(chatHandler))
    add(spyOn(globalThis, "setInterval").mockReturnValue({ unref } as never))

    const hook = createRuntimeFallbackHook(ctx(), {
      config: { enabled: true },
      pluginConfig: {},
    } as never)

    await hook.event({ event: { type: "message.updated", properties: { id: 1 } } })
    await hook.event({ event: { type: "session.created", properties: { id: 2 } } })
    await hook["chat.message"]?.({ sessionID: "ses_1" } as never, { message: {} } as never)

    expect(msg).toHaveBeenCalledWith({ id: 1 })
    expect(base).toHaveBeenCalledWith({ event: { type: "session.created", properties: { id: 2 } } })
    expect(chatHandler).toHaveBeenCalled()
    expect(clean).not.toHaveBeenCalled()
    expect(unref).toHaveBeenCalled()
  })

  it("skips message.updated when the hook is disabled", async () => {
    const msg = mock(async () => {})

    add(spyOn(retry, "createAutoRetryHelpers").mockReturnValue({
      cleanupStaleSessions: mock(() => {}),
    } as never))
    add(spyOn(event, "createEventHandler").mockReturnValue(mock(async () => {}) as never))
    add(spyOn(update, "createMessageUpdateHandler").mockReturnValue(msg))
    add(spyOn(chat, "createChatMessageHandler").mockReturnValue(mock(async () => {}) as never))
    add(spyOn(globalThis, "setInterval").mockReturnValue({ unref: mock(() => {}) } as never))

    const hook = createRuntimeFallbackHook(ctx(), {
      config: { enabled: false },
      pluginConfig: {},
    } as never)

    await hook.event({ event: { type: "message.updated", properties: { id: 1 } } })

    expect(msg).not.toHaveBeenCalled()
  })

  it("logs and continues when plugin config loading fails", () => {
    const log = mock(() => {})

    add(spyOn(cfg, "loadPluginConfig").mockImplementation(() => {
      throw new Error("boom")
    }))
    add(spyOn(retry, "createAutoRetryHelpers").mockReturnValue({
      cleanupStaleSessions: mock(() => {}),
    } as never))
    add(spyOn(event, "createEventHandler").mockReturnValue(mock(async () => {}) as never))
    add(spyOn(update, "createMessageUpdateHandler").mockReturnValue(mock(async () => {}) as never))
    add(spyOn(chat, "createChatMessageHandler").mockReturnValue(mock(async () => {}) as never))
    add(spyOn(globalThis, "setInterval").mockReturnValue({ unref: mock(() => {}) } as never))
    add(spyOn(logger, "log").mockImplementation(log as never))

    const hook = createRuntimeFallbackHook(ctx())

    expect(hook.event).toBeDefined()
    expect(log).toHaveBeenCalledWith("[runtime-fallback] Plugin config not available")
  })
})
