import { describe, expect, test } from "bun:test"

describe("oh-my-openagent internal plugin integration", () => {
  test("OhMyOpenCodePlugin is exported as default and is a function", async () => {
    const mod = await import("../../src/oh-my-openagent")
    expect(typeof mod.default).toBe("function")
  })

  test("OhMyOpenCodePlugin has correct name property", async () => {
    const mod = await import("../../src/oh-my-openagent")
    // Plugin functions should have a name
    expect(mod.default.name).toBe("OhMyOpenCodePlugin")
  })

  test("OhMyOpenCodePlugin is registered in INTERNAL_PLUGINS", async () => {
    // Read the plugin/index.ts source to verify registration
    const fs = await import("fs")
    const path = await import("path")
    const pluginIndexPath = path.join(import.meta.dir, "../../src/plugin/index.ts")
    const content = fs.readFileSync(pluginIndexPath, "utf-8")

    expect(content).toContain("OhMyOpenCodePlugin")
    expect(content).toContain("oh-my-openagent")
  })

  test("exports expected types", async () => {
    // Verify type exports are accessible (compile-time check primarily)
    const mod = await import("../../src/oh-my-openagent")
    // The module should export the default plugin and types
    expect(mod).toBeDefined()
    expect(mod.default).toBeDefined()
  })
})
