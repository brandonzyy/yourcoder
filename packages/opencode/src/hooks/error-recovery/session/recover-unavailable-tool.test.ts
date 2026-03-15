import { afterEach, beforeEach, describe, it, expect, mock } from "bun:test"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import type { MessageData } from "./types"
import { recoverUnavailableTool } from "./recover-unavailable-tool"
import { resetSqliteBackendCache } from "../../../config/opencode-storage-detection"
import { resetVersionCache, setVersionCache } from "../../../config/opencode-version"
import { PART_STORAGE } from "../../../config/opencode-storage-paths"

function mk(msgs: MessageData[], fail = false) {
  const prompt = mock((arg: unknown) => (fail ? Promise.reject(new Error("boom")) : Promise.resolve(arg)))

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

describe("recoverUnavailableTool", () => {
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

  it("recovers the named unavailable tool from file-backed storage when sqlite is disabled", async () => {
    const messageID = `msg_${randomUUID()}`
    const partDir = join(PART_STORAGE, messageID)

    setVersionCache("1.1.52")
    resetSqliteBackendCache()
    mkdirSync(partDir, { recursive: true })

    try {
      writeFileSync(
        join(partDir, "part.json"),
        JSON.stringify({
          id: "part_1",
          messageID,
          sessionID: "ses_1",
          type: "tool",
          callID: "call_disk",
          tool: "bash",
          state: { status: "pending", input: {} },
        }),
      )

      const { client, prompt } = mk([])
      const res = await recoverUnavailableTool(client, "ses_1", {
        info: {
          id: messageID,
          role: "assistant",
          error: new Error("No such tool: bash"),
        },
        parts: [],
      })

      expect(res).toBe(true)
      expect(prompt).toHaveBeenCalledWith({
        path: { id: "ses_1" },
        body: {
          parts: [
            {
              type: "tool_result",
              tool_use_id: "call_disk",
              content: '{"status":"error","error":"Tool not available. Please continue without this tool."}',
            },
          ],
        },
      })
    } finally {
      rmSync(partDir, { recursive: true, force: true })
    }
  })

  it("repairs the named unavailable tool from sdk history", async () => {
    const msg: MessageData = {
      info: { id: "msg_1", role: "assistant" },
      parts: [
        { type: "tool", callID: "call_bash", name: "Bash" },
        { type: "tool_use", id: "call_read", name: "read" },
      ],
    }
    const { client, prompt } = mk([msg])

    const res = await recoverUnavailableTool(client, "ses_1", {
      info: {
        id: "msg_1",
        role: "assistant",
        error: new Error("No such tool: bash"),
      },
      parts: [],
    })

    expect(res).toBe(true)
    expect(prompt).toHaveBeenCalledWith({
      path: { id: "ses_1" },
      body: {
        parts: [
          {
            type: "tool_result",
            tool_use_id: "call_bash",
            content: '{"status":"error","error":"Tool not available. Please continue without this tool."}',
          },
        ],
      },
    })
  })

  it("falls back to all tool uses when the error does not name one", async () => {
    const msg: MessageData = {
      info: { id: "msg_1", role: "assistant" },
      parts: [
        { type: "tool", callID: "call_a", name: "bash" },
        { type: "tool_use", id: "call_b", name: "read" },
      ],
    }
    const { client, prompt } = mk([msg])

    const res = await recoverUnavailableTool(client, "ses_1", {
      info: { id: "msg_1", role: "assistant", error: new Error("tool runner failed") },
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
            content: '{"status":"error","error":"Tool not available. Please continue without this tool."}',
          },
          {
            type: "tool_result",
            tool_use_id: "call_b",
            content: '{"status":"error","error":"Tool not available. Please continue without this tool."}',
          },
        ],
      },
    })
  })

  it("returns false when sdk history has no tool uses", async () => {
    const msg: MessageData = {
      info: { id: "msg_1", role: "assistant" },
      parts: [{ type: "text", text: "plain text" }],
    }
    const { client, prompt } = mk([msg])

    const res = await recoverUnavailableTool(client, "ses_1", {
      info: { id: "msg_1", role: "assistant", error: new Error("No such tool: bash") },
      parts: [],
    })

    expect(res).toBe(false)
    expect(prompt).not.toHaveBeenCalled()
  })

  it("returns false when prompt injection fails", async () => {
    const msg: MessageData = {
      info: { id: "msg_1", role: "assistant" },
      parts: [{ type: "tool", callID: "call_bash", name: "bash" }],
    }
    const { client } = mk([msg], true)

    const res = await recoverUnavailableTool(client, "ses_1", {
      info: { id: "msg_1", role: "assistant", error: new Error("No such tool: bash") },
      parts: [],
    })

    expect(res).toBe(false)
  })
})
