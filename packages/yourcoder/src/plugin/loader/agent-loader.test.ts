import { afterEach, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadPluginAgents } from "./agent-loader"

const dirs: string[] = []

function dir() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-agent-"))
  dirs.push(value)
  return value
}

afterEach(() => {
  for (const value of dirs.splice(0)) {
    fs.rmSync(value, { recursive: true, force: true })
  }
})

describe("loadPluginAgents", () => {
  it("loads namespaced agents from markdown files", () => {
    const root = dir()
    const agents = path.join(root, "agents")
    fs.mkdirSync(agents, { recursive: true })
    fs.writeFileSync(
      path.join(agents, "review.md"),
      [
        "---",
        "description: Review code",
        "tools: Read, Edit",
        "---",
        "",
        "Check the changed files carefully.",
      ].join("\n"),
    )

    expect(
      loadPluginAgents([
        {
          name: "demo",
          version: "1.0.0",
          scope: "user",
          installPath: root,
          pluginKey: "demo@local",
          agentsDir: agents,
        },
      ]),
    ).toEqual({
      "demo:review": {
        description: "(plugin: demo) Review code",
        mode: "subagent",
        prompt: "Check the changed files carefully.",
        tools: {
          edit: true,
          read: true,
        },
      },
    })
  })
})
