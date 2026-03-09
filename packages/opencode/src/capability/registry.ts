import type { Info, Capabilities } from "./capability"
import { resolve } from "./resolver"
import { Log } from "../util/log"

const log = Log.create({ service: "capability.registry" })

/**
 * Unified capability registry.
 * All tools (native, plugin, MCP) register here.
 * Agents query via resolve() to get their filtered tool set.
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
 * If capabilities is undefined, returns all available capabilities (backward compat).
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
