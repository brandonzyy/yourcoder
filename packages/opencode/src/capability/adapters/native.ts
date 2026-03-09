import type { Info } from "../capability"
import { resolveToolTags } from "../tags"

/**
 * Adapt a native Tool.Info ID to a Capability.Info.
 * Native tools are the built-in opencode tools (bash, read, edit, etc.)
 */
export function fromNativeTool(toolId: string): Info {
  return {
    id: toolId,
    source: "builtin",
    tags: resolveToolTags(toolId, false),
    available: true,
  }
}
