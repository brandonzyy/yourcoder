import type { Tag } from "./capability"

/**
 * Static mapping of tool IDs to their tags.
 * Used by adapters to assign tags when registering capabilities.
 */
const TOOL_TAG_MAP: Record<string, Tag[]> = {
  // core
  bash: ["core"],
  read: ["core"],
  glob: ["core"],
  grep: ["core"],

  // edit
  edit: ["core", "edit"],
  write: ["core", "edit"],
  apply_patch: ["core", "edit"],
  hashline_edit: ["core", "edit"],

  // search
  websearch: ["search"],
  codesearch: ["search"],
  webfetch: ["search"],

  // delegation
  task: ["delegation"],
  call_omo_agent: ["delegation"],
  delegate_task: ["delegation"],

  // skill
  skill: ["skill"],

  // meta
  question: ["meta"],
  todowrite: ["meta"],
  todoread: ["meta"],
  task_create: ["meta"],
  task_get: ["meta"],
  task_list: ["meta"],
  task_update: ["meta"],

  // media
  look_at: ["media"],

  // interactive
  interactive_bash: ["interactive"],

  // special
  invalid: ["core"],
  batch: ["core"],
  plan_exit: ["meta"],
}

/**
 * Prefix-based tag rules for tools that share naming conventions.
 */
const PREFIX_RULES: { prefix: string; tags: Tag[] }[] = [
  { prefix: "lsp_", tags: ["lsp"] },
  { prefix: "ast_grep_", tags: ["ast"] },
  { prefix: "session_", tags: ["session"] },
  { prefix: "background_", tags: ["delegation"] },
]

/**
 * Resolve tags for a tool ID.
 * 1. Check exact match in TOOL_TAG_MAP
 * 2. Check prefix rules
 * 3. Default to ["core"] for unknown builtin tools
 */
export function resolveToolTags(toolId: string, isMcp = false): Tag[] {
  if (isMcp) return ["mcp"]

  const exact = TOOL_TAG_MAP[toolId]
  if (exact) return exact

  for (const rule of PREFIX_RULES) {
    if (toolId.startsWith(rule.prefix)) return rule.tags
  }

  // Unknown tools get "core" by default
  return ["core"]
}

/**
 * Register a custom tag mapping (for plugins that define new tool IDs).
 */
export function registerToolTags(toolId: string, tags: Tag[]) {
  TOOL_TAG_MAP[toolId] = tags
}
