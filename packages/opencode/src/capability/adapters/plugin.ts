import type { Info } from "../capability"
import { resolveToolTags } from "../tags"

/**
 * Adapt a plugin ToolDefinition ID to a Capability.Info.
 * Plugin tools come from oh-my-openagent or user plugins.
 */
export function fromPluginTool(toolId: string): Info {
  return {
    id: toolId,
    source: "plugin",
    tags: resolveToolTags(toolId, false),
    available: true,
  }
}
