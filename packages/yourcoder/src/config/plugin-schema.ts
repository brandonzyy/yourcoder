export * from "./plugin-schema/schemas"
export * from "./plugin-schema/hooks"
export * from "./plugin-schema/plugin-config"

import { z } from "zod"
export const AnyMcpNameSchema = z.string().min(1)
export type AnyMcpName = z.infer<typeof AnyMcpNameSchema>
