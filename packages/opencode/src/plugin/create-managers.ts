import type { PluginConfig } from "../config/plugin-schema"
import type { ModelCacheState } from "./plugin-state"
import type { PluginContext, TmuxConfig } from "./handlers/types"

import type { SubagentSessionCreatedEvent } from "../agent/background"
import { BackgroundManager } from "../agent/background"
import { initTaskToastManager } from "../cli/toast"
import { TmuxSessionManager } from "../tool/interactive-bash/tmux"
import { createConfigHandler } from "./config-handler-stub"
import { log } from "../util/logger"

export type Managers = {
  tmuxSessionManager: TmuxSessionManager
  backgroundManager: BackgroundManager
  configHandler: ReturnType<typeof createConfigHandler>
}

export function createManagers(args: {
  ctx: PluginContext
  pluginConfig: PluginConfig
  tmuxConfig: TmuxConfig
  modelCacheState: ModelCacheState
  backgroundNotificationHookEnabled: boolean
}): Managers {
  const { ctx, pluginConfig, tmuxConfig, modelCacheState, backgroundNotificationHookEnabled } = args

  const tmuxSessionManager = new TmuxSessionManager(ctx, tmuxConfig)

  const backgroundManager = new BackgroundManager(
    ctx,
    pluginConfig.background_task,
    {
      tmuxConfig,
		onSubagentSessionCreated: async (event: SubagentSessionCreatedEvent) => {
			log("[index] onSubagentSessionCreated callback received", {
				sessionID: event.sessionID,
				parentID: event.parentID,
          title: event.title,
        })

        await tmuxSessionManager.onSessionCreated({
          type: "session.created",
          properties: {
            info: {
              id: event.sessionID,
              parentID: event.parentID,
              title: event.title,
            },
          },
        })

        log("[index] onSubagentSessionCreated callback completed")
      },
      onShutdown: () => {
        tmuxSessionManager.cleanup().catch((error) => {
          log("[index] tmux cleanup error during shutdown:", error)
        })
      },
      enableParentSessionNotifications: backgroundNotificationHookEnabled,
    },
  )

  initTaskToastManager(ctx.client)

  const configHandler = createConfigHandler({
    ctx: { directory: ctx.directory, client: ctx.client },
    pluginConfig,
    modelCacheState,
  })

  return {
    tmuxSessionManager,
    backgroundManager,
    configHandler,
  }
}
