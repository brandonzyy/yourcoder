import type { Capabilities, Info } from "./capability"

/**
 * Resolve which capabilities an agent should see based on its capabilities declaration.
 *
 * Resolution order:
 * 1. Start with all registered capabilities
 * 2. Apply include filter (if set, only keep caps with matching tags)
 * 3. Apply exclude filter (remove caps with matching tags)
 * 4. Apply allow override (force-include by ID, even if excluded)
 * 5. Apply deny override (force-exclude by ID, even if included)
 * 6. Apply MCP filter (if set, limit MCP tools to named servers)
 * 7. Filter out unavailable capabilities
 *
 * If capabilities is undefined/null, returns all available capabilities (backward compat).
 */
export function resolve(
  allCapabilities: Info[],
  capabilities?: Capabilities,
): Info[] {
  // No capabilities declaration → get everything available
  if (!capabilities) {
    return allCapabilities.filter((c) => c.available)
  }

  const { include, exclude, allow, deny, mcp } = capabilities

  const allowSet = allow ? new Set(allow) : undefined
  const denySet = deny ? new Set(deny) : undefined
  const mcpSet = mcp ? new Set(mcp) : undefined

  const result: Info[] = []

  for (const cap of allCapabilities) {
    if (!cap.available) continue

    // Step 1: include filter
    if (include && include.length > 0) {
      const hasMatchingTag = cap.tags.some((tag) => include.includes(tag))
      if (!hasMatchingTag && !allowSet?.has(cap.id)) {
        continue
      }
    }

    // Step 2: exclude filter
    if (exclude && exclude.length > 0) {
      const hasExcludedTag = cap.tags.some((tag) => exclude.includes(tag))
      if (hasExcludedTag && !allowSet?.has(cap.id)) {
        continue
      }
    }

    // Step 3: MCP filter
    if (mcpSet && cap.source === "mcp") {
      if (!cap.mcpServer || !mcpSet.has(cap.mcpServer)) {
        continue
      }
    }

    // Step 4: deny override
    if (denySet?.has(cap.id)) {
      continue
    }

    result.push(cap)
  }

  return result
}
