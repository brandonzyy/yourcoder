import type { CommandDefinition } from "./command-types"
export type { BuiltinCommandName } from "./names"

export type BuiltinCommands = Record<string, CommandDefinition>
