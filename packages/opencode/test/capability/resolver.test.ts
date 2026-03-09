import { describe, it, expect, beforeEach } from "bun:test"
import { resolve } from "../../src/capability/resolver"
import type { Info, Capabilities } from "../../src/capability/capability"

function cap(id: string, opts: Partial<Info> = {}): Info {
  return {
    id,
    source: "builtin",
    tags: ["core"],
    available: true,
    ...opts,
  }
}

describe("capability resolver", () => {
  const allCaps: Info[] = [
    cap("bash", { tags: ["core"] }),
    cap("read", { tags: ["core"] }),
    cap("glob", { tags: ["core"] }),
    cap("grep", { tags: ["core"] }),
    cap("edit", { tags: ["core", "edit"] }),
    cap("write", { tags: ["core", "edit"] }),
    cap("apply_patch", { tags: ["core", "edit"] }),
    cap("websearch", { tags: ["search"], source: "builtin" }),
    cap("webfetch", { tags: ["search"], source: "builtin" }),
    cap("task", { tags: ["delegation"], source: "plugin" }),
    cap("call_omo_agent", { tags: ["delegation"], source: "plugin" }),
    cap("skill", { tags: ["skill"], source: "builtin" }),
    cap("lsp_references", { tags: ["lsp"], source: "plugin" }),
    cap("ast_grep_search", { tags: ["ast"], source: "plugin" }),
    cap("session_list", { tags: ["session"], source: "plugin" }),
    cap("question", { tags: ["meta"], source: "builtin" }),
    cap("task_create", { tags: ["meta"], source: "plugin" }),
    cap("look_at", { tags: ["media"], source: "plugin" }),
    cap("interactive_bash", { tags: ["interactive"], source: "plugin" }),
    cap("mcp__manon__search", { tags: ["mcp"], source: "mcp", mcpServer: "manon" }),
    cap("mcp__github__issues", { tags: ["mcp"], source: "mcp", mcpServer: "github" }),
    cap("disconnected_tool", { tags: ["core"], available: false }),
  ]

  it("returns all available capabilities when no declaration", () => {
    const result = resolve(allCaps, undefined)
    expect(result.length).toBe(allCaps.length - 1) // minus disconnected
    expect(result.find((c) => c.id === "disconnected_tool")).toBeUndefined()
  })

  it("filters by include tags", () => {
    const caps: Capabilities = { include: ["core"] }
    const result = resolve(allCaps, caps)
    // Should include bash, read, glob, grep, edit, write, apply_patch (all have "core" tag)
    expect(result.every((c) => c.tags.includes("core"))).toBe(true)
    expect(result.find((c) => c.id === "websearch")).toBeUndefined()
    expect(result.find((c) => c.id === "task")).toBeUndefined()
  })

  it("include multiple tags", () => {
    const caps: Capabilities = { include: ["core", "search"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "websearch")).toBeDefined()
    expect(result.find((c) => c.id === "task")).toBeUndefined()
  })

  it("exclude tags", () => {
    const caps: Capabilities = { exclude: ["edit"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "edit")).toBeUndefined()
    expect(result.find((c) => c.id === "write")).toBeUndefined()
    expect(result.find((c) => c.id === "bash")).toBeDefined()
  })

  it("include + exclude interaction", () => {
    const caps: Capabilities = { include: ["core"], exclude: ["edit"] }
    const result = resolve(allCaps, caps)
    // core but not edit: bash, read, glob, grep
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "edit")).toBeUndefined()
    expect(result.find((c) => c.id === "write")).toBeUndefined()
  })

  it("allow overrides exclude", () => {
    const caps: Capabilities = { include: ["core"], exclude: ["edit"], allow: ["edit"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "edit")).toBeDefined()
    // write is still excluded
    expect(result.find((c) => c.id === "write")).toBeUndefined()
  })

  it("allow overrides include filter", () => {
    const caps: Capabilities = { include: ["core"], allow: ["websearch"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "websearch")).toBeDefined()
    expect(result.find((c) => c.id === "bash")).toBeDefined()
  })

  it("deny overrides everything", () => {
    const caps: Capabilities = { include: ["core"], deny: ["bash"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "bash")).toBeUndefined()
    expect(result.find((c) => c.id === "read")).toBeDefined()
  })

  it("MCP filter limits to named servers", () => {
    const caps: Capabilities = { include: ["mcp"], mcp: ["manon"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "mcp__manon__search")).toBeDefined()
    expect(result.find((c) => c.id === "mcp__github__issues")).toBeUndefined()
  })

  it("MCP filter with include: all MCP + core", () => {
    const caps: Capabilities = { include: ["core", "mcp"], mcp: ["manon"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "mcp__manon__search")).toBeDefined()
    expect(result.find((c) => c.id === "mcp__github__issues")).toBeUndefined()
  })

  it("explore agent: core + search + lsp + ast only", () => {
    const caps: Capabilities = { include: ["core", "search", "lsp", "ast"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "read")).toBeDefined()
    expect(result.find((c) => c.id === "edit")).toBeDefined() // edit has "core" tag
    expect(result.find((c) => c.id === "websearch")).toBeDefined()
    expect(result.find((c) => c.id === "lsp_references")).toBeDefined()
    expect(result.find((c) => c.id === "ast_grep_search")).toBeDefined()
    expect(result.find((c) => c.id === "task")).toBeUndefined()
    expect(result.find((c) => c.id === "skill")).toBeUndefined()
    expect(result.find((c) => c.id === "mcp__manon__search")).toBeUndefined()
  })

  it("explore agent: core + search, deny edit tools", () => {
    const caps: Capabilities = {
      include: ["core", "search", "lsp", "ast"],
      exclude: ["edit"],
    }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "edit")).toBeUndefined()
    expect(result.find((c) => c.id === "write")).toBeUndefined()
    expect(result.find((c) => c.id === "websearch")).toBeDefined()
  })

  it("sisyphus: everything", () => {
    const caps: Capabilities = {
      include: ["core", "edit", "search", "delegation", "skill", "lsp", "ast", "session", "meta", "mcp", "interactive", "media"],
    }
    const result = resolve(allCaps, caps)
    // Should have everything except disconnected
    const availableCount = allCaps.filter((c) => c.available).length
    expect(result.length).toBe(availableCount)
  })

  it("multimodal-looker: core + media", () => {
    const caps: Capabilities = { include: ["core", "media"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "look_at")).toBeDefined()
    expect(result.find((c) => c.id === "task")).toBeUndefined()
    expect(result.find((c) => c.id === "mcp__manon__search")).toBeUndefined()
  })

  it("unavailable caps are always filtered", () => {
    const caps: Capabilities = { include: ["core"], allow: ["disconnected_tool"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "disconnected_tool")).toBeUndefined()
  })

  it("empty capabilities object returns all available", () => {
    const caps: Capabilities = {}
    const result = resolve(allCaps, caps)
    expect(result.length).toBe(allCaps.filter((c) => c.available).length)
  })
})
