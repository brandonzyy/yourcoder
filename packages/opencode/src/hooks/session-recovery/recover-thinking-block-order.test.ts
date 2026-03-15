import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { join } from "node:path"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import type { MessageData } from "./types"
import { recoverThinkingBlockOrder } from "./recover-thinking-block-order"
import { resetSqliteBackendCache } from "../../config/opencode-storage-detection"
import { resetVersionCache, setVersionCache } from "../../plugin/shared/opencode-version"

const oldFetch = globalThis.fetch
const oldData = process.env.XDG_DATA_HOME
const oldPass = process.env.OPENCODE_SERVER_PASSWORD
const oldUser = process.env.OPENCODE_SERVER_USERNAME

function mk(msgs: MessageData[]) {
  return {
    session: {
      messages: mock(() => Promise.resolve({ data: msgs })),
      _client: {
        getConfig: () => ({ baseUrl: "https://api.example.com" }),
      },
    },
  } as never
}

describe("recoverThinkingBlockOrder", () => {
  let hit: ReturnType<typeof mock>
  let dir = ""

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omo-sqlite-"))
    mkdirSync(join(dir, "opencode"), { recursive: true })
    writeFileSync(join(dir, "opencode", "opencode.db"), "")
    process.env.XDG_DATA_HOME = dir
    setVersionCache("1.1.53")
    resetSqliteBackendCache()
    hit = mock(() => Promise.resolve({ ok: true }))
    globalThis.fetch = hit as never
    process.env.OPENCODE_SERVER_PASSWORD = "secret"
    process.env.OPENCODE_SERVER_USERNAME = "opencode"
  })

  afterEach(() => {
    resetSqliteBackendCache()
    resetVersionCache()
    globalThis.fetch = oldFetch
    if (oldData === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = oldData
    if (oldPass === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
    else process.env.OPENCODE_SERVER_PASSWORD = oldPass
    if (oldUser === undefined) delete process.env.OPENCODE_SERVER_USERNAME
    else process.env.OPENCODE_SERVER_USERNAME = oldUser
    rmSync(dir, { recursive: true, force: true })
  })

  it("prepends prior thinking for the indexed assistant message", async () => {
    const msgs: MessageData[] = [
      {
        info: { id: "msg_prev", role: "assistant" },
        parts: [{ type: "thinking", id: "a", thinking: "prior chain" }],
      },
      {
        info: { id: "msg_bad", role: "assistant" },
        parts: [
          { type: "text", id: "a", text: "answer" },
          { type: "thinking", id: "b", thinking: "late chain" },
        ],
      },
    ]

    const res = await recoverThinkingBlockOrder(
      mk(msgs),
      "ses_1",
      { info: { id: "msg_bad", role: "assistant" }, parts: [] },
      "",
      new Error("messages.1: thinking block must not be the first block"),
    )

    expect(res).toBe(true)
    expect(hit).toHaveBeenCalledWith(
      "https://api.example.com/session/ses_1/message/msg_bad/part/prt_0000000000_msg_bad_thinking",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          id: "prt_0000000000_msg_bad_thinking",
          sessionID: "ses_1",
          messageID: "msg_bad",
          type: "thinking",
          thinking: "prior chain",
          synthetic: true,
        }),
      }),
    )
  })

  it("falls back to orphan messages when no index can be extracted", async () => {
    const msgs: MessageData[] = [
      {
        info: { id: "msg_seed", role: "assistant" },
        parts: [{ type: "thinking", id: "a", thinking: "seed" }],
      },
      {
        info: { id: "msg_one", role: "assistant" },
        parts: [
          { type: "text", id: "a", text: "one" },
          { type: "thinking", id: "b", thinking: "late one" },
        ],
      },
      {
        info: { id: "msg_two", role: "assistant" },
        parts: [{ type: "thinking", id: "a", thinking: "two" }],
      },
      {
        info: { id: "msg_three", role: "assistant" },
        parts: [
          { type: "tool_use", id: "a", name: "read" },
          { type: "thinking", id: "b", thinking: "late three" },
        ],
      },
    ]

    const res = await recoverThinkingBlockOrder(
      mk(msgs),
      "ses_1",
      { info: { id: "msg_three", role: "assistant" }, parts: [] },
      "",
      new Error("thinking ordering failed"),
    )

    expect(res).toBe(true)
    expect(hit).toHaveBeenCalledTimes(2)
    expect(hit.mock.calls[0]?.[0]).toBe(
      "https://api.example.com/session/ses_1/message/msg_one/part/prt_0000000000_msg_one_thinking",
    )
    expect(hit.mock.calls[1]?.[0]).toBe(
      "https://api.example.com/session/ses_1/message/msg_three/part/prt_0000000000_msg_three_thinking",
    )
  })

  it("returns false when sdk history has no repair target", async () => {
    const msgs: MessageData[] = [
      {
        info: { id: "msg_1", role: "assistant" },
        parts: [{ type: "thinking", id: "a", thinking: "ok" }],
      },
    ]

    const res = await recoverThinkingBlockOrder(
      mk(msgs),
      "ses_1",
      { info: { id: "msg_1", role: "assistant" }, parts: [] },
      "",
      new Error("thinking ordering failed"),
    )

    expect(res).toBe(false)
    expect(hit).not.toHaveBeenCalled()
  })
})
