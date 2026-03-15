import type { AvailableCategory, AvailableSkill } from "../agent/dynamic-agent-prompt-builder"
import type { PluginConfig } from "../config/plugin-config-types"
import type { BrowserAutomationProvider } from "../config/plugin-schema/browser-automation"
import type { LoadedSkill } from "../skill/loader/types"
import type { PluginContext, ToolsRecord } from "./handlers/types"
import type { Managers } from "./create-managers"

import { createAvailableCategories } from "./handlers/available-categories"
import { createSkillContext } from "./handlers/skill-context"
import { createToolRegistry } from "./handlers/tool-registry"
import { ToolRegistry } from "../tool/registry"

export type CreateToolsResult = {
  filteredTools: ToolsRecord
  mergedSkills: LoadedSkill[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  browserProvider: BrowserAutomationProvider
  disabledSkills: Set<string>
  taskSystemEnabled: boolean
}

export async function createTools(args: {
  ctx: PluginContext
  pluginConfig: PluginConfig
  managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager">
}): Promise<CreateToolsResult> {
  const { ctx, pluginConfig, managers } = args

  // Register native tools into CapabilityRegistry
  ToolRegistry.registerNativeTools()

  const skillContext = await createSkillContext({
    directory: ctx.directory,
    pluginConfig,
  })

  const availableCategories = createAvailableCategories(pluginConfig)

  const { filteredTools, taskSystemEnabled } = createToolRegistry({
    ctx,
    pluginConfig,
    managers,
    skillContext,
    availableCategories,
  })

  return {
    filteredTools,
    mergedSkills: skillContext.mergedSkills,
    availableSkills: skillContext.availableSkills,
    availableCategories,
    browserProvider: skillContext.browserProvider,
    disabledSkills: skillContext.disabledSkills,
    taskSystemEnabled,
  }
}
