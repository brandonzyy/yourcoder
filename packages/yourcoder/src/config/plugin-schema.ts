export * from "./plugin-schema/agent-names"
export * from "./plugin-schema/agent-overrides"
export * from "./plugin-schema/background-task"
export * from "./plugin-schema/browser-automation"
export * from "./plugin-schema/categories"
export * from "./plugin-schema/claude-code"
export * from "./plugin-schema/commands"
export * from "./plugin-schema/dynamic-context-pruning"
export * from "./plugin-schema/experimental"
export * from "./plugin-schema/feature-configs"
export * from "./plugin-schema/hooks"
export * from "./plugin-schema/plugin-config"
export * from "./plugin-schema/ralph-loop"
export * from "./plugin-schema/runtime-fallback"
export * from "./plugin-schema/skills"
export * from "./plugin-schema/yc"
export * from "./plugin-schema/tmux"
export * from "./plugin-schema/websearch"

// Inlined from deleted oh-my-openagent/mcp/types
import { z } from "zod"
export const McpNameSchema = z.enum(["websearch", "context7", "grep_app"])
export type McpName = z.infer<typeof McpNameSchema>
export const AnyMcpNameSchema = z.string().min(1)
export type AnyMcpName = z.infer<typeof AnyMcpNameSchema>
