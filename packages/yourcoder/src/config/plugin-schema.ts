export * from "./plugin-schema/schemas"
export * from "./plugin-schema/hooks"
export * from "./plugin-schema/plugin-config"

// Inlined from deleted oh-my-openagent/mcp/types
import { z } from "zod"
export const McpNameSchema = z.enum(["websearch", "context7", "grep_app"])
export type McpName = z.infer<typeof McpNameSchema>
export const AnyMcpNameSchema = z.string().min(1)
export type AnyMcpName = z.infer<typeof AnyMcpNameSchema>
