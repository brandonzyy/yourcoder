import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import type { MessageData } from "./types"
import { recoverThinkingBlockOrder } from "./recover-thinking-block-order"
import { resetSqliteBackendCache } from "../../config/opencode-storage-detection"
import { resetVersionCache, setVersionCache } from "../../config/opencode-version"
import { MESSAGE_STORAGE, PART_STORAGE } from "../../config/opencode-storage-paths"

const oldFetch = globalThis.fetch
const oldData = process.env.XDG_DATA_HOME
const oldPass = process.env.YC_SERVER_PASSWORD
const oldUser = process.env.YC_SERVER_USERNAME

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
    process.env.YC_SERVER_PASSWORD = "secret"
    process.env.YC_SERVER_USERNAME = "opencode"
  })

  afterEach(() => {
    resetSqliteBackendCache()
    resetVersionCache()
    globalThis.fetch = oldFetch
    if (oldData === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = oldData
    if (oldPass === undefined) delete process.env.YC_SERVER_PASSWORD
    else process.env.YC_SERVER_PASSWORD = oldPass
    if (oldUser === undefined) delete process.env.YC_SERVER_USERNAME
    else process.env.YC_SERVER_USERNAME = oldUser
    rmSync(dir, { recursive: true, force: true })
  })

  it("uses file-backed part order and latest prior thinking when sqlite is disabled", async () => {
    const sessionID = `ses_${randomUUID()}`
    const prevID = `msg_${randomUUID()}`
    const badID = `msg_${randomUUID()}`
    const msgDir = join(MESSAGE_STORAGE, sessionID)
    const prevDir = join(PART_STORAGE, prevID)
    const badDir = join(PART_STORAGE, badID)

    setVersionCache("1.1.52")
    resetSqliteBackendCache()

    mkdirSync(msgDir, { recursive: true })
    mkdirSync(prevDir, { recursive: true })
    mkdirSync(badDir, { recursive: true })

    try {
      writeFileSync(
        join(msgDir, `${prevID}.json`),
        JSON.stringify({ id: prevID, sessionID, role: "assistant", time: { created: 1 } }),
      )
      writeFileSync(
        join(msgDir, `${badID}.json`),
        JSON.stringify({ id: badID, sessionID, role: "assistant", time: { created: 2 } }),
      )

      writeFileSync(
        join(prevDir, "z_old.json"),
        JSON.stringify({
          id: "z_old",
          sessionID,
          messageID: prevID,
          type: "thinking",
          thinking: "old chain",
          time: { start: 10 },
        }),
      )
      writeFileSync(
        join(prevDir, "a_new.json"),
        JSON.stringify({
          id: "a_new",
          sessionID,
          messageID: prevID,
          type: "reasoning",
          text: "latest chain",
          time: { start: 20 },
        }),
      )

      writeFileSync(
        join(badDir, "a_late.json"),
        JSON.stringify({
          id: "a_late",
          sessionID,
          messageID: badID,
          type: "thinking",
          thinking: "late chain",
          time: { start: 200 },
        }),
      )
      writeFileSync(
        join(badDir, "z_text.json"),
        JSON.stringify({
          id: "z_text",
          sessionID,
          messageID: badID,
          type: "text",
          text: "answer",
          time: { start: 100 },
        }),
      )

      const res = await recoverThinkingBlockOrder(
        {} as never,
        sessionID,
        { info: { id: badID, role: "assistant" }, parts: [] },
        "",
        new Error("messages.1: thinking block must not be the first block"),
      )

      expect(res).toBe(true)
      expect(JSON.parse(readFileSync(join(badDir, `prt_0000000000_${badID}_thinking.json`), "utf-8")).thinking).toBe(
        "latest chain",
      )
    } finally {
      rmSync(msgDir, { recursive: true, force: true })
      rmSync(prevDir, { recursive: true, force: true })
      rmSync(badDir, { recursive: true, force: true })
    }
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
