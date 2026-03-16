import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { createToolExecuteBeforeHandler } from "./tool-execute-before-handler"
import * as cfg from "../config"
import * as ext from "../config-loader"
import * as pre from "../pre-tool-use"
import * as transcript from "../transcript"
import * as cache from "../tool-input-cache"
import * as disabled from "../../shared/hook-disabled"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("createToolExecuteBeforeHandler", () => {
  it("parses todowrite todos, caches input, and applies hook modifications", async () => {
    const append = mock(() => {})
    const save = mock(() => {})

    add(spyOn(cfg, "loadClaudeHooksConfig").mockResolvedValue({} as never))
    add(spyOn(ext, "loadPluginExtendedConfig").mockResolvedValue({} as never))
    add(spyOn(disabled, "isHookDisabled").mockReturnValue(false))
    add(spyOn(transcript, "appendTranscriptEntry").mockImplementation(append))
    add(spyOn(cache, "cacheToolInput").mockImplementation(save))
    add(spyOn(pre, "executePreToolUseHooks").mockResolvedValue({
      decision: "allow",
      modifiedInput: { extra: true },
    } as never))

    const out = {
      args: {
        todos: '[{"id":"1","content":"x","status":"pending"}]',
      } as Record<string, unknown>,
    }

    await createToolExecuteBeforeHandler(
      { directory: "/tmp/project", client: { tui: { showToast: mock(async () => {}) } } } as never,
      {},
    )(
      { tool: "todowrite", sessionID: "ses_1", callID: "call_1" },
      out,
    )

    expect(out.args.todos).toEqual([{ id: "1", content: "x", status: "pending" }])
    expect(out.args.extra).toBe(true)
    expect(append).toHaveBeenCalled()
    expect(save).toHaveBeenCalledWith("ses_1", "todowrite", "call_1", out.args)
  })

  it("throws when a pre-tool hook denies execution", async () => {
    const showToast = mock(async () => {})

    add(spyOn(cfg, "loadClaudeHooksConfig").mockResolvedValue({} as never))
    add(spyOn(ext, "loadPluginExtendedConfig").mockResolvedValue({} as never))
    add(spyOn(disabled, "isHookDisabled").mockReturnValue(false))
    add(spyOn(transcript, "appendTranscriptEntry").mockImplementation(mock(() => {}) as never))
    add(spyOn(cache, "cacheToolInput").mockImplementation(mock(() => {}) as never))
    add(spyOn(pre, "executePreToolUseHooks").mockResolvedValue({
      decision: "deny",
      reason: "blocked",
      hookName: "policy",
      toolName: "Read",
      elapsedMs: 12,
      inputLines: "  file: a.ts",
    } as never))

    const run = createToolExecuteBeforeHandler(
      { directory: "/tmp/project", client: { tui: { showToast } } } as never,
      {},
    )

    await expect(
      run(
        { tool: "read", sessionID: "ses_1", callID: "call_1" },
        { args: { file: "a.ts" } },
      ),
    ).rejects.toThrow("blocked")

    expect(showToast).toHaveBeenCalled()
  })
})
