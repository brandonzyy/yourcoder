import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { loadAllPluginComponents } from "./loader"
import * as discovery from "./discovery"
import * as command from "./command-loader"
import * as skill from "./skill-loader"
import * as agent from "./agent-loader"
import * as mcp from "./mcp-server-loader"
import * as hook from "./hook-loader"
import * as logger from "../../util/logger"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(value: T): T {
  spies.push(value)
  return value
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("loadAllPluginComponents", () => {
  it("aggregates components from every plugin loader", async () => {
    const plugins = [
      {
        name: "demo",
        version: "1.0.0",
        scope: "user",
        installPath: "/tmp/demo",
        pluginKey: "demo@local",
      },
    ]
    const errors = [{ pluginKey: "broken@local", installPath: "/tmp/broken", error: "missing" }]
    const commands = { "demo:build": { description: "cmd" } }
    const skills = { "demo:skill": { description: "skill" } }
    const agents = { "demo:agent": { description: "agent", mode: "subagent", prompt: "hi" } }
    const mcpServers = { "demo:mcp": { type: "remote", url: "https://mcp.example.com", enabled: true } }
    const hooksConfigs = [{ hooks: { PreToolUse: [] } }]

    add(spyOn(discovery, "discoverInstalledPlugins").mockReturnValue({ plugins, errors } as never))
    add(spyOn(command, "loadPluginCommands").mockReturnValue(commands as never))
    add(spyOn(skill, "loadPluginSkillsAsCommands").mockReturnValue(skills as never))
    add(spyOn(agent, "loadPluginAgents").mockReturnValue(agents as never))
    add(spyOn(mcp, "loadPluginMcpServers").mockResolvedValue(mcpServers as never))
    add(spyOn(hook, "loadPluginHooksConfigs").mockReturnValue(hooksConfigs as never))
    const log = mock(() => {})
    add(spyOn(logger, "log").mockImplementation(log as never))

    expect(await loadAllPluginComponents()).toEqual({
      commands,
      skills,
      agents,
      mcpServers,
      hooksConfigs,
      plugins,
      errors,
    })

    expect(command.loadPluginCommands).toHaveBeenCalledWith(plugins)
    expect(skill.loadPluginSkillsAsCommands).toHaveBeenCalledWith(plugins)
    expect(agent.loadPluginAgents).toHaveBeenCalledWith(plugins)
    expect(mcp.loadPluginMcpServers).toHaveBeenCalledWith(plugins)
    expect(hook.loadPluginHooksConfigs).toHaveBeenCalledWith(plugins)
    expect(log).toHaveBeenCalledWith(
      "Loaded 1 plugins with 1 commands, 1 skills, 1 agents, 1 MCP servers",
    )
  })

  it("passes options through to discovery", async () => {
    const opts = { enabledPluginsOverride: { "demo@local": true } }

    add(spyOn(discovery, "discoverInstalledPlugins").mockReturnValue({ plugins: [], errors: [] }))
    add(spyOn(command, "loadPluginCommands").mockReturnValue({}))
    add(spyOn(skill, "loadPluginSkillsAsCommands").mockReturnValue({}))
    add(spyOn(agent, "loadPluginAgents").mockReturnValue({}))
    add(spyOn(mcp, "loadPluginMcpServers").mockResolvedValue({}))
    add(spyOn(hook, "loadPluginHooksConfigs").mockReturnValue([]))
    add(spyOn(logger, "log").mockImplementation(() => {}))

    await loadAllPluginComponents(opts)

    expect(discovery.discoverInstalledPlugins).toHaveBeenCalledWith(opts)
  })
})
