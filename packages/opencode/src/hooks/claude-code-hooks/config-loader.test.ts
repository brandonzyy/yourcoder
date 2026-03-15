import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { isHookCommandDisabled, loadPluginExtendedConfig } from "./config-loader"

const oldDir = process.cwd()
const oldCfg = process.env.OPENCODE_CONFIG_DIR

describe("claude-code-hooks config-loader", () => {
  let dir = ""
  let cfg = ""

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omo-cc-plugin-"))
    cfg = join(dir, "user")
    mkdirSync(cfg, { recursive: true })
    mkdirSync(join(dir, ".opencode"), { recursive: true })
    process.env.OPENCODE_CONFIG_DIR = cfg
    process.chdir(dir)
  })

  afterEach(() => {
    process.chdir(oldDir)
    if (oldCfg === undefined) delete process.env.OPENCODE_CONFIG_DIR
    else process.env.OPENCODE_CONFIG_DIR = oldCfg
    rmSync(dir, { recursive: true, force: true })
  })

  it("merges user and project disabled hook config by event type", async () => {
    writeFileSync(
      join(cfg, "opencode-cc-plugin.json"),
      JSON.stringify({
        disabledHooks: {
          Stop: ["stop-hook"],
          PreToolUse: ["user-hook"],
        },
      }),
    )
    writeFileSync(
      join(dir, ".opencode", "opencode-cc-plugin.json"),
      JSON.stringify({
        disabledHooks: {
          PreToolUse: ["project-hook"],
          PostToolUse: ["post-hook"],
        },
      }),
    )

    const res = await loadPluginExtendedConfig()

    expect(res.disabledHooks).toEqual({
      Stop: ["stop-hook"],
      PreToolUse: ["project-hook"],
      PostToolUse: ["post-hook"],
    })
  })

  it("matches both regex and literal disabled hook patterns", () => {
    const cfg = {
      disabledHooks: {
        PreToolUse: ["hook\\.test/pre", "plain-command"],
      },
    }

    expect(isHookCommandDisabled("PreToolUse", "https://hook.test/pre", cfg)).toBe(true)
    expect(isHookCommandDisabled("PreToolUse", "plain-command", cfg)).toBe(true)
    expect(isHookCommandDisabled("PreToolUse", "other-command", cfg)).toBe(false)
  })
})
