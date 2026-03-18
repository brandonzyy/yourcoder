// Merged from: agent-names.ts, runtime-fallback.ts, internal/permission.ts,
// agent-overrides.ts, background-task.ts, browser-automation.ts, categories.ts,
// claude-code.ts, commands.ts, dynamic-context-pruning.ts, experimental.ts,
// ralph-loop.ts, skills.ts, tmux.ts, websearch.ts, yc.ts

import { z } from "zod"
import { BUILTIN_COMMAND_NAMES } from "../../cli/commands/names"

// --- agent-names ---

export const BuiltinSkillNameSchema = z.enum([
  "playwright",
  "agent-browser",
  "dev-browser",
  "frontend-ui-ux",
  "git-master",
])

export type BuiltinSkillName = z.infer<typeof BuiltinSkillNameSchema>

// --- runtime-fallback ---

export const FallbackModelsSchema = z.union([z.string(), z.array(z.string())])
export type FallbackModels = z.infer<typeof FallbackModelsSchema>

export const RuntimeFallbackConfigSchema = z.object({
  /** Enable runtime fallback (default: false) */
  enabled: z.boolean().optional(),
  /** HTTP status codes that trigger fallback (default: [400, 429, 503, 529]) */
  retry_on_errors: z.array(z.number()).optional(),
  /** Maximum fallback attempts per session (default: 3) */
  max_fallback_attempts: z.number().min(1).max(20).optional(),
  /** Cooldown in seconds before retrying a failed model (default: 60) */
  cooldown_seconds: z.number().min(0).optional(),
  /** Session-level timeout in seconds to advance fallback when provider hangs (default: 30). Set to 0 to disable auto-retry signal detection (only error-based fallback remains active). */
  timeout_seconds: z.number().min(0).optional(),
  /** Show toast notification when switching to fallback model (default: true) */
  notify_on_fallback: z.boolean().optional(),
})

export type RuntimeFallbackConfig = z.infer<typeof RuntimeFallbackConfigSchema>

// --- internal/permission ---

export const PermissionValueSchema = z.enum(["ask", "allow", "deny"])

const BashPermissionSchema = z.union([
  PermissionValueSchema,
  z.record(z.string(), PermissionValueSchema),
])

export const AgentPermissionSchema = z.object({
  edit: PermissionValueSchema.optional(),
  bash: BashPermissionSchema.optional(),
  webfetch: PermissionValueSchema.optional(),
  task: PermissionValueSchema.optional(),
  doom_loop: PermissionValueSchema.optional(),
  external_directory: PermissionValueSchema.optional(),
})

// --- agent-overrides ---

