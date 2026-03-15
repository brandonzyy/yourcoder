import { afterEach, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadPluginCommands } from "./command-loader"

const dirs: string[] = []

function dir() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-command-"))
  dirs.push(value)
  return value
}

afterEach(() => {
  for (const value of dirs.splice(0)) {
    fs.rmSync(value, { recursive: true, force: true })
  }
})

describe("loadPluginCommands", () => {
  it("wraps plugin commands into OpenCode command definitions", () => {
    const root = dir()
    const commands = path.join(root, "commands")
    fs.mkdirSync(commands, { recursive: true })
    fs.writeFileSync(
      path.join(commands, "build.md"),
      [
        "---",
        "description: Build the project",
        "agent: sisyphus",
        "model: claude-sonnet",
        "subtask: true",
        "argument-hint: target",
        "---",
        "",
        "Run the project build.",
      ].join("\n"),
    )

    expect(
      loadPluginCommands([
        {
          name: "demo",
          version: "1.0.0",
          scope: "user",
          installPath: root,
          pluginKey: "demo@local",
          commandsDir: commands,
        },
      ]),
    ).toEqual({
      "demo:build": {
        description: "(plugin: demo) Build the project",
        template: "<command-instruction>\nRun the project build.\n</command-instruction>\n\n<user-request>\n$ARGUMENTS\n</user-request>",
        agent: "sisyphus",
        model: undefined,
        subtask: true,
      },
    })
  })
})
