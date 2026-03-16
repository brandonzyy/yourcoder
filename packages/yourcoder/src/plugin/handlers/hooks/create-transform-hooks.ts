import type { PluginConfig } from "../../../config/plugin-schema"
import type { PluginContext } from "../types"

import {
  createClaudeCodeHooksHook,
  createKeywordDetectorHook,
  createThinkingBlockValidatorHook,
} from "../../../hooks"
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
} from "../../../hooks/context-injection/context-injector"
import { mount } from "./mount"

export type TransformHooks = {
  claudeCodeHooks: ReturnType<typeof createClaudeCodeHooksHook> | null
  keywordDetector: ReturnType<typeof createKeywordDetectorHook> | null
  contextInjectorMessagesTransform: ReturnType<typeof createContextInjectorMessagesTransformHook>
  thinkingBlockValidator: ReturnType<typeof createThinkingBlockValidatorHook> | null
}

export function createTransformHooks(args: {
  ctx: PluginContext
  pluginConfig: PluginConfig
  isHookEnabled: (hookName: string) => boolean
  safeHookEnabled?: boolean
}): TransformHooks {
  const { ctx, pluginConfig, isHookEnabled } = args
  const safeHookEnabled = args.safeHookEnabled ?? true

  const claudeCodeHooks = mount("claude-code-hooks", isHookEnabled("claude-code-hooks"), safeHookEnabled, () =>
    createClaudeCodeHooksHook(
      ctx,
      {
        disabledHooks: (pluginConfig.claude_code?.hooks ?? true) ? undefined : true,
        keywordDetectorDisabled: !isHookEnabled("keyword-detector"),
      },
      contextCollector,
    ))

  const keywordDetector = mount("keyword-detector", isHookEnabled("keyword-detector"), safeHookEnabled, () =>
    createKeywordDetectorHook(ctx, contextCollector))

  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector)

  const thinkingBlockValidator = mount("thinking-block-validator", isHookEnabled("thinking-block-validator"), safeHookEnabled, () =>
    createThinkingBlockValidatorHook())

  return {
    claudeCodeHooks,
    keywordDetector,
    contextInjectorMessagesTransform,
    thinkingBlockValidator,
  }
}
