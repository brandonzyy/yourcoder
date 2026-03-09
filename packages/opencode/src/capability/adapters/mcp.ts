import type { Info } from "../capability"

/**
 * Adapt an MCP tool to a Capability.Info.
 * MCP tools use a naming convention: `{serverName}_{toolName}`.
 */
export function fromMcpTool(toolId: string, serverName: string): Info {
  return {
    id: toolId,
    source: "mcp",
    tags: ["mcp"],
    available: true,
    mcpServer: serverName,
  }
}
