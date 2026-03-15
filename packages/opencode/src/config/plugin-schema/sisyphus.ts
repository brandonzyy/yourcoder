import { z } from "zod"

export const SisyphusAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
})

export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>

export const SisyphusTasksConfigSchema = z.object({
  /** Absolute or relative storage path override. When set, bypasses global config dir. */
  storage_path: z.string().optional(),
  /** Force task list ID (alternative to env ULTRAWORK_TASK_LIST_ID) */
  task_list_id: z.string().optional(),
  /** Enable Claude Code path compatibility mode */
  claude_code_compat: z.boolean().default(false),
})

export const SisyphusConfigSchema = z.object({
  tasks: SisyphusTasksConfigSchema.optional(),
})

export type SisyphusTasksConfig = z.infer<typeof SisyphusTasksConfigSchema>
export type SisyphusConfig = z.infer<typeof SisyphusConfigSchema>
