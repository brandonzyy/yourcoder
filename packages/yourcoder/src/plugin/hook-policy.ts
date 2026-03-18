import type { HookName, PluginConfig } from "../config/plugin-schema"

const optional = new Set<HookName>([
  "auto-update-checker",
  "no-yc-gpt",
  "question-label-truncator",
  "session-notification",
  "start-work",
  "task-resume-info",
])

export function createHookPolicy(cfg: PluginConfig) {
  const disabled = new Set(cfg.disabled_hooks ?? [])
  const enabled = new Set(cfg.enabled_hooks ?? [])

  return (name: HookName): boolean => {
    if (disabled.has(name)) {
      return false
    }

    if (!optional.has(name)) {
      return true
    }

    return enabled.has(name)
  }
}

export function optionalHooks(): HookName[] {
  return Array.from(optional)
}
