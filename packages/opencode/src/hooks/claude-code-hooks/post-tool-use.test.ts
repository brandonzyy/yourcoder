import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { executePostToolUseHooks } from "./post-tool-use"
import type { ClaudeHooksConfig } from "./types"

const oldFetch = globalThis.fetch

describe("executePostToolUseHooks", () => {
  let hit: ReturnType<typeof mock>

  beforeEach(() => {
    hit = mock((_: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const path = String(body.transcript_path)
      const text = readFileSync(path, "utf8")

      expect(existsSync(path)).toBe(true)
      expect(text).toContain("\"name\":\"Read\"")
      expect(text).toContain("\"name\":\"Bash\"")

      return Promise.resolve(
        new Response(
          JSON.stringify({
            decision: "block",
            reason: "stop now",
            hookSpecificOutput: {
              hookEventName: "PostToolUse",
              additionalContext: "use smaller command",
            },
            continue: false,
            stopReason: "blocked",
          }),
          { status: 200 },
        ),
      )
    })
    globalThis.fetch = hit as never
  })

  afterEach(() => {
    globalThis.fetch = oldFetch
  })

  it("builds a temp transcript from client history and returns block output", async () => {
    const cfg: ClaudeHooksConfig = {
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "http", url: "https://hook.test/post" }],
        },
      ],
    }

    const res = await executePostToolUseHooks(
      {
        sessionId: "ses_1",
        toolName: "bash",
        toolInput: { cmd: "ls" },
        toolOutput: { output: "ok" },
        cwd: process.cwd(),
        client: {
          session: {
            messages: mock(() =>
              Promise.resolve({
                data: [
                  {
                    info: { role: "assistant" },
                    parts: [
                      {
                        type: "tool",
                        tool: "read",
                        state: {
                          status: "completed",
                          input: { filePath: "/tmp/a.ts" },
                        },
                      },
                    ],
                  },
                ],
              }),
            ),
          },
        },
      },
      cfg,
    )

    expect(res.block).toBe(true)
    expect(res.reason).toBe("stop now")
    expect(res.toolName).toBe("Bash")
    expect(res.additionalContext).toBe("use smaller command")
    expect(res.continue).toBe(false)
    expect(res.stopReason).toBe("blocked")
  })

  it("returns without dispatch when no hooks match", async () => {
    const cfg: ClaudeHooksConfig = {
      PostToolUse: [
        {
          matcher: "Read",
          hooks: [{ type: "http", url: "https://hook.test/post" }],
        },
      ],
    }

    const res = await executePostToolUseHooks(
      {
        sessionId: "ses_1",
        toolName: "bash",
        toolInput: { cmd: "ls" },
        toolOutput: { output: "ok" },
        cwd: process.cwd(),
      },
      cfg,
    )

    expect(res).toEqual({ block: false })
    expect(hit).not.toHaveBeenCalled()
  })
})
