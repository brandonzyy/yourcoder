import { join } from "path"
import { existsSync } from "fs"
import { getClaudeConfigDir } from "../../config/claude-config-dir"
import { getOpenCodeConfigDir } from "../../config/opencode-config-dir"
import type { ClaudeHooksConfig, HookMatcher, HookAction, ClaudeHookEvent } from "./types"
import { log } from "../../util/logger"

// ============================================================================
// Claude settings.json hooks config
// ============================================================================

interface RawHookMatcher {
  matcher?: string
  pattern?: string
  hooks: HookAction[]
}

interface RawClaudeHooksConfig {
  PreToolUse?: RawHookMatcher[]
  PostToolUse?: RawHookMatcher[]
  UserPromptSubmit?: RawHookMatcher[]
  Stop?: RawHookMatcher[]
  PreCompact?: RawHookMatcher[]
}

function normalizeHookMatcher(raw: RawHookMatcher): HookMatcher {
  return {
    matcher: raw.matcher ?? raw.pattern ?? "*",
    hooks: Array.isArray(raw.hooks) ? raw.hooks : [],
  }
}

function normalizeHooksConfig(raw: RawClaudeHooksConfig): ClaudeHooksConfig {
  const result: ClaudeHooksConfig = {}
  const eventTypes: (keyof RawClaudeHooksConfig)[] = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "Stop",
    "PreCompact",
  ]

  for (const eventType of eventTypes) {
    if (raw[eventType]) {
      result[eventType] = raw[eventType].map(normalizeHookMatcher)
    }
  }

  return result
}

export function getClaudeSettingsPaths(customPath?: string): string[] {
  const claudeConfigDir = getClaudeConfigDir()
  const paths = [
    join(claudeConfigDir, "settings.json"),
    join(process.cwd(), ".claude", "settings.json"),
    join(process.cwd(), ".claude", "settings.local.json"),
  ]

  if (customPath && existsSync(customPath)) {
    paths.unshift(customPath)
  }

  return [...new Set(paths)]
}

function mergeHooksConfig(
  base: ClaudeHooksConfig,
  override: ClaudeHooksConfig
): ClaudeHooksConfig {
  const result: ClaudeHooksConfig = { ...base }
  const eventTypes: (keyof ClaudeHooksConfig)[] = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "Stop",
    "PreCompact",
  ]
  for (const eventType of eventTypes) {
    if (override[eventType]) {
      result[eventType] = [...(base[eventType] || []), ...override[eventType]]
    }
  }
  return result
}

export async function loadClaudeHooksConfig(
  customSettingsPath?: string
): Promise<ClaudeHooksConfig | null> {
  const paths = getClaudeSettingsPaths(customSettingsPath)
  let mergedConfig: ClaudeHooksConfig = {}

  for (const settingsPath of paths) {
    if (existsSync(settingsPath)) {
      try {
        const content = await Bun.file(settingsPath).text()
        const settings = JSON.parse(content) as { hooks?: RawClaudeHooksConfig }
        if (settings.hooks) {
          const normalizedHooks = normalizeHooksConfig(settings.hooks)
          mergedConfig = mergeHooksConfig(mergedConfig, normalizedHooks)
        }
      } catch {
        continue
      }
    }
  }

  return Object.keys(mergedConfig).length > 0 ? mergedConfig : null
}

// ============================================================================
// Plugin extended config (disabled hooks)
// ============================================================================

export interface DisabledHooksConfig {
  Stop?: string[]
  PreToolUse?: string[]
  PostToolUse?: string[]
  UserPromptSubmit?: string[]
  PreCompact?: string[]
}

export interface PluginExtendedConfig {
  disabledHooks?: DisabledHooksConfig
}

function getUserConfigPath(): string {
  return join(getOpenCodeConfigDir({ binary: "opencode" }), "yourcoder-cc-plugin.json")
}

function getProjectConfigPath(): string {
  return join(process.cwd(), ".yourcoder", "yourcoder-cc-plugin.json")
}

async function loadConfigFromPath(path: string): Promise<PluginExtendedConfig | null> {
  if (!existsSync(path)) {
    return null
  }

  try {
    const content = await Bun.file(path).text()
    return JSON.parse(content) as PluginExtendedConfig
  } catch (error) {
    log("Failed to load config", { path, error })
    return null
  }
}

function mergeDisabledHooks(
  base: DisabledHooksConfig | undefined,
  override: DisabledHooksConfig | undefined
): DisabledHooksConfig {
  if (!override) return base ?? {}
  if (!base) return override

  return {
    Stop: override.Stop ?? base.Stop,
    PreToolUse: override.PreToolUse ?? base.PreToolUse,
    PostToolUse: override.PostToolUse ?? base.PostToolUse,
    UserPromptSubmit: override.UserPromptSubmit ?? base.UserPromptSubmit,
    PreCompact: override.PreCompact ?? base.PreCompact,
  }
}

export async function loadPluginExtendedConfig(): Promise<PluginExtendedConfig> {
  const userConfig = await loadConfigFromPath(getUserConfigPath())
  const projectConfig = await loadConfigFromPath(getProjectConfigPath())

  const merged: PluginExtendedConfig = {
    disabledHooks: mergeDisabledHooks(
      userConfig?.disabledHooks,
      projectConfig?.disabledHooks
    ),
  }

  if (userConfig || projectConfig) {
    log("Plugin extended config loaded", {
      userConfigExists: userConfig !== null,
      projectConfigExists: projectConfig !== null,
      mergedDisabledHooks: merged.disabledHooks,
    })
  }

  return merged
}

const regexCache = new Map<string, RegExp>()

function getRegex(pattern: string): RegExp {
  let regex = regexCache.get(pattern)
  if (!regex) {
    try {
      regex = new RegExp(pattern)
      regexCache.set(pattern, regex)
    } catch {
      regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      regexCache.set(pattern, regex)
    }
  }
  return regex
}

export function isHookCommandDisabled(
  eventType: ClaudeHookEvent,
  command: string,
  config: PluginExtendedConfig | null
): boolean {
  if (!config?.disabledHooks) return false

  const patterns = config.disabledHooks[eventType]
  if (!patterns || patterns.length === 0) return false

  return patterns.some((pattern) => {
    const regex = getRegex(pattern)
    return regex.test(command)
  })
}
