import type { OhMyOpenCodeConfig } from "../config";
import { loadMcpConfigs } from "../features/claude-code-mcp-loader";
import { transformMcpServer } from "../features/claude-code-mcp-loader/transformer";
import { getAllSkills } from "../features/opencode-skill-loader/skill-discovery";
import { getSystemMcpServerNames } from "../features/claude-code-mcp-loader";
import { createBuiltinMcps } from "../mcp";
import { log } from "../shared";
import type { PluginComponents } from "./plugin-components-loader";

type McpEntry = Record<string, unknown>;

function captureUserDisabledMcps(
  userMcp: Record<string, unknown> | undefined
): Set<string> {
  const disabled = new Set<string>();
  if (!userMcp) return disabled;

  for (const [name, value] of Object.entries(userMcp)) {
    if (
      value &&
      typeof value === "object" &&
      "enabled" in value &&
      (value as McpEntry).enabled === false
    ) {
      disabled.add(name);
    }
  }

  return disabled;
}

export async function applyMcpConfig(params: {
  config: Record<string, unknown>;
  pluginConfig: OhMyOpenCodeConfig;
  pluginComponents: PluginComponents;
}): Promise<void> {
  const disabledMcps = params.pluginConfig.disabled_mcps ?? [];
  const userMcp = params.config.mcp as Record<string, unknown> | undefined;
  const userDisabledMcps = captureUserDisabledMcps(userMcp);

  const mcpResult = params.pluginConfig.claude_code?.mcp ?? true
    ? await loadMcpConfigs(disabledMcps)
    : { servers: {} };

  // Collect MCP servers from skill mcpConfig (builtin + user/project skills)
  const skillMcpServers: Record<string, McpEntry> = {};
  try {
    const systemMcpNames = getSystemMcpServerNames();
    const skills = await getAllSkills({
      browserProvider: params.pluginConfig.browser_automation_engine?.provider,
      disabledSkills: params.pluginConfig.disabled_skills
        ? new Set(params.pluginConfig.disabled_skills)
        : undefined,
    });
    for (const skill of skills) {
      if (!skill.mcpConfig) continue;
      for (const [serverName, serverConfig] of Object.entries(skill.mcpConfig)) {
        if (systemMcpNames.has(serverName)) continue;
        if (disabledMcps.includes(serverName)) continue;
        try {
          skillMcpServers[serverName] = transformMcpServer(serverName, serverConfig) as unknown as McpEntry;
        } catch (error) {
          log(`[mcp-config] Failed to transform skill MCP "${serverName}" from skill "${skill.name}"`, error);
        }
      }
    }
  } catch (error) {
    log("[mcp-config] Failed to load skill MCP configs", error);
  }

  const merged = {
    ...createBuiltinMcps(disabledMcps, params.pluginConfig),
    ...skillMcpServers,
    ...(userMcp ?? {}),
    ...mcpResult.servers,
    ...params.pluginComponents.mcpServers,
  } as Record<string, McpEntry>;

  for (const name of userDisabledMcps) {
    if (merged[name]) {
      merged[name] = { ...merged[name], enabled: false };
    }
  }

  const disabledSet = new Set(disabledMcps);
  for (const name of disabledSet) {
    delete merged[name];
  }

  params.config.mcp = merged;
}
