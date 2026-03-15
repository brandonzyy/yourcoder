import { afterEach, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { loadPluginMcpServers } from "./mcp-server-loader"

const dirs: string[] = []

function dir() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-mcp-"))
  dirs.push(value)
  return value
}

afterEach(() => {
  for (const value of dirs.splice(0)) {
    fs.rmSync(value, { recursive: true, force: true })
  }
})

describe("loadPluginMcpServers", () => {
  it("loads namespaced plugin servers with resolved paths and env vars", async () => {
    const root = dir()
    const file = path.join(root, "mcp.json")
    process.env["PLUGIN_TOKEN"] = "secret-token"

    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          sqlite: {
            command: "${CLAUDE_PLUGIN_ROOT}/bin/sqlite",
            args: ["--token", "${PLUGIN_TOKEN}"],
            env: {
              API_KEY: "${PLUGIN_TOKEN}",
            },
          },
        },
      }),
    )

    expect(
      await loadPluginMcpServers([
        {
          name: "demo",
          version: "1.0.0",
          scope: "user",
          installPath: root,
          pluginKey: "demo@local",
          mcpPath: file,
        },
      ]),
    ).toEqual({
      "demo:sqlite": {
        type: "local",
        command: [`${root}/bin/sqlite`, "--token", "secret-token"],
        enabled: true,
        environment: {
          API_KEY: "secret-token",
        },
      },
    })
  })

  it("skips disabled and invalid plugin servers while keeping valid ones", async () => {
    const root = dir()
    const file = path.join(root, "mcp.json")

    fs.writeFileSync(
      file,
      JSON.stringify({
        mcpServers: {
          disabled: {
            command: "uvx",
            disabled: true,
          },
          broken: {
            type: "http",
          },
          live: {
            type: "http",
            url: "https://mcp.example.com",
          },
        },
      }),
    )

    expect(
      await loadPluginMcpServers([
        {
          name: "demo",
          version: "1.0.0",
          scope: "user",
          installPath: root,
          pluginKey: "demo@local",
          mcpPath: file,
        },
        {
          name: "missing",
          version: "1.0.0",
          scope: "user",
          installPath: root,
          pluginKey: "missing@local",
          mcpPath: path.join(root, "missing.json"),
        },
      ]),
    ).toEqual({
      "demo:live": {
        type: "remote",
        url: "https://mcp.example.com",
        enabled: true,
      },
    })
  })
})
