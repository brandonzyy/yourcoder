import { describe, expect, it } from "bun:test"
import { resolvePluginPath, resolvePluginPaths } from "./plugin-path-resolver"

describe("resolvePluginPath", () => {
  it("replaces CLAUDE_PLUGIN_ROOT placeholders", () => {
    expect(resolvePluginPath("${CLAUDE_PLUGIN_ROOT}/bin/run.sh", "/tmp/plugin")).toBe("/tmp/plugin/bin/run.sh")
  })
})

describe("resolvePluginPaths", () => {
  it("resolves placeholders recursively", () => {
    expect(
      resolvePluginPaths(
        {
          hooks: [
            "${CLAUDE_PLUGIN_ROOT}/a",
            {
              path: "${CLAUDE_PLUGIN_ROOT}/b",
            },
          ],
        },
        "/tmp/plugin",
      ),
    ).toEqual({
      hooks: [
        "/tmp/plugin/a",
        {
          path: "/tmp/plugin/b",
        },
      ],
    })
  })
})
