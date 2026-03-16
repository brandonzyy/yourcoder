import type { HookName, PluginConfig } from "../../../config/plugin-schema"
import type { BackgroundManager } from "../../../agent/background"
import type { PluginContext } from "../types"

import {
  createTodoContinuationEnforcer,
  createBackgroundNotificationHook,
  createStopContinuationGuardHook,
  createCompactionContextInjector,
  createCompactionTodoPreserverHook,
} from "../../../hooks"
import { mount } from "./mount"
import { createUnstableAgentBabysitter } from "../unstable-agent-babysitter"

export type ContinuationHooks = {
  stopContinuationGuard: ReturnType<typeof createStopContinuationGuardHook> | null
  compactionContextInjector: ReturnType<typeof createCompactionContextInjector> | null
  compactionTodoPreserver: ReturnType<typeof createCompactionTodoPreserverHook> | null
  todoContinuationEnforcer: ReturnType<typeof createTodoContinuationEnforcer> | null
  unstableAgentBabysitter: ReturnType<typeof createUnstableAgentBabysitter> | null
  backgroundNotificationHook: ReturnType<typeof createBackgroundNotificationHook> | null
}

type SessionRecovery = {
  setOnAbortCallback: (callback: (sessionID: string) => void) => void
  setOnRecoveryCompleteCallback: (callback: (sessionID: string) => void) => void
} | null

export function createContinuationHooks(args: {
  ctx: PluginContext
  pluginConfig: PluginConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  backgroundManager: BackgroundManager
  sessionRecovery: SessionRecovery
}): ContinuationHooks {
  const {
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    backgroundManager,
    sessionRecovery,
  } = args
  const stopContinuationGuard = mount("stop-continuation-guard", isHookEnabled("stop-continuation-guard"), safeHookEnabled, () =>
    createStopContinuationGuardHook(ctx, {
      backgroundManager,
    }))

  const compactionContextInjector = mount("compaction-context-injector", isHookEnabled("compaction-context-injector"), safeHookEnabled, () =>
    createCompactionContextInjector(backgroundManager))

  const compactionTodoPreserver = mount("compaction-todo-preserver", isHookEnabled("compaction-todo-preserver"), safeHookEnabled, () =>
    createCompactionTodoPreserverHook(ctx))

  const todoContinuationEnforcer = mount("todo-continuation-enforcer", isHookEnabled("todo-continuation-enforcer"), safeHookEnabled, () =>
    createTodoContinuationEnforcer(ctx, {
      backgroundManager,
      isContinuationStopped: stopContinuationGuard?.isStopped,
    }))

  const unstableAgentBabysitter = mount("unstable-agent-babysitter", isHookEnabled("unstable-agent-babysitter"), safeHookEnabled, () =>
    createUnstableAgentBabysitter({ ctx, backgroundManager, pluginConfig }))

  if (sessionRecovery) {
    const onAbortCallbacks: Array<(sessionID: string) => void> = []
    const onRecoveryCompleteCallbacks: Array<(sessionID: string) => void> = []

    if (todoContinuationEnforcer) {
      onAbortCallbacks.push(todoContinuationEnforcer.markRecovering)
      onRecoveryCompleteCallbacks.push(todoContinuationEnforcer.markRecoveryComplete)
    }


    if (onAbortCallbacks.length > 0) {
      sessionRecovery.setOnAbortCallback((sessionID: string) => {
        for (const callback of onAbortCallbacks) callback(sessionID)
      })
    }

    if (onRecoveryCompleteCallbacks.length > 0) {
      sessionRecovery.setOnRecoveryCompleteCallback((sessionID: string) => {
        for (const callback of onRecoveryCompleteCallbacks) callback(sessionID)
      })
    }
  }

  const backgroundNotificationHook = mount("background-notification", isHookEnabled("background-notification"), safeHookEnabled, () =>
    createBackgroundNotificationHook(backgroundManager))

  return {
    stopContinuationGuard,
    compactionContextInjector,
    compactionTodoPreserver,
    todoContinuationEnforcer,
    unstableAgentBabysitter,
    backgroundNotificationHook,
  }
}
