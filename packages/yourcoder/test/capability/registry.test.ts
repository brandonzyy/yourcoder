import { describe, it, expect, beforeEach } from "bun:test"
import * as CapabilityRegistry from "../../src/capability/registry"
import { fromNativeTool, fromPluginTool, fromMcpTool } from "../../src/capability/registry"
import type { Capabilities } from "../../src/capability/capability"

describe("CapabilityRegistry", () => {
  beforeEach(() => {
    CapabilityRegistry.clear()
  })

  it("registers and retrieves capabilities", () => {
    CapabilityRegistry.register(fromNativeTool("bash"))
    CapabilityRegistry.register(fromNativeTool("read"))

    expect(CapabilityRegistry.all().length).toBe(2)
    expect(CapabilityRegistry.get("bash")).toBeDefined()
    expect(CapabilityRegistry.get("bash")!.source).toBe("builtin")
  })

  it("registerAll adds multiple", () => {
    CapabilityRegistry.registerAll([
      fromNativeTool("bash"),
      fromNativeTool("read"),
      fromNativeTool("glob"),
    ])
    expect(CapabilityRegistry.all().length).toBe(3)
  })

  it("replaces existing capability with same ID", () => {
    CapabilityRegistry.register(fromNativeTool("bash"))
    CapabilityRegistry.register(fromPluginTool("bash"))

    expect(CapabilityRegistry.all().length).toBe(1)
    expect(CapabilityRegistry.get("bash")!.source).toBe("plugin")
  })

  it("unregister removes by ID", () => {
    CapabilityRegistry.register(fromNativeTool("bash"))
    CapabilityRegistry.register(fromNativeTool("read"))
    CapabilityRegistry.unregister("bash")

    expect(CapabilityRegistry.all().length).toBe(1)
    expect(CapabilityRegistry.get("bash")).toBeUndefined()
  })

  it("unregisterMcpServer removes all tools from a server", () => {
    CapabilityRegistry.register(fromMcpTool("manon_search", "manon"))
    CapabilityRegistry.register(fromMcpTool("manon_graph", "manon"))
    CapabilityRegistry.register(fromMcpTool("github_issues", "github"))
    CapabilityRegistry.register(fromNativeTool("bash"))

    CapabilityRegistry.unregisterMcpServer("manon")

    expect(CapabilityRegistry.all().length).toBe(2)
    expect(CapabilityRegistry.get("manon_search")).toBeUndefined()
    expect(CapabilityRegistry.get("github_issues")).toBeDefined()
  })

  it("setMcpServerAvailable toggles availability", () => {
    CapabilityRegistry.register(fromMcpTool("manon_search", "manon"))
    CapabilityRegistry.register(fromMcpTool("manon_graph", "manon"))
    CapabilityRegistry.register(fromNativeTool("bash"))

    CapabilityRegistry.setMcpServerAvailable("manon", false)

    const manon = CapabilityRegistry.get("manon_search")!
    expect(manon.available).toBe(false)
    expect(CapabilityRegistry.get("bash")!.available).toBe(true)

    // Re-enable
    CapabilityRegistry.setMcpServerAvailable("manon", true)
    expect(CapabilityRegistry.get("manon_search")!.available).toBe(true)
  })

  it("resolveForAgent filters by capabilities", () => {
    CapabilityRegistry.registerAll([
      fromNativeTool("bash"),
      fromNativeTool("read"),
      fromNativeTool("edit"),
      fromPluginTool("task"),
      fromMcpTool("manon_search", "manon"),
    ])

    // Explore agent: core only, no edit, no delegation, no mcp
    const caps: Capabilities = {
      include: ["core"],
      exclude: ["edit"],
    }
    const result = CapabilityRegistry.resolveForAgent(caps)
    expect(result.find((c) => c.id === "bash")).toBeDefined()
    expect(result.find((c) => c.id === "read")).toBeDefined()
    expect(result.find((c) => c.id === "edit")).toBeUndefined()
    expect(result.find((c) => c.id === "task")).toBeUndefined()
    expect(result.find((c) => c.id === "manon_search")).toBeUndefined()
  })

  it("resolveForAgent with no capabilities returns all", () => {
    CapabilityRegistry.registerAll([
      fromNativeTool("bash"),
      fromPluginTool("task"),
      fromMcpTool("manon_search", "manon"),
    ])

    const result = CapabilityRegistry.resolveForAgent(undefined)
    expect(result.length).toBe(3)
  })

  it("ids returns all registered IDs", () => {
    CapabilityRegistry.registerAll([
      fromNativeTool("bash"),
      fromNativeTool("read"),
    ])
    expect(CapabilityRegistry.ids()).toEqual(["bash", "read"])
  })
})
