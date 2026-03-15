import { safeCreateHook } from "../../safe-create-hook"

export function mount<T>(
  name: string,
  enabled: boolean,
  safe: boolean,
  factory: () => T,
): T | null {
  if (!enabled) {
    return null
  }

  return safeCreateHook(name, factory, { enabled: safe })
}
