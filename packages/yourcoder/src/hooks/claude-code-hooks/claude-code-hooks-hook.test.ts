import { describe, expect, it } from "bun:test"
import { createClaudeCodeHooksHook } from "./claude-code-hooks-hook"

describe("createClaudeCodeHooksHook", () => {
  it("returns an object with all expected handler keys", () => {
    const ctx = { directory: "/tmp/project", client: {} } as never
    const hook = createClaudeCodeHooksHook(ctx)

    expect(hook).toHaveProperty("experimental.session.compacting")
    expect(hook).toHaveProperty("chat.message")
    expect(hook).toHaveProperty("tool.execute.before")
    expect(hook).toHaveProperty("tool.execute.after")
    expect(hook).toHaveProperty("event")

    expect(typeof hook["experimental.session.compacting"]).toBe("function")
    expect(typeof hook["chat.message"]).toBe("function")
    expect(typeof hook["tool.execute.before"]).toBe("function")
    expect(typeof hook["tool.execute.after"]).toBe("function")
    expect(typeof hook.event).toBe("function")
  })

  it("uses an empty config by default", () => {
    const ctx = { directory: "/tmp/project", client: {} } as never
    const hook = createClaudeCodeHooksHook(ctx)
    expect(Object.keys(hook)).toHaveLength(5)
  })
})
