import z from "zod"

/**
 * Tags for categorizing capabilities.
 * Each tool is assigned one or more tags, used by agents to declare what they need.
 */
export const Tag = z.enum([
  "core",        // bash, read
  "edit",        // edit, write, apply_patch, hashline_edit
  "filesearch",  // grep, glob
  "search",      // websearch, codesearch, webfetch
  "delegation",  // task, call_omo_agent, background_*, delegate_task
  "skill",       // skill tool
  "lsp",         // lsp_*
  "ast",         // ast_grep_*
  "session",     // session_*
  "mcp",         // all MCP server tools
  "meta",        // question, todowrite, task_create/get/list/update
  "media",       // look_at
  "interactive", // interactive_bash
])
export type Tag = z.infer<typeof Tag>

/**
 * Source of a capability — where it came from.
 */
export const Source = z.enum([
  "builtin",  // native yourcoder tools (bash, read, etc.)
  "plugin",   // oh-my-openagent plugin tools
  "mcp",      // MCP server tools
  "skill",    // skill tool
  "custom",   // user-defined custom tools
])
export type Source = z.infer<typeof Source>

/**
 * Core capability info — a unified representation of any tool/MCP/skill.
 */
export interface Info {
  /** Unique identifier: "bash", "mcp__manon__search", "skill" */
  id: string
  /** Where this capability came from */
  source: Source
  /** Categorization tags */
  tags: Tag[]
  /** Whether the capability is currently available (MCP disconnected = false) */
  available: boolean
  /** MCP server name, if source is "mcp" */
  mcpServer?: string
}

/**
 * Agent capabilities declaration — controls which tools an agent can see.
 */
export const Capabilities = z
  .object({
    /** Include capabilities matching these tags */
    include: z.array(Tag).optional(),
    /** Exclude capabilities matching these tags */
    exclude: z.array(Tag).optional(),
    /** Force-include by ID (overrides exclude) */
    allow: z.array(z.string()).optional(),
    /** Force-exclude by ID (overrides include) */
    deny: z.array(z.string()).optional(),
    /** Limit MCP tools to these server names */
    mcp: z.array(z.string()).optional(),
  })
  .optional()
export type Capabilities = z.infer<typeof Capabilities>
