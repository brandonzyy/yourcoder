import { z } from "zod"
import { BUILTIN_COMMAND_NAMES } from "../../cli/commands/names"

export const BuiltinCommandNameSchema = z.enum(BUILTIN_COMMAND_NAMES)

export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
