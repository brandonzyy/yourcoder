import { z } from "zod"

export const YcAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
})

export type YcAgentConfig = z.infer<typeof YcAgentConfigSchema>

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

export type YcTasksConfig = z.infer<typeof YcTasksConfigSchema>
export type YcConfig = z.infer<typeof YcConfigSchema>
