import { z } from "zod"

export const BabysittingConfigSchema = z.object({
  timeout_ms: z.number().default(120000),
})
export type BabysittingConfig = z.infer<typeof BabysittingConfigSchema>

export const CommentCheckerConfigSchema = z.object({
  /** Custom prompt to replace the default warning message. Use {{comments}} placeholder for detected comments XML. */
  custom_prompt: z.string().optional(),
})
export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>

export const NotificationConfigSchema = z.object({
  /** Force enable session-notification even if external notification plugins are detected (default: false) */
  force_enable: z.boolean().optional(),
})
export type NotificationConfig = z.infer<typeof NotificationConfigSchema>

export const StartWorkConfigSchema = z.object({
  /** Enable auto-commit after each atomic task completion (default: true) */
  auto_commit: z.boolean().default(true),
})
export type StartWorkConfig = z.infer<typeof StartWorkConfigSchema>

export const GitMasterConfigSchema = z.object({
  /** Add "Ultraworked with Sisyphus" footer to commit messages (default: true). Can be boolean or custom string. */
  commit_footer: z.union([z.boolean(), z.string()]).default(true),
  /** Add "Co-authored-by: Sisyphus" trailer to commit messages (default: true) */
  include_co_authored_by: z.boolean().default(true),
})
export type GitMasterConfig = z.infer<typeof GitMasterConfigSchema>
