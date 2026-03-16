export const BUILTIN_COMMAND_NAMES = [
  "init-deep",
  "ralph-loop",
  "ulw-loop",
  "cancel-ralph",
  "refactor",
  "start-work",
  "stop-continuation",
  "handoff",
] as const

export type BuiltinCommandName = (typeof BUILTIN_COMMAND_NAMES)[number]
