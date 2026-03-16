import { afterEach, describe, expect, it } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { formatLoadedServersForToast, getSystemMcpServerNames, loadMcpConfigs } from "./loader"

const dirs: string[] = []
const cwd = process.cwd()
const env = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
}

function dir() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-static-"))
  dirs.push(value)
  return value
}

afterEach(() => {
  process.chdir(cwd)
  process.env.HOME = env.HOME
  process.env.USERPROFILE = env.USERPROFILE
  process.env.CLAUDE_CONFIG_DIR = env.CLAUDE_CONFIG_DIR
  for (const value of dirs.splice(0)) {
    fs.rmSync(value, { recursive: true, force: true })
  }
})

describe("claude-code-mcp-loader static", () => {
  it("collects enabled server names across user, project, and local scopes", () => {
    const root = dir()
    const home = path.join(root, "home")
    const cfg = path.join(root, "claude")

    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(cfg, { recursive: true })
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true })

    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          disabled: { command: "uvx", disabled: true },
          shared: { command: "uvx" },
        },
      }),
    )
    fs.writeFileSync(
      path.join(cfg, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          user2: { command: "npx" },
        },
      }),
    )
    fs.writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          project: { command: "bunx" },
        },
      }),
    )
    fs.writeFileSync(
      path.join(root, ".claude", ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          local: { command: "node" },
        },
      }),
    )

    process.env.HOME = home
    process.env.USERPROFILE = home
    process.env.CLAUDE_CONFIG_DIR = cfg
    process.chdir(root)

    const names = getSystemMcpServerNames()

    expect([...names].sort()).toEqual(["local", "project", "shared", "user2"])
  })

  it("loads configs in scope order and removes previously loaded servers when later scopes disable them", async () => {
    const root = dir()
    const home = path.join(root, "home")
    const cfg = path.join(root, "claude")

    fs.mkdirSync(home, { recursive: true })
    fs.mkdirSync(cfg, { recursive: true })
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true })

    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          skipme: { command: "uvx" },
        },
      }),
    )
    fs.writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: { command: "bunx", args: ["alpha"] },
        },
      }),
    )
    fs.writeFileSync(
      path.join(root, ".claude", ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          shared: { command: "bunx", disabled: true },
          local: { type: "http", url: "https://mcp.example.com" },
        },
      }),
    )

    process.env.HOME = home
    process.env.USERPROFILE = home
    process.env.CLAUDE_CONFIG_DIR = cfg
    process.chdir(root)

    const result = await loadMcpConfigs(["skipme"])

    expect(result).toEqual({
      servers: {
        local: {
          type: "remote",
          url: "https://mcp.example.com",
          enabled: true,
        },
      },
      loadedServers: [
        {
          name: "local",
          scope: "local",
          config: {
            type: "remote",
            url: "https://mcp.example.com",
            enabled: true,
          },
        },
      ],
    })
    expect(formatLoadedServersForToast(result.loadedServers)).toBe("local (local)")
  })
})
