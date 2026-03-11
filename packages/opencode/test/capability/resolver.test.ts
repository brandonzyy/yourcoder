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
    cap("glob", { tags: ["filesearch"] }),
    cap("grep", { tags: ["filesearch"] }),
    cap("edit", { tags: ["edit"] }),
    cap("write", { tags: ["edit"] }),
    cap("apply_patch", { tags: ["edit"] }),
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
    // Should include only bash, read (core tag) — not glob/grep (filesearch) or edit/write (edit)
    expect(result.every((c) => c.tags.includes("core"))).toBe(true)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "read")).toBeDefined()
    expect(result.find((c) => c.id === "glob")).toBeUndefined()
    expect(result.find((c) => c.id === "grep")).toBeUndefined()
    expect(result.find((c) => c.id === "edit")).toBeUndefined()
    expect(result.find((c) => c.id === "websearch")).toBeUndefined()
    expect(result.find((c) => c.id === "task")).toBeUndefined()
  })

  it("include multiple tags", () => {
    const caps: Capabilities = { include: ["core", "search"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "websearch")).toBeDefined()
    expect(result.find((c) => c.id === "glob")).toBeUndefined() // filesearch tag, not included
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
    // core only: bash, read (glob/grep are filesearch, edit/write are edit-only)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "read")).toBeDefined()
    expect(result.find((c) => c.id === "edit")).toBeUndefined()
    expect(result.find((c) => c.id === "write")).toBeUndefined()
    expect(result.find((c) => c.id === "glob")).toBeUndefined()
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
    expect(result.find((c) => c.id === "edit")).toBeUndefined() // edit is standalone "edit" tag
    expect(result.find((c) => c.id === "glob")).toBeUndefined() // glob is "filesearch" tag
    expect(result.find((c) => c.id === "websearch")).toBeDefined()
    expect(result.find((c) => c.id === "lsp_references")).toBeDefined()
    expect(result.find((c) => c.id === "ast_grep_search")).toBeDefined()
    expect(result.find((c) => c.id === "task")).toBeUndefined()
    expect(result.find((c) => c.id === "skill")).toBeUndefined()
    expect(result.find((c) => c.id === "mcp__manon__search")).toBeUndefined()
  })

  it("explore agent: core + search, exclude edit (no-op since edit is separate tag)", () => {
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
      include: ["core", "edit", "filesearch", "search", "delegation", "skill", "lsp", "ast", "session", "meta", "mcp", "interactive", "media"],
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

  it("filesearch tag includes grep and glob", () => {
    const caps: Capabilities = { include: ["filesearch"] }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "glob")).toBeDefined()
    expect(result.find((c) => c.id === "grep")).toBeDefined()
    expect(result.find((c) => c.id === "bash")).toBeUndefined()
    expect(result.find((c) => c.id === "edit")).toBeUndefined()
    expect(result.length).toBe(2)
  })

  it("sisyphus: no filesearch/edit tags → grep/glob/edit invisible", () => {
    const caps: Capabilities = {
      include: ["core", "search", "delegation", "skill", "lsp", "ast", "session", "meta", "mcp", "interactive", "media"],
      deny: ["call_omo_agent"],
    }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "read")).toBeDefined()
    expect(result.find((c) => c.id === "grep")).toBeUndefined()
    expect(result.find((c) => c.id === "glob")).toBeUndefined()
    expect(result.find((c) => c.id === "edit")).toBeUndefined()
    expect(result.find((c) => c.id === "write")).toBeUndefined()
    expect(result.find((c) => c.id === "apply_patch")).toBeUndefined()
    expect(result.find((c) => c.id === "call_omo_agent")).toBeUndefined()
  })

  it("manon-explorer: core + mcp → no grep/glob/edit", () => {
    const caps: Capabilities = {
      include: ["core", "mcp"],
    }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "read")).toBeDefined()
    expect(result.find((c) => c.id === "mcp__manon__search")).toBeDefined()
    expect(result.find((c) => c.id === "grep")).toBeUndefined()
    expect(result.find((c) => c.id === "glob")).toBeUndefined()
    expect(result.find((c) => c.id === "edit")).toBeUndefined()
    expect(result.find((c) => c.id === "write")).toBeUndefined()
  })

  it("sisyphus-junior: core + edit + filesearch → grep/glob/edit visible", () => {
    const caps: Capabilities = {
      include: ["core", "edit", "filesearch", "skill", "lsp", "ast", "meta", "mcp", "interactive", "media"],
      deny: ["task"],
    }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "read")).toBeDefined()
    expect(result.find((c) => c.id === "grep")).toBeDefined()
    expect(result.find((c) => c.id === "glob")).toBeDefined()
    expect(result.find((c) => c.id === "edit")).toBeDefined()
    expect(result.find((c) => c.id === "write")).toBeDefined()
    expect(result.find((c) => c.id === "task")).toBeUndefined()
  })

  it("librarian: core + search + filesearch → grep/glob visible, no edit", () => {
    const caps: Capabilities = {
      include: ["core", "search", "filesearch"],
    }
    const result = resolve(allCaps, caps)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "grep")).toBeDefined()
    expect(result.find((c) => c.id === "glob")).toBeDefined()
    expect(result.find((c) => c.id === "websearch")).toBeDefined()
    expect(result.find((c) => c.id === "edit")).toBeUndefined()
    expect(result.find((c) => c.id === "write")).toBeUndefined()
  })
})
