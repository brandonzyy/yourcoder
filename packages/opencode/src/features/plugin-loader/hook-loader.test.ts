import { afterEach, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadPluginHooksConfigs } from "./hook-loader"

const dirs: string[] = []

function dir() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-hook-"))
  dirs.push(value)
  return value
}

afterEach(() => {
  for (const value of dirs.splice(0)) {
    fs.rmSync(value, { recursive: true, force: true })
  }
})

describe("loadPluginHooksConfigs", () => {
  it("loads hooks config and resolves plugin root placeholders", () => {
    const root = dir()
    const file = path.join(root, "hooks.json")
    fs.writeFileSync(
      file,
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "bash",
              hooks: [
                {
                  type: "command",
                  command: "${CLAUDE_PLUGIN_ROOT}/bin/check.sh",
                },
              ],
            },
          ],
        },
      }),
    )

    expect(
      loadPluginHooksConfigs([
        {
          name: "demo",
          version: "1.0.0",
          scope: "user",
          installPath: root,
          pluginKey: "demo@local",
          hooksPath: file,
        },
      ]),
    ).toEqual([
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "bash",
              hooks: [
                {
                  type: "command",
                  command: `${root}/bin/check.sh`,
                },
              ],
            },
          ],
        },
      },
    ])
  })
})