export const AgentOverrideConfigSchema = z.object({
  /** @deprecated Use `category` instead. Model is inherited from category defaults. */
  model: z.string().optional(),
  fallback_models: FallbackModelsSchema.optional(),
  variant: z.string().optional(),
  /** Category name to inherit model and other settings from CategoryConfig */
  category: z.string().optional(),
  /** Skill names to inject into agent prompt */
  skills: z.array(z.string()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  prompt: z.string().optional(),
  /** Text to append to agent prompt. Supports file:// URIs (file:///abs, file://./rel, file://~/home) */
  prompt_append: z.string().optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  disable: z.boolean().optional(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]).optional(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  permission: AgentPermissionSchema.optional(),
  /** Maximum tokens for response. Passed directly to OpenCode SDK. */
  maxTokens: z.number().optional(),
  /** Extended thinking configuration (Anthropic). Overrides category and default settings. */
  thinking: z
    .object({
      type: z.enum(["enabled", "disabled"]),
      budgetTokens: z.number().optional(),
    })
    .optional(),
  /** Reasoning effort level (OpenAI). Overrides category and default settings. */
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  /** Text verbosity level. */
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  /** Provider-specific options. Passed directly to OpenCode SDK. */
  providerOptions: z.record(z.string(), z.unknown()).optional(),
  /** Per-message ultrawork override model/variant when ultrawork keyword is detected. */
  ultrawork: z
    .object({
      model: z.string().optional(),
      variant: z.string().optional(),
    })
    .optional(),
  compaction: z
    .object({
      model: z.string().optional(),
      variant: z.string().optional(),
    })
    .optional(),
})

export const AgentOverridesSchema = z.object({
  build: AgentOverrideConfigSchema.optional(),
  plan: AgentOverrideConfigSchema.optional(),
  yac: AgentOverrideConfigSchema.optional(),
  hephaestus: AgentOverrideConfigSchema.extend({
    allow_non_gpt_model: z.boolean().optional(),
  }).optional(),
  "coderhand": AgentOverrideConfigSchema.optional(),
  "OpenCode-Builder": AgentOverrideConfigSchema.optional(),
  prometheus: AgentOverrideConfigSchema.optional(),
  metis: AgentOverrideConfigSchema.optional(),
  momus: AgentOverrideConfigSchema.optional(),
  oracle: AgentOverrideConfigSchema.optional(),
  codersearch: AgentOverrideConfigSchema.optional(),
  "multimodal-looker": AgentOverrideConfigSchema.optional(),
})

export type AgentOverrideConfig = z.infer<typeof AgentOverrideConfigSchema>
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>

// --- background-task ---

export const BackgroundTaskConfigSchema = z.object({
  defaultConcurrency: z.number().min(1).optional(),
  providerConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  modelConcurrency: z.record(z.string(), z.number().min(0)).optional(),
  /** Stale timeout in milliseconds - interrupt tasks with no activity for this duration (default: 180000 = 3 minutes, minimum: 60000 = 1 minute) */
  staleTimeoutMs: z.number().min(60000).optional(),
  /** Timeout for tasks that never received any progress update, falling back to startedAt (default: 600000 = 10 minutes, minimum: 60000 = 1 minute) */
  messageStalenessTimeoutMs: z.number().min(60000).optional(),
  syncPollTimeoutMs: z.number().min(60000).optional(),
})

export type BackgroundTaskConfig = z.infer<typeof BackgroundTaskConfigSchema>

// --- browser-automation ---

export const BrowserAutomationProviderSchema = z.enum([
  "playwright",
  "agent-browser",
  "dev-browser",
  "playwright-cli",
])

export const BrowserAutomationConfigSchema = z.object({
  /**
   * Browser automation provider to use for the "playwright" skill.
   * - "playwright": Uses Playwright MCP server (@playwright/mcp) - default
   * - "agent-browser": Uses Vercel's agent-browser CLI (requires: bun add -g agent-browser)
   * - "dev-browser": Uses dev-browser skill with persistent browser state
   * - "playwright-cli": Uses Playwright CLI (@playwright/cli) - token-efficient CLI alternative
   */
  provider: BrowserAutomationProviderSchema.default("playwright"),
})

export type BrowserAutomationProvider = z.infer<
  typeof BrowserAutomationProviderSchema
>
export type BrowserAutomationConfig = z.infer<typeof BrowserAutomationConfigSchema>

// --- categories ---

export const CategoryConfigSchema = z.object({
  /** Human-readable description of the category's purpose. Shown in task prompt. */
  description: z.string().optional(),
  model: z.string().optional(),
  fallback_models: FallbackModelsSchema.optional(),
  variant: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  maxTokens: z.number().optional(),
  thinking: z
    .object({
      type: z.enum(["enabled", "disabled"]),
      budgetTokens: z.number().optional(),
    })
    .optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  textVerbosity: z.enum(["low", "medium", "high"]).optional(),
  tools: z.record(z.string(), z.boolean()).optional(),
  prompt_append: z.string().optional(),
  max_prompt_tokens: z.number().int().positive().optional(),
  /** Mark agent as unstable - forces background mode for monitoring. Auto-enabled for gemini/minimax models. */
  is_unstable_agent: z.boolean().optional(),
  /** Disable this category. Disabled categories are excluded from task delegation. */
  disable: z.boolean().optional(),
})

export const CategoriesConfigSchema = z.record(z.string(), CategoryConfigSchema)

export type CategoryConfig = z.infer<typeof CategoryConfigSchema>
export type CategoriesConfig = z.infer<typeof CategoriesConfigSchema>

// --- claude-code ---

export const ClaudeCodeConfigSchema = z.object({
  mcp: z.boolean().optional(),
  commands: z.boolean().optional(),
  skills: z.boolean().optional(),
  agents: z.boolean().optional(),
  hooks: z.boolean().optional(),
  plugins: z.boolean().optional(),
  plugins_override: z.record(z.string(), z.boolean()).optional(),
})

// --- commands ---

export const BuiltinCommandNameSchema = z.enum(BUILTIN_COMMAND_NAMES)

// --- dynamic-context-pruning ---

export const DynamicContextPruningConfigSchema = z.object({
  /** Enable dynamic context pruning (default: false) */
  enabled: z.boolean().default(false),
  /** Notification level: off, minimal, or detailed (default: detailed) */
  notification: z.enum(["off", "minimal", "detailed"]).default("detailed"),
  /** Turn protection - prevent pruning recent tool outputs */
  turn_protection: z
    .object({
      enabled: z.boolean().default(true),
      turns: z.number().min(1).max(10).default(3),
    })
    .optional(),
  /** Tools that should never be pruned */
  protected_tools: z.array(z.string()).default([
    "task",
    "todowrite",
    "todoread",
    "lsp_rename",
    "session_read",
    "session_write",
    "session_search",
  ]),
  /** Pruning strategies configuration */
  strategies: z
    .object({
      /** Remove duplicate tool calls (same tool + same args) */
      deduplication: z
        .object({
          enabled: z.boolean().default(true),
        })
        .optional(),
      /** Prune write inputs when file subsequently read */
      supersede_writes: z
        .object({
          enabled: z.boolean().default(true),
          /** Aggressive mode: prune any write if ANY subsequent read */
          aggressive: z.boolean().default(false),
        })
        .optional(),
      /** Prune errored tool inputs after N turns */
      purge_errors: z
        .object({
          enabled: z.boolean().default(true),
          turns: z.number().min(1).max(20).default(5),
        })
        .optional(),
    })
    .optional(),
})

// --- experimental ---

export const ExperimentalConfigSchema = z.object({
  aggressive_truncation: z.boolean().optional(),
  auto_resume: z.boolean().optional(),
  preemptive_compaction: z.boolean().optional(),
  /** Truncate all tool outputs, not just whitelisted tools (default: false). Tool output truncator is enabled by default - disable via disabled_hooks. */
  truncate_all_tool_outputs: z.boolean().optional(),
  /** Dynamic context pruning configuration */
  dynamic_context_pruning: DynamicContextPruningConfigSchema.optional(),
  /** Enable experimental task system for Todowrite disabler hook */
  task_system: z.boolean().optional(),
  /** Timeout in ms for loadAllPluginComponents during config handler init (default: 10000, min: 1000) */
  plugin_load_timeout_ms: z.number().min(1000).optional(),
  /** Wrap hook creation in try/catch to prevent one failing hook from crashing the plugin (default: true at call site) */
  safe_hook_creation: z.boolean().optional(),
  /** Disable auto-injected <omo-env> context in prompts (experimental) */
  disable_omo_env: z.boolean().optional(),
  /** Enable hashline_edit tool for improved file editing with hash-based line anchors */
  hashline_edit: z.boolean().optional(),
  /** Append fallback model info to session title when a runtime fallback occurs (default: false) */
  model_fallback_title: z.boolean().optional(),
})

export type ExperimentalConfig = z.infer<typeof ExperimentalConfigSchema>

// --- ralph-loop ---

export const RalphLoopConfigSchema = z.object({
  /** Enable ralph loop functionality (default: false - opt-in feature) */
  enabled: z.boolean().default(false),
  /** Default max iterations if not specified in command (default: 100) */
  default_max_iterations: z.number().min(1).max(1000).default(100),
  /** Custom state file directory relative to project root (default: .yourcoder/) */
  state_dir: z.string().optional(),
  default_strategy: z.enum(["reset", "continue"]).default("continue"),
})

export type RalphLoopConfig = z.infer<typeof RalphLoopConfigSchema>

// --- skills ---

export const SkillSourceSchema = z.union([
  z.string(),
  z.object({
    path: z.string(),
    recursive: z.boolean().optional(),
    glob: z.string().optional(),
  }),
])

export const SkillDefinitionSchema = z.object({
  description: z.string().optional(),
  template: z.string().optional(),
  from: z.string().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
  subtask: z.boolean().optional(),
  "argument-hint": z.string().optional(),
  license: z.string().optional(),
  compatibility: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  "allowed-tools": z.array(z.string()).optional(),
  disable: z.boolean().optional(),
})

export const SkillEntrySchema = z.union([z.boolean(), SkillDefinitionSchema])

export const SkillsConfigSchema = z.union([
  z.array(z.string()),
  z.object({
    sources: z.array(SkillSourceSchema).optional(),
    enable: z.array(z.string()).optional(),
    disable: z.array(z.string()).optional(),
  }).catchall(SkillEntrySchema),
])

export type SkillsConfig = z.infer<typeof SkillsConfigSchema>
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>

// --- tmux ---

export const TmuxLayoutSchema = z.enum([
  "main-horizontal", // main pane top, agent panes bottom stack
  "main-vertical", // main pane left, agent panes right stack (default)
  "tiled", // all panes same size grid
  "even-horizontal", // all panes horizontal row
  "even-vertical", // all panes vertical stack
])

export const TmuxConfigSchema = z.object({
  enabled: z.boolean().default(false),
  layout: TmuxLayoutSchema.default("main-vertical"),
  main_pane_size: z.number().min(20).max(80).default(60),
  main_pane_min_width: z.number().min(40).default(120),
  agent_pane_min_width: z.number().min(20).default(40),
})

export type TmuxConfig = z.infer<typeof TmuxConfigSchema>
export type TmuxLayout = z.infer<typeof TmuxLayoutSchema>

// --- websearch ---

export const WebsearchProviderSchema = z.enum(["exa", "tavily"])

export const WebsearchConfigSchema = z.object({
  /**
   * Websearch provider to use.
   * - "exa": Uses Exa websearch (default, works without API key)
   * - "tavily": Uses Tavily websearch (requires TAVILY_API_KEY)
   */
  provider: WebsearchProviderSchema.optional(),
})

export type WebsearchConfig = z.infer<typeof WebsearchConfigSchema>

// --- yc ---

export const YcAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
})

export const YcTasksConfigSchema = z.object({
  /** Absolute or relative storage path override. When set, bypasses global config dir. */
  storage_path: z.string().optional(),
  /** Force task list ID (alternative to env ULTRAWORK_TASK_LIST_ID) */
  task_list_id: z.string().optional(),
  /** Enable Claude Code path compatibility mode */
  claude_code_compat: z.boolean().default(false),
})

export const YcConfigSchema = z.object({
  tasks: YcTasksConfigSchema.optional(),
})

export type YcConfig = z.infer<typeof YcConfigSchema>
