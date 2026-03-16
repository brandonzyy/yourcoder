import { z } from "zod"

export const BuiltinAgentNameSchema = z.enum([
  "yc",
  "codersearch",
  "codereye",
])

export const BuiltinSkillNameSchema = z.enum([
  "playwright",
  "agent-browser",
  "dev-browser",
  "frontend-ui-ux",
  "git-master",
])

export const OverridableAgentNameSchema = z.enum([
  "build",
  "plan",
  "yc",
  "coderhand",
  "OpenCode-Builder",
  "codersearch",
  "codereye",
])

export const AgentNameSchema = BuiltinAgentNameSchema
export type AgentName = z.infer<typeof AgentNameSchema>

export type BuiltinSkillName = z.infer<typeof BuiltinSkillNameSchema>
