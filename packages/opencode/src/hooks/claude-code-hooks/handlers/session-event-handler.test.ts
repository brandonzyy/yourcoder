import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { createSessionEventHandler } from "./session-event-handler"
import * as cfg from "../config"
import * as ext from "../config-loader"
import * as stop from "../stop"
import * as disabled from "../../shared/hook-disabled"
import * as shared from "../../../shared"
import { clearSessionHookState, sessionErrorState } from "../session-hook-state"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

afterEach(() => {
  clearSessionHookState("ses_1")
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("createSessionEventHandler", () => {
  it("records session.error state", async () => {
    await createSessionEventHandler({ directory: "/tmp/project", client: {} } as never, {})({
      event: {
        type: "session.error",
        properties: {
          sessionID: "ses_1",
          error: "boom",
        },
      },
    })

    expect(sessionErrorState.get("ses_1")).toEqual({
      hasError: true,
      errorMessage: "boom",
    })
  })

  it("injects a prompt when Stop hooks block with inject_prompt", async () => {
    const prompt = mock(async () => ({}))

    add(spyOn(disabled, "isHookDisabled").mockReturnValue(false))
    add(spyOn(cfg, "loadClaudeHooksConfig").mockResolvedValue({} as never))
    add(spyOn(ext, "loadPluginExtendedConfig").mockResolvedValue({} as never))
    add(spyOn(stop, "executeStopHooks").mockResolvedValue({
      block: true,
      injectPrompt: "continue carefully",
    } as never))
    add(spyOn(shared, "createInternalAgentTextPart").mockReturnValue({ type: "text", text: "continue carefully" } as never))

    await createSessionEventHandler(
      {
        directory: "/tmp/project",
        client: {
          session: {
            get: mock(async () => ({ data: { parentID: "parent_1" } })),
            prompt,
          },
        },
      } as never,
      {},
    )({
      event: {
        type: "session.idle",
        properties: {
          sessionID: "ses_1",
        },
      },
    })

    expect(prompt).toHaveBeenCalledWith({
      path: { id: "ses_1" },
      body: {
        parts: [{ type: "text", text: "continue carefully" }],
      },
      query: { directory: "/tmp/project" },
    })
    expect(sessionErrorState.has("ses_1")).toBe(false)
  })
})
