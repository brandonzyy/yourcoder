import type { ToolDefinition } from "@opencode-ai/plugin"

import type {
  AvailableCategory,
} from "../../agent/dynamic-agent-prompt-builder"
import type { OhMyOpenCodeConfig } from "../../config/plugin-config-types"
import type { PluginContext, ToolsRecord } from "./types"

import { createDelegateTask } from "../../tool/delegate-task"
import { interactive_bash } from "../../tool/interactive-bash"
import { createHashlineEditTool } from "../../tool/hashline-edit"
import { createLookAt } from "../../tool/look-at"
import { log } from "../../util/logger"
import { CapabilityRegistry, fromPluginTool } from "../../capability"

import type { Managers } from "../create-managers"
import type { SkillContext } from "./skill-context"

export type ToolRegistryResult = {
  filteredTools: ToolsRecord
  taskSystemEnabled: boolean
}

export function createToolRegistry(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  managers: Pick<Managers, "backgroundManager" | "tmuxSessionManager">
  skillContext: SkillContext
  availableCategories: AvailableCategory[]
}): ToolRegistryResult {
  const { ctx, pluginConfig, managers, skillContext, availableCategories } = args

  const isMultimodalLookerEnabled = !(pluginConfig.disabled_agents ?? []).some(
    (agent) => agent.toLowerCase() === "multimodal-looker",
  )
  const lookAt = isMultimodalLookerEnabled ? createLookAt(ctx) : null

  const delegateTask = createDelegateTask({
    manager: managers.backgroundManager,
    client: ctx.client,
    directory: ctx.directory,
    userCategories: pluginConfig.categories,
    agentOverrides: pluginConfig.agents,
    gitMasterConfig: pluginConfig.git_master,
    sisyphusJuniorModel: pluginConfig.agents?.["sisyphus-junior"]?.model,
    browserProvider: skillContext.browserProvider,
    disabledSkills: skillContext.disabledSkills,
    availableCategories,
    availableSkills: skillContext.availableSkills,
    syncPollTimeoutMs: pluginConfig.background_task?.syncPollTimeoutMs,
    onSyncSessionCreated: async (event) => {
      log("[index] onSyncSessionCreated callback", {
        sessionID: event.sessionID,
        parentID: event.parentID,
        title: event.title,
      })
      await managers.tmuxSessionManager.onSessionCreated({
        type: "session.created",
        properties: {
          info: {
            id: event.sessionID,
            parentID: event.parentID,
            title: event.title,
          },
        },
      })
    },
  })

  const taskSystemEnabled = pluginConfig.experimental?.task_system ?? false

  const hashlineEnabled = pluginConfig.hashline_edit ?? false
  const hashlineToolsRecord: Record<string, ToolDefinition> = hashlineEnabled
    ? { edit: createHashlineEditTool() }
    : {}

  const allTools: Record<string, ToolDefinition> = {
    ...(lookAt ? { look_at: lookAt } : {}),
    task: delegateTask,
    interactive_bash,
    ...hashlineToolsRecord,
  }

  // Register all plugin tools into CapabilityRegistry, marking disabled ones as unavailable
  const disabledSet = new Set(pluginConfig.disabled_tools ?? [])
  CapabilityRegistry.registerAll(
    Object.keys(allTools).map((id) => ({
      ...fromPluginTool(id),
      available: !disabledSet.has(id),
    })),
  )

  return {
    filteredTools: allTools,
    taskSystemEnabled,
  }
}
