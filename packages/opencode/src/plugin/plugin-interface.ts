import type { PluginContext, PluginInterface, ToolsRecord } from "./handlers/types"
import type { PluginConfig } from "../config/plugin-config-types"

import { createChatParamsHandler } from "./handlers/chat-params"
import { createChatHeadersHandler } from "./handlers/chat-headers"
import { createChatMessageHandler } from "./handlers/chat-message"
import { createMessagesTransformHandler } from "./handlers/messages-transform"
import { createSystemTransformHandler } from "./handlers/system-transform"
import { createEventHandler } from "./handlers/event"
import { createToolExecuteAfterHandler } from "./handlers/tool-execute-after"
import { createToolExecuteBeforeHandler } from "./handlers/tool-execute-before"

import type { CreatedHooks } from "./create-hooks"
import type { Managers } from "./create-managers"

export function createPluginInterface(args: {
  ctx: PluginContext
  pluginConfig: PluginConfig
  firstMessageVariantGate: {
    shouldOverride: (sessionID: string) => boolean
    markApplied: (sessionID: string) => void
    markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void
    clear: (sessionID: string) => void
  }
  managers: Managers
  hooks: CreatedHooks
  tools: ToolsRecord
}): PluginInterface {
  const { ctx, pluginConfig, firstMessageVariantGate, managers, hooks, tools } =
    args

  return {
    tool: tools,

    "chat.params": async (input: unknown, output: unknown) => {
      const handler = createChatParamsHandler({ anthropicEffort: hooks.anthropicEffort })
      await handler(input, output)
    },

    "chat.headers": createChatHeadersHandler({ ctx }),

    "chat.message": createChatMessageHandler({
      ctx,
      pluginConfig,
      firstMessageVariantGate,
      hooks,
    }),

    "experimental.chat.messages.transform": createMessagesTransformHandler({
      hooks,
    }),

    "experimental.chat.system.transform": createSystemTransformHandler(),

    config: managers.configHandler,

    event: createEventHandler({
      ctx,
      pluginConfig,
      firstMessageVariantGate,
      managers,
      hooks,
    }),

    "tool.execute.before": createToolExecuteBeforeHandler({
      ctx,
      hooks,
    }),

    "tool.execute.after": createToolExecuteAfterHandler({
      ctx,
      hooks,
    }),
  }
}
