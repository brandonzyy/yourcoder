import type { HookName, PluginConfig } from "../../../config/plugin-schema"
import type { ModelCacheState } from "../../plugin-state"
import type { PluginContext } from "../types"

import {
  createCommentCheckerHooks,
  createToolOutputTruncatorHook,
  createDirectoryAgentsInjectorHook,
  createDirectoryReadmeInjectorHook,
  createEmptyTaskResponseDetectorHook,
  createRulesInjectorHook,
  createTasksTodowriteDisablerHook,
  createWriteExistingFileGuardHook,
  createHashlineReadEnhancerHook,
  createReadImageResizerHook,
  createJsonErrorRecoveryHook,
} from "../../../hooks"
import {
  getOpenCodeVersion,
  isOpenCodeVersionAtLeast,
  OPENCODE_NATIVE_AGENTS_INJECTION_VERSION,
} from "../../../config/opencode-version"
import { log } from "../../../util/logger"
import { mount } from "./mount"

export type ToolGuardHooks = {
  commentChecker: ReturnType<typeof createCommentCheckerHooks> | null
  toolOutputTruncator: ReturnType<typeof createToolOutputTruncatorHook> | null
  directoryAgentsInjector: ReturnType<typeof createDirectoryAgentsInjectorHook> | null
  directoryReadmeInjector: ReturnType<typeof createDirectoryReadmeInjectorHook> | null
  emptyTaskResponseDetector: ReturnType<typeof createEmptyTaskResponseDetectorHook> | null
  rulesInjector: ReturnType<typeof createRulesInjectorHook> | null
  tasksTodowriteDisabler: ReturnType<typeof createTasksTodowriteDisablerHook> | null
  writeExistingFileGuard: ReturnType<typeof createWriteExistingFileGuardHook> | null
  hashlineReadEnhancer: ReturnType<typeof createHashlineReadEnhancerHook> | null
  jsonErrorRecovery: ReturnType<typeof createJsonErrorRecoveryHook> | null
  readImageResizer: ReturnType<typeof createReadImageResizerHook> | null
}

export function createToolGuardHooks(args: {
  ctx: PluginContext
  pluginConfig: PluginConfig
  modelCacheState: ModelCacheState
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
}): ToolGuardHooks {
  const { ctx, pluginConfig, modelCacheState, isHookEnabled, safeHookEnabled } = args
  const commentChecker = mount("comment-checker", isHookEnabled("comment-checker"), safeHookEnabled, () =>
    createCommentCheckerHooks(pluginConfig.comment_checker))

  const toolOutputTruncator = mount("tool-output-truncator", isHookEnabled("tool-output-truncator"), safeHookEnabled, () =>
    createToolOutputTruncatorHook(ctx, {
      modelCacheState,
      experimental: pluginConfig.experimental,
    }))

  let directoryAgentsInjector: ReturnType<typeof createDirectoryAgentsInjectorHook> | null = null
  if (isHookEnabled("directory-agents-injector")) {
    const currentVersion = getOpenCodeVersion()
    const hasNativeSupport =
      currentVersion !== null && isOpenCodeVersionAtLeast(OPENCODE_NATIVE_AGENTS_INJECTION_VERSION)
    if (hasNativeSupport) {
      log("directory-agents-injector auto-disabled due to native OpenCode support", {
        currentVersion,
        nativeVersion: OPENCODE_NATIVE_AGENTS_INJECTION_VERSION,
      })
    } else {
      directoryAgentsInjector = mount("directory-agents-injector", true, safeHookEnabled, () =>
        createDirectoryAgentsInjectorHook(ctx, modelCacheState))
    }
  }

  const directoryReadmeInjector = mount("directory-readme-injector", isHookEnabled("directory-readme-injector"), safeHookEnabled, () =>
    createDirectoryReadmeInjectorHook(ctx, modelCacheState))

  const emptyTaskResponseDetector = mount("empty-task-response-detector", isHookEnabled("empty-task-response-detector"), safeHookEnabled, () =>
    createEmptyTaskResponseDetectorHook(ctx))

  const rulesInjector = mount("rules-injector", isHookEnabled("rules-injector"), safeHookEnabled, () =>
    createRulesInjectorHook(ctx, modelCacheState))

  const tasksTodowriteDisabler = mount("tasks-todowrite-disabler", isHookEnabled("tasks-todowrite-disabler"), safeHookEnabled, () =>
    createTasksTodowriteDisablerHook({ experimental: pluginConfig.experimental }))

  const writeExistingFileGuard = mount("write-existing-file-guard", isHookEnabled("write-existing-file-guard"), safeHookEnabled, () =>
    createWriteExistingFileGuardHook(ctx))

  const hashlineReadEnhancer = mount("hashline-read-enhancer", isHookEnabled("hashline-read-enhancer"), safeHookEnabled, () =>
    createHashlineReadEnhancerHook(ctx, { hashline_edit: { enabled: pluginConfig.hashline_edit ?? false } }))

  const jsonErrorRecovery = mount("json-error-recovery", isHookEnabled("json-error-recovery"), safeHookEnabled, () =>
    createJsonErrorRecoveryHook(ctx))

  const readImageResizer = mount("read-image-resizer", isHookEnabled("read-image-resizer"), safeHookEnabled, () =>
    createReadImageResizerHook(ctx))

  return {
    commentChecker,
    toolOutputTruncator,
    directoryAgentsInjector,
    directoryReadmeInjector,
    emptyTaskResponseDetector,
    rulesInjector,
    tasksTodowriteDisabler,
    writeExistingFileGuard,
    hashlineReadEnhancer,
    jsonErrorRecovery,
    readImageResizer,
  }
}
