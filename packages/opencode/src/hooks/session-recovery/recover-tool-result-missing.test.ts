import { afterEach, beforeEach, describe, it, expect, mock } from "bun:test"
import { join } from "node:path"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import type { MessageData } from "./types"
import { recoverToolResultMissing } from "./recover-tool-result-missing"
import { resetSqliteBackendCache } from "../../config/opencode-storage-detection"
import { resetVersionCache, setVersionCache } from "../../shared/opencode-version"

function mk(msgs: MessageData[], fail = false) {
  const prompt = mock((arg: unknown) =>
    fail ? Promise.reject(new Error("boom")) : Promise.resolve(arg)
  )

  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: msgs })),
        promptAsync: prompt,
      },
    } as never,
    prompt,
  }
}

describe("recoverToolResultMissing", () => {
  const oldData = process.env.XDG_DATA_HOME
  let dir = ""

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omo-sqlite-"))
    mkdirSync(join(dir, "opencode"), { recursive: true })
    writeFileSync(join(dir, "opencode", "opencode.db"), "")
    process.env.XDG_DATA_HOME = dir
    setVersionCache("1.1.53")
    resetSqliteBackendCache()
  })

  afterEach(() => {
    resetSqliteBackendCache()
    resetVersionCache()
    if (oldData === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = oldData
    rmSync(dir, { recursive: true, force: true })
  })

  it("injects tool results for each missing tool call from sdk history", async () => {
    const msg: MessageData = {
      info: { id: "msg_1", role: "assistant" },
      parts: [
        { type: "tool", callID: "call_a", name: "bash" },
        { type: "tool_use", id: "call_b", name: "read" },
      ],
    }
    const { client, prompt } = mk([msg])

    const res = await recoverToolResultMissing(client, "ses_1", {
      info: { id: "msg_1", role: "assistant" },
      parts: [],
    })

    expect(res).toBe(true)
    expect(prompt).toHaveBeenCalledWith({
      path: { id: "ses_1" },
      body: {
        parts: [
          {
            type: "tool_result",
            tool_use_id: "call_a",
            content: "Operation cancelled by user (ESC pressed)",
          },
          {
            type: "tool_result",
            tool_use_id: "call_b",
            content: "Operation cancelled by user (ESC pressed)",
          },
        ],
      },
    })
  })

  it("returns false when no tool uses can be recovered", async () => {
    const msg: MessageData = {
      info: { id: "msg_1", role: "assistant" },
      parts: [{ type: "text", text: "done" }],
    }
    const { client, prompt } = mk([msg])

    const res = await recoverToolResultMissing(client, "ses_1", {
      info: { id: "msg_1", role: "assistant" },
      parts: [],
    })

    expect(res).toBe(false)
    expect(prompt).not.toHaveBeenCalled()
  })

  it("returns false when prompt injection fails", async () => {
    const msg: MessageData = {
      info: { id: "msg_1", role: "assistant" },
      parts: [{ type: "tool_use", id: "call_a", name: "bash" }],
    }
    const { client } = mk([msg], true)

    const res = await recoverToolResultMissing(client, "ses_1", {
      info: { id: "msg_1", role: "assistant" },
      parts: [],
    })

    expect(res).toBe(false)
  })
})
