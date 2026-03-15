import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { executePreToolUseHooks } from "./pre-tool-use"
import type { ClaudeHooksConfig } from "./types"

const oldFetch = globalThis.fetch

describe("executePreToolUseHooks", () => {
  let hit: ReturnType<typeof mock>

  beforeEach(() => {
    hit = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "ask",
              permissionDecisionReason: "need review",
              updatedInput: { file_path: "/tmp/next.ts" },
            },
            systemMessage: "check first",
          }),
          { status: 200 },
        ),
      ),
    )
    globalThis.fetch = hit as never
  })

  afterEach(() => {
    globalThis.fetch = oldFetch
  })

  it("maps hook output into ask decision and sends snake_case stdin", async () => {
    const cfg: ClaudeHooksConfig = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "http", url: "https://hook.test/pre" }],
        },
      ],
    }

    const res = await executePreToolUseHooks(
      {
        sessionId: "ses_1",
        toolName: "bash",
        toolInput: {
          filePath: "/tmp/in.ts",
          lineCount: 42,
        },
        cwd: "/tmp",
        toolUseId: "call_1",
      },
      cfg,
    )

    const body = JSON.parse(String(hit.mock.calls[0]?.[1]?.body))

    expect(res.decision).toBe("ask")
    expect(res.reason).toBe("need review")
    expect(res.modifiedInput).toEqual({ file_path: "/tmp/next.ts" })
    expect(res.toolName).toBe("Bash")
    expect(res.systemMessage).toBe("check first")
    expect(body.tool_name).toBe("Bash")
    expect(body.tool_input).toEqual({
      file_path: "/tmp/in.ts",
      line_count: 42,
    })
    expect(body.tool_use_id).toBe("call_1")
  })

  it("skips disabled hook commands from extended config", async () => {
    const cfg: ClaudeHooksConfig = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "http", url: "https://hook.test/pre" }],
        },
      ],
    }

    const res = await executePreToolUseHooks(
      {
        sessionId: "ses_1",
        toolName: "bash",
        toolInput: {},
        cwd: "/tmp",
      },
      cfg,
      {
        disabledHooks: {
          PreToolUse: ["hook\\.test/pre"],
        },
      },
    )

    expect(res).toEqual({ decision: "allow" })
    expect(hit).not.toHaveBeenCalled()
  })

  it("returns deny when the hook exits with code 2", async () => {
    hit.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ exitCode: 2 }), { status: 200 }),
      ),
    )

    const cfg: ClaudeHooksConfig = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "http", url: "https://hook.test/pre" }],
        },
      ],
    }

    const res = await executePreToolUseHooks(
      {
        sessionId: "ses_1",
        toolName: "bash",
        toolInput: { cmd: "ls" },
        cwd: "/tmp",
      },
      cfg,
    )

    expect(res.decision).toBe("deny")
    expect(res.toolName).toBe("Bash")
    expect(res.reason).toContain("\"exitCode\":2")
  })
})
