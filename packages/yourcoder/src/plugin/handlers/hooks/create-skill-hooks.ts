import type { HookName, PluginConfig } from "../../../config/plugin-schema"
import type { LoadedSkill } from "../../../skill/loader/types"
import type { PluginContext } from "../types"

import { createAutoSlashCommandHook } from "../../../hooks"
import { mount } from "./mount"

export type SkillHooks = {
  autoSlashCommand: ReturnType<typeof createAutoSlashCommandHook> | null
}

export function createSkillHooks(args: {
  ctx: PluginContext
  pluginConfig: PluginConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  mergedSkills: LoadedSkill[]
}): SkillHooks {
  const {
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    mergedSkills,
  } = args

  const autoSlashCommand = mount("auto-slash-command", isHookEnabled("auto-slash-command"), safeHookEnabled, () =>
    createAutoSlashCommandHook({
      skills: mergedSkills,
      pluginsEnabled: pluginConfig.claude_code?.plugins ?? true,
      enabledPluginsOverride: pluginConfig.claude_code?.plugins_override,
    }))

  return { autoSlashCommand }
}
