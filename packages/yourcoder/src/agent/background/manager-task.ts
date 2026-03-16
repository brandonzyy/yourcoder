import { subagentSessions } from "../../session/state"
import { SessionCategoryRegistry } from "../../session/session-category-registry"
import { log } from "../../util/logger"
import { getTaskToastManager } from "../../cli/toast"
import type { ConcurrencyManager } from "./concurrency"
import type { YcClient } from "./constants"
import type { TaskHistory } from "./task-history"
import type { BackgroundTask } from "./types"
import {
  cleanupPendingByParent,
  clearNotificationsForTask,
  enqueueNotificationForParent,
  markForNotification,
} from "./manager-notification"

export async function cancelTask(args: {
  taskId: string
  tasks: Map<string, BackgroundTask>
  notifications: Map<string, BackgroundTask[]>
  pendingByParent: Map<string, Set<string>>
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  queuesByKey: Map<string, Array<{ task: BackgroundTask }>>
  client: YcClient
  concurrencyManager: ConcurrencyManager
  taskHistory: TaskHistory
  notifyParentSession: (task: BackgroundTask) => Promise<void>
  notificationQueueByParent: Map<string, Promise<void>>
  options?: { source?: string; reason?: string; abortSession?: boolean; skipNotification?: boolean }
}): Promise<boolean> {
  const task = args.tasks.get(args.taskId)
  if (!task || (task.status !== "running" && task.status !== "pending")) {
    return false
  }

  const source = args.options?.source ?? "cancel"
  const abortSession = args.options?.abortSession !== false

  if (task.status === "pending") {
    const key = task.model ? `${task.model.providerID}/${task.model.modelID}` : task.agent
    const queue = args.queuesByKey.get(key)
    const index = queue?.findIndex((item) => item.task.id === args.taskId) ?? -1
    if (queue && index !== -1) {
      queue.splice(index, 1)
      if (queue.length === 0) {
        args.queuesByKey.delete(key)
      }
    }
    log("[background-agent] Cancelled pending task:", { taskId: args.taskId, key })
  }

  task.status = "cancelled"
  task.completedAt = new Date()
  if (args.options?.reason) {
    task.error = args.options.reason
  }
  args.taskHistory.record(task.parentSessionID, {
    id: task.id,
    sessionID: task.sessionID,
    agent: task.agent,
    description: task.description,
    status: "cancelled",
    category: task.category,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  })

  if (task.concurrencyKey) {
    args.concurrencyManager.release(task.concurrencyKey)
    task.concurrencyKey = undefined
  }

  const complete = args.completionTimers.get(task.id)
  if (complete) {
    clearTimeout(complete)
    args.completionTimers.delete(task.id)
  }

  const idle = args.idleDeferralTimers.get(task.id)
  if (idle) {
    clearTimeout(idle)
    args.idleDeferralTimers.delete(task.id)
  }

  cleanupPendingByParent(args.pendingByParent, task)

  if (abortSession && task.sessionID) {
    args.client.session
      .abort({
        path: { id: task.sessionID },
      })
      .catch(() => {})
    SessionCategoryRegistry.remove(task.sessionID)
  }

  if (args.options?.skipNotification) {
    getTaskToastManager()?.removeTask(task.id)
    log(`[background-agent] Task cancelled via ${source} (notification skipped):`, task.id)
    return true
  }

  markForNotification(args.notifications, task)

  try {
    await enqueueNotificationForParent(args.notificationQueueByParent, task.parentSessionID, () =>
      args.notifyParentSession(task),
    )
    log(`[background-agent] Task cancelled via ${source}:`, task.id)
  } catch (error) {
    log("[background-agent] Error in notifyParentSession for cancelled task:", {
      taskId: task.id,
      error,
    })
  }

  return true
}

export async function tryCompleteTask(args: {
  task: BackgroundTask
  source: string
  notifications: Map<string, BackgroundTask[]>
  pendingByParent: Map<string, Set<string>>
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  client: YcClient
  concurrencyManager: ConcurrencyManager
  taskHistory: TaskHistory
  notifyParentSession: (task: BackgroundTask) => Promise<void>
  notificationQueueByParent: Map<string, Promise<void>>
}): Promise<boolean> {
  const { task } = args
  if (task.status !== "running") {
    log("[background-agent] Task already completed, skipping:", {
      taskId: task.id,
      status: task.status,
      source: args.source,
    })
    return false
  }

  task.status = "completed"
  task.completedAt = new Date()
  args.taskHistory.record(task.parentSessionID, {
    id: task.id,
    sessionID: task.sessionID,
    agent: task.agent,
    description: task.description,
    status: "completed",
    category: task.category,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
  })

  if (task.concurrencyKey) {
    args.concurrencyManager.release(task.concurrencyKey)
    task.concurrencyKey = undefined
  }

  markForNotification(args.notifications, task)
  cleanupPendingByParent(args.pendingByParent, task)

  const idle = args.idleDeferralTimers.get(task.id)
  if (idle) {
    clearTimeout(idle)
    args.idleDeferralTimers.delete(task.id)
  }

  if (task.sessionID) {
    args.client.session
      .abort({
        path: { id: task.sessionID },
      })
      .catch(() => {})
    SessionCategoryRegistry.remove(task.sessionID)
  }

  try {
    await enqueueNotificationForParent(args.notificationQueueByParent, task.parentSessionID, () =>
      args.notifyParentSession(task),
    )
    log(`[background-agent] Task completed via ${args.source}:`, task.id)
  } catch (error) {
    log("[background-agent] Error in notifyParentSession:", { taskId: task.id, error })
  }

  return true
}

export function removeTaskArtifacts(args: {
  task: BackgroundTask
  tasks: Map<string, BackgroundTask>
  notifications: Map<string, BackgroundTask[]>
  pendingByParent: Map<string, Set<string>>
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
}): void {
  const complete = args.completionTimers.get(args.task.id)
  if (complete) {
    clearTimeout(complete)
    args.completionTimers.delete(args.task.id)
  }

  const idle = args.idleDeferralTimers.get(args.task.id)
  if (idle) {
    clearTimeout(idle)
    args.idleDeferralTimers.delete(args.task.id)
  }

  cleanupPendingByParent(args.pendingByParent, args.task)
  args.tasks.delete(args.task.id)
  clearNotificationsForTask(args.notifications, args.task.id)
  getTaskToastManager()?.removeTask(args.task.id)
  if (args.task.sessionID) {
    subagentSessions.delete(args.task.sessionID)
  }
}
