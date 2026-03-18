import type { PluginConfig, HookName } from "../../../config/plugin-schema"
import {
  createAnthropicContextWindowLimitRecoveryHook,
  createAutoUpdateCheckerHook,
  createContextWindowMonitorHook,
  createDelegateTaskRetryHook,
  createEditErrorRecoveryHook,
  createInteractiveBashSessionHook,
  createModelFallbackHook,
  createNoYcGptHook,
  createNonInteractiveEnvHook,
  createPreemptiveCompactionHook,
  createQuestionLabelTruncatorHook,
  createRalphLoopHook,
  createRuntimeFallbackHook,
  createSessionNotification,
  createSessionRecoveryHook,
  createStartWorkHook,
  createTaskResumeInfoHook,
  createThinkModeHook,
} from "../../../hooks"
import { createAnthropicEffortHook } from "../../../model-switching/anthropic-effort"
import { normalizeSDKResponse } from "../../../model/normalize"
import { log } from "../../../util/logger"
import type { ModelCacheState } from "../../plugin-state"
import { detectExternalNotificationPlugin, getNotificationConflictWarning } from "../../external-plugin-detector"
import type { PluginContext } from "../types"
import { mount } from "./mount"

type Args = {
  ctx: PluginContext
  pluginConfig: PluginConfig
  modelCacheState: ModelCacheState
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
}

type Applied = (input: {
  sessionID: string
  providerID: string
  modelID: string
  variant?: string
}) => void | Promise<void>

export type SessionHooks = {
  contextWindowMonitor: ReturnType<typeof createContextWindowMonitorHook> | null
  preemptiveCompaction: ReturnType<typeof createPreemptiveCompactionHook> | null
  sessionRecovery: ReturnType<typeof createSessionRecoveryHook> | null
  sessionNotification: ReturnType<typeof createSessionNotification> | null
  thinkMode: ReturnType<typeof createThinkModeHook> | null
  modelFallback: ReturnType<typeof createModelFallbackHook> | null
  anthropicContextWindowLimitRecovery: ReturnType<typeof createAnthropicContextWindowLimitRecoveryHook> | null
  autoUpdateChecker: ReturnType<typeof createAutoUpdateCheckerHook> | null
  nonInteractiveEnv: ReturnType<typeof createNonInteractiveEnvHook> | null
  interactiveBashSession: ReturnType<typeof createInteractiveBashSessionHook> | null
  ralphLoop: ReturnType<typeof createRalphLoopHook> | null
  editErrorRecovery: ReturnType<typeof createEditErrorRecoveryHook> | null
  delegateTaskRetry: ReturnType<typeof createDelegateTaskRetryHook> | null
  startWork: ReturnType<typeof createStartWorkHook> | null
  noYcGpt: ReturnType<typeof createNoYcGptHook> | null
  questionLabelTruncator: ReturnType<typeof createQuestionLabelTruncatorHook> | null
  taskResumeInfo: ReturnType<typeof createTaskResumeInfoHook> | null
  anthropicEffort: ReturnType<typeof createAnthropicEffortHook> | null
  runtimeFallback: ReturnType<typeof createRuntimeFallbackHook> | null
}

function title(args: Pick<Args, "ctx" | "pluginConfig">) {
  if (!args.pluginConfig.experimental?.model_fallback_title) {
    return
  }

  const seen = new Map<string, { base?: string; last?: string }>()

  return async (input: {
    sessionID: string
    providerID: string
    modelID: string
    variant?: string
  }) => {
    const key = `${input.providerID}/${input.modelID}${input.variant ? `:${input.variant}` : ""}`
    const item = seen.get(input.sessionID) ?? {}
    if (item.last === key) {
      return
    }

    if (!item.base) {
      const session = await args.ctx.client.session.get({ path: { id: input.sessionID } }).catch(() => null)
      const info = session
        ? normalizeSDKResponse(session, null as { title?: string } | null, { preferResponseOnMissingData: true })
        : null
      const raw = info?.title
      item.base = typeof raw === "string" && raw.length > 0
        ? raw.replace(/\s*\[fallback:[^\]]+\]$/i, "").trim()
        : "Session"
    }

    const next = `${item.base} [fallback: ${input.providerID}/${input.modelID}${input.variant ? ` ${input.variant}` : ""}]`

    await args.ctx.client.session.update({
      path: { id: input.sessionID },
      body: { title: next },
      query: { directory: args.ctx.directory },
    }).catch(() => {})

    item.last = key
    seen.set(input.sessionID, item)
    if (seen.size > 200) {
      const first = seen.keys().next().value
      if (first) {
        seen.delete(first)
      }
    }
  }
}

function notify(args: Pick<Args, "ctx" | "pluginConfig" | "isHookEnabled" | "safeHookEnabled">) {
  if (!args.isHookEnabled("session-notification")) {
    return null
  }

  const force = args.pluginConfig.notification?.force_enable ?? false
  const item = detectExternalNotificationPlugin(args.ctx.directory)
  if (item.detected && !force) {
    log(getNotificationConflictWarning(item.pluginName!))
    return null
  }

  return mount("session-notification", true, args.safeHookEnabled, () => createSessionNotification(args.ctx))
}

