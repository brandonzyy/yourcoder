import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { getClaudeSettingsPaths, loadClaudeHooksConfig } from "./config"

const oldDir = process.cwd()
const oldCfg = process.env.CLAUDE_CONFIG_DIR

describe("claude-code-hooks config", () => {
  let dir = ""
  let cfg = ""

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omo-claude-hooks-"))
    cfg = join(dir, "user")
    mkdirSync(cfg, { recursive: true })
    mkdirSync(join(dir, ".claude"), { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = cfg
    process.chdir(dir)
  })

  afterEach(() => {
    process.chdir(oldDir)
    if (oldCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = oldCfg
    rmSync(dir, { recursive: true, force: true })
  })

  it("builds settings paths and prepends an existing custom file", () => {
    const custom = join(dir, "custom-settings.json")
    writeFileSync(custom, "{}")

    const paths = getClaudeSettingsPaths(custom)

    expect(paths[0]).toBe(custom)
    expect(paths.some((path) => path.endsWith("settings.json"))).toBe(true)
    expect(paths.some((path) => path.endsWith("settings.local.json"))).toBe(true)
    expect(paths.every((path) => existsSync(path) || path.endsWith("settings.json") || path.endsWith("settings.local.json"))).toBe(true)
  })

  it("loads and merges custom, user, and project hook settings", async () => {
    const custom = join(dir, "custom-settings.json")
    writeFileSync(
      custom,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "http", url: "https://hook.test/custom" }] }],
        },
      }),
    )
    writeFileSync(
      join(cfg, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ pattern: "Read", hooks: [{ type: "http", url: "https://hook.test/user" }] }],
        },
      }),
    )
    writeFileSync(
      join(dir, ".claude", "settings.local.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ matcher: "*", hooks: [{ type: "http", url: "https://hook.test/project" }] }],
        },
      }),
    )

    const res = await loadClaudeHooksConfig(custom)

    expect(res?.PreToolUse?.map((item) => item.matcher)).toEqual(["Bash", "Read"])
    expect(res?.PostToolUse?.[0]?.hooks[0]).toEqual({ type: "http", url: "https://hook.test/project" })
  })
})
