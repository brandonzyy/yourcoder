import type { AvailableSkill } from "../agent/dynamic-agent-prompt-builder"
import type { HookName, PluginConfig } from "../config/plugin-schema"
import type { LoadedSkill } from "../skill/loader/types"
import type { BackgroundManager } from "../agent/background"
import type { PluginContext } from "./handlers/types"
import type { ModelCacheState } from "./plugin-state"

import { createSessionHooks } from "./handlers/hooks/create-session-hooks"
import { createContinuationHooks } from "./handlers/hooks/create-continuation-hooks"
import { createSkillHooks } from "./handlers/hooks/create-skill-hooks"
import { createToolGuardHooks } from "./handlers/hooks/create-tool-guard-hooks"
import { createTransformHooks } from "./handlers/hooks/create-transform-hooks"

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

  const session = createSessionHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    isHookEnabled,
    safeHookEnabled,
  })

  const tool = createToolGuardHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    isHookEnabled,
    safeHookEnabled,
  })

  const transform = createTransformHooks({
    ctx,
    pluginConfig,
    isHookEnabled: (name) => isHookEnabled(name as HookName),
    safeHookEnabled,
  })

  const continuation = createContinuationHooks({
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    backgroundManager,
    sessionRecovery: session.sessionRecovery,
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
    ...session,
    ...tool,
    ...transform,
    ...continuation,
    ...skill,
  }
}
