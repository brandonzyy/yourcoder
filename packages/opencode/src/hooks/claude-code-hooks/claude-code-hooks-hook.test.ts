import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { createClaudeCodeHooksHook } from "./claude-code-hooks-hook"
import * as chat from "./handlers/chat-message-handler"
import * as compact from "./handlers/pre-compact-handler"
import * as session from "./handlers/session-event-handler"
import * as after from "./handlers/tool-execute-after-handler"
import * as before from "./handlers/tool-execute-before-handler"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("createClaudeCodeHooksHook", () => {
  it("wires all Claude Code handlers with the provided ctx, config, and context collector", () => {
    const chatHandler = mock(async () => {})
    const compactHandler = mock(async () => {})
    const sessionHandler = mock(async () => {})
    const afterHandler = mock(async () => {})
    const beforeHandler = mock(async () => {})

    add(spyOn(chat, "createChatMessageHandler").mockReturnValue(chatHandler))
    add(spyOn(compact, "createPreCompactHandler").mockReturnValue(compactHandler))
    add(spyOn(session, "createSessionEventHandler").mockReturnValue(sessionHandler))
    add(spyOn(after, "createToolExecuteAfterHandler").mockReturnValue(afterHandler))
    add(spyOn(before, "createToolExecuteBeforeHandler").mockReturnValue(beforeHandler))

    const ctx = { directory: "/tmp/project" } as never
    const cfg = { disabledHooks: ["Stop"] } as never
    const collector = { collect: mock(() => []) } as never

    const hook = createClaudeCodeHooksHook(ctx, cfg, collector)

    expect(hook).toEqual({
      "experimental.session.compacting": compactHandler,
      "chat.message": chatHandler,
      "tool.execute.before": beforeHandler,
      "tool.execute.after": afterHandler,
      event: sessionHandler,
    })
    expect(chat.createChatMessageHandler).toHaveBeenCalledWith(ctx, cfg, collector)
    expect(compact.createPreCompactHandler).toHaveBeenCalledWith(ctx, cfg)
    expect(session.createSessionEventHandler).toHaveBeenCalledWith(ctx, cfg)
    expect(after.createToolExecuteAfterHandler).toHaveBeenCalledWith(ctx, cfg)
    expect(before.createToolExecuteBeforeHandler).toHaveBeenCalledWith(ctx, cfg)
  })

  it("uses an empty config by default", () => {
    add(spyOn(chat, "createChatMessageHandler").mockReturnValue(mock(async () => {}) as never))
    add(spyOn(compact, "createPreCompactHandler").mockReturnValue(mock(async () => {}) as never))
    add(spyOn(session, "createSessionEventHandler").mockReturnValue(mock(async () => {}) as never))
    add(spyOn(after, "createToolExecuteAfterHandler").mockReturnValue(mock(async () => {}) as never))
    add(spyOn(before, "createToolExecuteBeforeHandler").mockReturnValue(mock(async () => {}) as never))

    const ctx = { directory: "/tmp/project" } as never
    createClaudeCodeHooksHook(ctx)

    expect(chat.createChatMessageHandler).toHaveBeenCalledWith(ctx, {}, undefined)
  })
})
