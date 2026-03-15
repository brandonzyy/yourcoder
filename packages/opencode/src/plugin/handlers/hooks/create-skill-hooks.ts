import type { AvailableSkill } from "../../../agent/dynamic-agent-prompt-builder"
import type { HookName, PluginConfig } from "../../../config/plugin-schema"
import type { LoadedSkill } from "../../../skill/loader/types"
import type { PluginContext } from "../types"

import { createAutoSlashCommandHook, createCategorySkillReminderHook } from "../../../hooks"
import { mount } from "./mount"

export type SkillHooks = {
  categorySkillReminder: ReturnType<typeof createCategorySkillReminderHook> | null
  autoSlashCommand: ReturnType<typeof createAutoSlashCommandHook> | null
}

export function createSkillHooks(args: {
  ctx: PluginContext
  pluginConfig: PluginConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  mergedSkills: LoadedSkill[]
  availableSkills: AvailableSkill[]
}): SkillHooks {
  const {
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    mergedSkills,
    availableSkills,
  } = args
  const categorySkillReminder = mount("category-skill-reminder", isHookEnabled("category-skill-reminder"), safeHookEnabled, () =>
    createCategorySkillReminderHook(ctx, availableSkills))

  const autoSlashCommand = mount("auto-slash-command", isHookEnabled("auto-slash-command"), safeHookEnabled, () =>
    createAutoSlashCommandHook({
      skills: mergedSkills,
      pluginsEnabled: pluginConfig.claude_code?.plugins ?? true,
      enabledPluginsOverride: pluginConfig.claude_code?.plugins_override,
    }))

  return { categorySkillReminder, autoSlashCommand }
}
