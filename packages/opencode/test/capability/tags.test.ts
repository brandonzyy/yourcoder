import { describe, it, expect } from "bun:test"
import { resolveToolTags, registerToolTags } from "../../src/capability/tags"

describe("capability tags", () => {
  it("resolves known tools to correct tags", () => {
    expect(resolveToolTags("bash")).toEqual(["core"])
    expect(resolveToolTags("read")).toEqual(["core"])
    expect(resolveToolTags("edit")).toEqual(["core", "edit"])
    expect(resolveToolTags("write")).toEqual(["core", "edit"])
    expect(resolveToolTags("websearch")).toEqual(["search"])
    expect(resolveToolTags("task")).toEqual(["delegation"])
    expect(resolveToolTags("skill")).toEqual(["skill"])
    expect(resolveToolTags("question")).toEqual(["meta"])
    expect(resolveToolTags("look_at")).toEqual(["media"])
    expect(resolveToolTags("interactive_bash")).toEqual(["interactive"])
  })

  it("resolves prefix-based tools", () => {
    expect(resolveToolTags("lsp_references")).toEqual(["lsp"])
    expect(resolveToolTags("lsp_definitions")).toEqual(["lsp"])
    expect(resolveToolTags("ast_grep_search")).toEqual(["ast"])
    expect(resolveToolTags("session_list")).toEqual(["session"])
    expect(resolveToolTags("background_run")).toEqual(["delegation"])
  })

  it("MCP tools always get mcp tag", () => {
    expect(resolveToolTags("manon_search", true)).toEqual(["mcp"])
    expect(resolveToolTags("anything", true)).toEqual(["mcp"])
  })

  it("unknown tools default to core", () => {
    expect(resolveToolTags("unknown_tool")).toEqual(["core"])
  })

  it("registerToolTags adds custom mapping", () => {
    registerToolTags("my_custom_tool", ["search", "core"])
    expect(resolveToolTags("my_custom_tool")).toEqual(["search", "core"])
  })
})
