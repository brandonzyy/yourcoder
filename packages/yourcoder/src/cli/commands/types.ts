import type { CommandDefinition } from "./command-types"
import type { BuiltinCommandName } from "./names"
export type { BuiltinCommandName } from "./names"

export interface BuiltinCommandConfig {
  disabled_commands?: BuiltinCommandName[]
}

export type BuiltinCommands = Record<string, CommandDefinition>
