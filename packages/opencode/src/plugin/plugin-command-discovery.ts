import {
  discoverInstalledPlugins,
  loadPluginCommands,
  loadPluginSkillsAsCommands,
} from "../plugin/loader"
import type { CommandDefinition } from "../cli/commands/command-types"

export interface PluginCommandDiscoveryOptions {
  pluginsEnabled?: boolean
  enabledPluginsOverride?: Record<string, boolean>
}

export function discoverPluginCommandDefinitions(
  options?: PluginCommandDiscoveryOptions,
): Record<string, CommandDefinition> {
  if (options?.pluginsEnabled === false) {
    return {}
  }

  const { plugins } = discoverInstalledPlugins({
    enabledPluginsOverride: options?.enabledPluginsOverride,
  })

  return {
    ...loadPluginCommands(plugins),
    ...loadPluginSkillsAsCommands(plugins),
  }
}
