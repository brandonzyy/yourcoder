import type { Info, Capabilities } from "./capability"
import { resolveToolTags } from "./tags"
import { Log } from "../util/log"

const log = Log.create({ service: "capability.registry" })

/**
 * Unified capability registry.
 * All tools (native, plugin, MCP) register here.
 * Agents query via resolveForAgent() to get their filtered tool set.
 */

/** All registered capabilities, keyed by ID */
const capabilities = new Map<string, Info>()

/**
 * Register a capability. If one with the same ID exists, it is replaced.
 */
export function register(info: Info) {
  capabilities.set(info.id, info)
}

/**
 * Register multiple capabilities at once.
 */
export function registerAll(infos: Info[]) {
  for (const info of infos) {
    capabilities.set(info.id, info)
  }
}

/**
 * Unregister a capability by ID.
 */
export function unregister(id: string) {
  capabilities.delete(id)
}

/**
 * Unregister all capabilities from a specific MCP server.
 */
export function unregisterMcpServer(serverName: string) {
  for (const [id, cap] of capabilities) {
    if (cap.source === "mcp" && cap.mcpServer === serverName) {
      capabilities.delete(id)
    }
  }
}

/**
 * Mark all capabilities from an MCP server as unavailable.
 */
export function setMcpServerAvailable(serverName: string, available: boolean) {
  for (const cap of capabilities.values()) {
    if (cap.source === "mcp" && cap.mcpServer === serverName) {
      cap.available = available
    }
  }
}

/**
 * Get all registered capabilities.
 */
export function all(): Info[] {
  return Array.from(capabilities.values())
}

/**
 * Get a specific capability by ID.
 */
export function get(id: string): Info | undefined {
  return capabilities.get(id)
}

/**
 * Resolve capabilities for an agent based on its capabilities declaration.
 * Returns filtered capability IDs.
 */
export function resolveForAgent(agentCapabilities?: Capabilities): Info[] {
  return resolve(all(), agentCapabilities)
}

/**
 * Get all registered capability IDs.
 */
export function ids(): string[] {
  return Array.from(capabilities.keys())
}

/**
 * Clear all registered capabilities. Used for testing.
 */
export function clear() {
  capabilities.clear()
}

// --- Resolver (inlined from resolver.ts) ---

/**
 * Resolve which capabilities an agent should see based on its capabilities declaration.
 */
export function resolve(
  allCapabilities: Info[],
  caps?: Capabilities,
): Info[] {
  if (!caps) {
    return allCapabilities.filter((c) => c.available)
  }

  const { include, exclude, allow, deny, mcp } = caps

  const allowSet = allow ? new Set(allow) : undefined
  const denySet = deny ? new Set(deny) : undefined
  const mcpSet = mcp ? new Set(mcp) : undefined

  const result: Info[] = []

  for (const cap of allCapabilities) {
    if (!cap.available) continue

    if (include && include.length > 0) {
      const hasMatchingTag = cap.tags.some((tag) => include.includes(tag))
      if (!hasMatchingTag && !allowSet?.has(cap.id)) {
        continue
      }
    }

    if (exclude && exclude.length > 0) {
      const hasExcludedTag = cap.tags.some((tag) => exclude.includes(tag))
      if (hasExcludedTag && !allowSet?.has(cap.id)) {
        continue
      }
    }

    if (mcpSet && cap.source === "mcp") {
      if (!cap.mcpServer || !mcpSet.has(cap.mcpServer)) {
        continue
      }
    }

    if (denySet?.has(cap.id)) {
      continue
    }

    result.push(cap)
  }

  return result
}

// --- Adapters (inlined from adapters/) ---

export function fromNativeTool(toolId: string): Info {
  return {
    id: toolId,
    source: "builtin",
    tags: resolveToolTags(toolId, false),
    available: true,
  }
}

export function fromPluginTool(toolId: string): Info {
  return {
    id: toolId,
    source: "plugin",
    tags: resolveToolTags(toolId, false),
    available: true,
  }
}

export function fromMcpTool(toolId: string, serverName: string): Info {
  return {
    id: toolId,
    source: "mcp",
    tags: ["mcp"],
    available: true,
    mcpServer: serverName,
  }
}
