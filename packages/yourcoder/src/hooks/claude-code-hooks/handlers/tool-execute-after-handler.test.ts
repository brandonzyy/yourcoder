import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { createToolExecuteAfterHandler } from "./tool-execute-after-handler"
import * as cfg from "../config"
import * as ext from "../config-loader"
import * as post from "../post-tool-use"
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

describe("createToolExecuteAfterHandler", () => {
  it("appends warnings and messages and shows hook toasts", async () => {
    const showToast = mock(async () => {})
    const append = mock(() => {})

    add(spyOn(cfg, "loadClaudeHooksConfig").mockResolvedValue({} as never))
    add(spyOn(ext, "loadPluginExtendedConfig").mockResolvedValue({} as never))
    add(spyOn(disabled, "isHookDisabled").mockReturnValue(false))
    add(spyOn(cache, "getToolInput").mockReturnValue({ file: "a.ts" } as never))
    add(spyOn(transcript, "appendTranscriptEntry").mockImplementation(append))
    add(spyOn(transcript, "getTranscriptPath").mockReturnValue("/tmp/transcript.jsonl"))
    add(spyOn(post, "executePostToolUseHooks").mockResolvedValue({
      block: true,
      reason: "warning",
      warnings: ["warn-1"],
      message: "extra",
      hookName: "policy",
      toolName: "Read",
      elapsedMs: 8,
    } as never))

    const out = { title: "read", output: "base", metadata: {} }
    await createToolExecuteAfterHandler(
      {
        directory: "/tmp/project",
        client: {
          session: { messages: mock(async () => ({ data: [] })) },
          tui: { showToast },
        },
      } as never,
      {},
    )(
      { tool: "read", sessionID: "ses_1", callID: "call_1" },
      out,
    )

    expect(out.output).toContain("warn-1")
    expect(out.output).toContain("extra")
    expect(append).toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledTimes(2)
  })
})
