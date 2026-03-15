import { afterEach, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { discoverInstalledPlugins } from "./discovery"

const dirs: string[] = []
const env = {
  CLAUDE_PLUGINS_HOME: process.env.CLAUDE_PLUGINS_HOME,
  CLAUDE_SETTINGS_PATH: process.env.CLAUDE_SETTINGS_PATH,
}

function dir() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-discovery-"))
  dirs.push(value)
  return value
}

afterEach(() => {
  process.env.CLAUDE_PLUGINS_HOME = env.CLAUDE_PLUGINS_HOME
  process.env.CLAUDE_SETTINGS_PATH = env.CLAUDE_SETTINGS_PATH
  for (const value of dirs.splice(0)) {
    fs.rmSync(value, { recursive: true, force: true })
  }
})

describe("discoverInstalledPlugins", () => {
  it("discovers enabled plugins and resolves component paths", () => {
    const root = dir()
    const home = path.join(root, "plugins")
    const install = path.join(root, "demo-plugin")
    const settings = path.join(root, "settings.json")

    fs.mkdirSync(path.join(home), { recursive: true })
    fs.mkdirSync(path.join(install, ".claude-plugin"), { recursive: true })
    fs.mkdirSync(path.join(install, "commands"), { recursive: true })
    fs.mkdirSync(path.join(install, "agents"), { recursive: true })
    fs.mkdirSync(path.join(install, "skills"), { recursive: true })
    fs.mkdirSync(path.join(install, "hooks"), { recursive: true })

    fs.writeFileSync(
      path.join(home, "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "demo@market": [
            {
              scope: "user",
              installPath: install,
              version: "1.2.3",
              installedAt: "2026-01-01T00:00:00Z",
              lastUpdated: "2026-01-01T00:00:00Z",
            },
          ],
        },
      }),
    )
    fs.writeFileSync(
      settings,
      JSON.stringify({
        enabledPlugins: {
          "demo@market": false,
        },
      }),
    )
    fs.writeFileSync(
      path.join(install, ".claude-plugin", "plugin.json"),
      JSON.stringify({
        name: "demo-manifest",
        version: "9.9.9",
      }),
    )
    fs.writeFileSync(path.join(install, "hooks", "hooks.json"), "{}")
    fs.writeFileSync(path.join(install, ".mcp.json"), "{}")

    process.env.CLAUDE_PLUGINS_HOME = home
    process.env.CLAUDE_SETTINGS_PATH = settings

    expect(
      discoverInstalledPlugins({
        enabledPluginsOverride: {
          "demo@market": true,
        },
      }),
    ).toEqual({
      plugins: [
        {
          name: "demo-manifest",
          version: "1.2.3",
          scope: "user",
          installPath: install,
          pluginKey: "demo@market",
          manifest: {
            name: "demo-manifest",
            version: "9.9.9",
          },
          commandsDir: path.join(install, "commands"),
          agentsDir: path.join(install, "agents"),
          skillsDir: path.join(install, "skills"),
          hooksPath: path.join(install, "hooks", "hooks.json"),
          mcpPath: path.join(install, ".mcp.json"),
        },
      ],
      errors: [],
    })
  })

  it("reports missing plugin install paths as errors", () => {
    const root = dir()
    const home = path.join(root, "plugins")

    fs.mkdirSync(home, { recursive: true })
    fs.writeFileSync(
      path.join(home, "installed_plugins.json"),
      JSON.stringify({
        version: 1,
        plugins: {
          "missing@market": {
            scope: "user",
            installPath: path.join(root, "missing-plugin"),
            version: "1.0.0",
            installedAt: "2026-01-01T00:00:00Z",
            lastUpdated: "2026-01-01T00:00:00Z",
          },
        },
      }),
    )

    process.env.CLAUDE_PLUGINS_HOME = home
    delete process.env.CLAUDE_SETTINGS_PATH

    expect(discoverInstalledPlugins()).toEqual({
      plugins: [],
      errors: [
        {
          pluginKey: "missing@market",
          installPath: path.join(root, "missing-plugin"),
          error: "Plugin installation path does not exist",
        },
      ],
    })
  })
})