function core(args: Args) {
  return {
    contextWindowMonitor: mount("context-window-monitor", args.isHookEnabled("context-window-monitor"), args.safeHookEnabled, () =>
      createContextWindowMonitorHook(args.ctx, args.modelCacheState)),
    preemptiveCompaction: mount(
      "preemptive-compaction",
      args.isHookEnabled("preemptive-compaction") && !!args.pluginConfig.experimental?.preemptive_compaction,
      args.safeHookEnabled,
      () => createPreemptiveCompactionHook(args.ctx, args.pluginConfig, args.modelCacheState),
    ),
    thinkMode: mount("think-mode", args.isHookEnabled("think-mode"), args.safeHookEnabled, () => createThinkModeHook()),
    nonInteractiveEnv: mount("non-interactive-env", args.isHookEnabled("non-interactive-env"), args.safeHookEnabled, () =>
      createNonInteractiveEnvHook(args.ctx)),
    interactiveBashSession: mount("interactive-bash-session", args.isHookEnabled("interactive-bash-session"), args.safeHookEnabled, () =>
      createInteractiveBashSessionHook(args.ctx)),
    anthropicEffort: mount("anthropic-effort", args.isHookEnabled("anthropic-effort"), args.safeHookEnabled, () =>
      createAnthropicEffortHook()),
  }
}

function guard(args: Args, onApplied?: Applied) {
  const cfg =
    typeof args.pluginConfig.runtime_fallback === "boolean"
      ? { enabled: args.pluginConfig.runtime_fallback }
      : args.pluginConfig.runtime_fallback

  return {
    sessionRecovery: mount("session-recovery", args.isHookEnabled("session-recovery"), args.safeHookEnabled, () =>
      createSessionRecoveryHook(args.ctx, { experimental: args.pluginConfig.experimental })),
    modelFallback: mount(
      "model-fallback",
      (args.pluginConfig.model_fallback ?? false) && args.isHookEnabled("model-fallback"),
      args.safeHookEnabled,
      () =>
        createModelFallbackHook({
          toast: async ({ title, message, variant, duration }) => {
            await args.ctx.client.tui.showToast({
              body: {
                title,
                message,
                variant: variant ?? "warning",
                duration: duration ?? 5000,
              },
            }).catch(() => {})
          },
          onApplied,
        }),
    ),
    anthropicContextWindowLimitRecovery: mount(
      "anthropic-context-window-limit-recovery",
      args.isHookEnabled("anthropic-context-window-limit-recovery"),
      args.safeHookEnabled,
      () => createAnthropicContextWindowLimitRecoveryHook(args.ctx, { experimental: args.pluginConfig.experimental, pluginConfig: args.pluginConfig }),
    ),
    editErrorRecovery: mount("edit-error-recovery", args.isHookEnabled("edit-error-recovery"), args.safeHookEnabled, () =>
      createEditErrorRecoveryHook(args.ctx)),
    delegateTaskRetry: mount("delegate-task-retry", args.isHookEnabled("delegate-task-retry"), args.safeHookEnabled, () =>
      createDelegateTaskRetryHook(args.ctx)),
    runtimeFallback: mount("runtime-fallback", args.isHookEnabled("runtime-fallback"), args.safeHookEnabled, () =>
      createRuntimeFallbackHook(args.ctx, {
        config: cfg,
        pluginConfig: args.pluginConfig,
      })),
  }
}

function ux(args: Args) {
  return {
    sessionNotification: notify(args),
    autoUpdateChecker: mount("auto-update-checker", args.isHookEnabled("auto-update-checker"), args.safeHookEnabled, () =>
      createAutoUpdateCheckerHook(args.ctx, {
        showStartupToast: args.isHookEnabled("startup-toast"),
        isYcEnabled: args.pluginConfig.yc_agent?.disabled !== true,
        autoUpdate: args.pluginConfig.auto_update ?? true,
      })),
    ralphLoop: mount("ralph-loop", args.isHookEnabled("ralph-loop"), args.safeHookEnabled, () =>
      createRalphLoopHook(args.ctx, {
        config: args.pluginConfig.ralph_loop,
        checkSessionExists: async (_sessionId) => false,
      })),
    startWork: mount("start-work", args.isHookEnabled("start-work"), args.safeHookEnabled, () => createStartWorkHook(args.ctx)),
    noYcGpt: mount("no-yc-gpt", args.isHookEnabled("no-yc-gpt"), args.safeHookEnabled, () =>
      createNoYcGptHook(args.ctx)),
    questionLabelTruncator: mount("question-label-truncator", args.isHookEnabled("question-label-truncator"), args.safeHookEnabled, () =>
      createQuestionLabelTruncatorHook()),
    taskResumeInfo: mount("task-resume-info", args.isHookEnabled("task-resume-info"), args.safeHookEnabled, () =>
      createTaskResumeInfoHook()),
  }
}

export function createSessionHooks(args: Args): SessionHooks {
  return {
    ...core(args),
    ...guard(args, title(args)),
    ...ux(args),
  }
}
