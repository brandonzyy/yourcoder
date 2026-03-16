import { SessionCategoryRegistry } from "../../session/session-category-registry"
import { subagentSessions } from "../../session/state"
import { log } from "../../util/logger"
import { getTaskToastManager } from "../../cli/toast"
import { hasMoreFallbacks, shouldRetryError } from "../../model/model-error-classifier"
import { extractErrorMessage, extractErrorName, getSessionErrorMessage } from "./error-classifier"
import { handleSessionIdleBackgroundEvent } from "./session-idle-event-handler"
import type { BackgroundEvent, MessagePartInfo } from "./constants"
import type { TaskHistory } from "./task-history"
import type { BackgroundTask } from "./types"
import { cleanupPendingByParent, clearNotificationsForTask } from "./manager-notification"
import { removeTaskArtifacts } from "./manager-task"
import type { ConcurrencyManager } from "./concurrency"

export function handleEvent(args: {
  event: BackgroundEvent
  tasks: Map<string, BackgroundTask>
  notifications: Map<string, BackgroundTask[]>
  pendingNotifications: Map<string, string[]>
  pendingByParent: Map<string, Set<string>>
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  taskHistory: TaskHistory
  concurrencyManager: ConcurrencyManager
  findBySession: (sessionID: string) => BackgroundTask | undefined
  getAllDescendantTasks: (sessionID: string) => BackgroundTask[]
  validateSessionHasOutput: (sessionID: string) => Promise<boolean>
  checkSessionTodos: (sessionID: string) => Promise<boolean>
  tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
  cancelTask: (
    taskId: string,
    options?: { source?: string; reason?: string; abortSession?: boolean; skipNotification?: boolean },
  ) => Promise<boolean>
  tryFallbackRetry: (task: BackgroundTask, errorInfo: { name?: string; message?: string }, source: string) => boolean
}): void {
  const { event, tasks, notifications, pendingNotifications, pendingByParent, completionTimers, idleDeferralTimers } =
    args
  const props = event.properties

  if (event.type === "message.updated") {
    const info = props?.info
    if (!info || typeof info !== "object") {
      return
    }

    const sessionID = (info as Record<string, unknown>).sessionID
    const role = (info as Record<string, unknown>).role
    if (typeof sessionID !== "string" || role !== "assistant") {
      return
    }

    const task = args.findBySession(sessionID)
    if (!task || task.status !== "running") {
      return
    }

    const error = (info as Record<string, unknown>).error
    if (!error) {
      return
    }

    args.tryFallbackRetry(
      task,
      {
        name: extractErrorName(error),
        message: extractErrorMessage(error),
      },
      "message.updated",
    )
  }

  if (event.type === "message.part.updated" || event.type === "message.part.delta") {
    if (!props || typeof props !== "object" || !("sessionID" in props)) {
      return
    }

    const info = props as MessagePartInfo
    const sessionID = info.sessionID
    if (!sessionID) {
      return
    }

    const task = args.findBySession(sessionID)
    if (!task) {
      return
    }

    const timer = idleDeferralTimers.get(task.id)
    if (timer) {
      clearTimeout(timer)
      idleDeferralTimers.delete(task.id)
    }

    task.progress = {
      toolCalls: task.progress?.toolCalls ?? 0,
      lastUpdate: new Date(),
      ...(task.progress?.lastTool ? { lastTool: task.progress.lastTool } : {}),
    }

    if (info.type === "tool" || info.tool) {
      task.progress.toolCalls += 1
      task.progress.lastTool = info.tool
    }
  }

  if (event.type === "session.idle") {
    if (!props || typeof props !== "object") {
      return
    }

    handleSessionIdleBackgroundEvent({
      properties: props as Record<string, unknown>,
      findBySession: args.findBySession,
      idleDeferralTimers,
      validateSessionHasOutput: args.validateSessionHasOutput,
      checkSessionTodos: args.checkSessionTodos,
      tryCompleteTask: args.tryCompleteTask,
      emitIdleEvent: (sessionID) =>
        handleEvent({
          ...args,
          event: { type: "session.idle", properties: { sessionID } },
        }),
    })
  }

  if (event.type === "session.error") {
    const sessionID = typeof props?.sessionID === "string" ? props.sessionID : undefined
    if (!sessionID) {
      return
    }

    const task = args.findBySession(sessionID)
    if (!task || task.status !== "running") {
      return
    }

    const obj = props?.error as { name?: string; message?: string } | undefined
    const info = {
      name: obj?.name,
      message: props ? getSessionErrorMessage(props) : undefined,
    }
    if (args.tryFallbackRetry(task, info, "session.error")) {
      return
    }

    const msg = info.message ?? "Session error"
    log("[background-agent] Session error - no retry:", {
      taskId: task.id,
      errorName: info.name,
      errorMessage: msg.slice(0, 100),
      hasFallbackChain: !!task.fallbackChain,
      canRetry:
        shouldRetryError(info) && !!task.fallbackChain && hasMoreFallbacks(task.fallbackChain, task.attemptCount ?? 0),
    })

    task.status = "error"
    task.error = msg
    task.completedAt = new Date()
    args.taskHistory.record(task.parentSessionID, {
      id: task.id,
      sessionID: task.sessionID,
      agent: task.agent,
      description: task.description,
      status: "error",
      category: task.category,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    })

    if (task.concurrencyKey) {
      args.concurrencyManager.release(task.concurrencyKey)
      cleanupPendingByParent(pendingByParent, task)
      task.concurrencyKey = undefined
    }

    tasks.delete(task.id)
    clearNotificationsForTask(notifications, task.id)
    getTaskToastManager()?.removeTask(task.id)
    if (task.sessionID) {
      subagentSessions.delete(task.sessionID)
    }
  }

  if (event.type === "session.deleted") {
    const info = props?.info
    if (!info || typeof info.id !== "string") {
      return
    }

    const sessionID = info.id
    const items = new Map<string, BackgroundTask>()
    const direct = args.findBySession(sessionID)
    if (direct) {
      items.set(direct.id, direct)
    }

    for (const item of args.getAllDescendantTasks(sessionID)) {
      items.set(item.id, item)
    }

    pendingNotifications.delete(sessionID)
    if (items.size === 0) {
      return
    }

    for (const task of items.values()) {
      if (task.status === "running" || task.status === "pending") {
        void args
          .cancelTask(task.id, {
            source: "session.deleted",
            reason: "Session deleted",
            skipNotification: true,
          })
          .catch((error) => {
            log("[background-agent] Failed to cancel task on session.deleted:", {
              taskId: task.id,
              error,
            })
          })
      }

      removeTaskArtifacts({
        task,
        tasks,
        notifications,
        pendingByParent,
        completionTimers,
        idleDeferralTimers,
      })
    }

    for (const task of items.values()) {
      pendingNotifications.delete(task.parentSessionID)
    }

    SessionCategoryRegistry.remove(sessionID)
  }

  if (event.type === "session.status") {
    const sessionID = typeof props?.sessionID === "string" ? props.sessionID : undefined
    const status = props?.status as { type?: string; message?: string } | undefined
    if (!sessionID || status?.type !== "retry") {
      return
    }

    const task = args.findBySession(sessionID)
    if (!task || task.status !== "running") {
      return
    }

    args.tryFallbackRetry(
      task,
      {
        name: "SessionRetry",
        message: typeof status.message === "string" ? status.message : undefined,
      },
      "session.status",
    )
  }
}
