import type { AvailableSkill } from "../agent/dynamic-agent-prompt-builder"
import type { HookName, PluginConfig } from "../config/plugin-config-types"
import type { LoadedSkill } from "../features/opencode-skill-loader/types"
import type { BackgroundManager } from "../agent/background"
import type { PluginContext } from "./handlers/types"
import type { ModelCacheState } from "./plugin-state"

import { createCoreHooks } from "./handlers/hooks/create-core-hooks"
import { createContinuationHooks } from "./handlers/hooks/create-continuation-hooks"
import { createSkillHooks } from "./handlers/hooks/create-skill-hooks"

export type CreatedHooks = ReturnType<typeof createHooks>

export function createHooks(args: {
  ctx: PluginContext
  pluginConfig: PluginConfig
  modelCacheState: ModelCacheState
  backgroundManager: BackgroundManager
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  mergedSkills: LoadedSkill[]
  availableSkills: AvailableSkill[]
}) {
  const {
    ctx,
    pluginConfig,
    modelCacheState,
    backgroundManager,
    isHookEnabled,
    safeHookEnabled,
    mergedSkills,
    availableSkills,
  } = args

  const core = createCoreHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    isHookEnabled,
    safeHookEnabled,
  })

  const continuation = createContinuationHooks({
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    backgroundManager,
    sessionRecovery: core.sessionRecovery,
  })

  const skill = createSkillHooks({
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    mergedSkills,
    availableSkills,
  })

  return {
    ...core,
    ...continuation,
    ...skill,
  }
}
