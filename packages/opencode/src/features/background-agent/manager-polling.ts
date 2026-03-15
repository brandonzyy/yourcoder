import { SessionCategoryRegistry } from "../../session/session-category-registry"
import { subagentSessions } from "../../session/state"
import { log } from "../../util/logger"
import { getTaskToastManager } from "../task-toast-manager"
import type { BackgroundTaskConfig } from "../../config/plugin-schema"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient } from "./constants"
import type { BackgroundTask } from "./types"
import { checkAndInterruptStaleTasks, pruneStaleTasksAndNotifications } from "./task-poller"
import { cleanupPendingByParent, clearNotificationsForTask } from "./manager-notification"

export function pruneTasksAndNotifications(args: {
  tasks: Map<string, BackgroundTask>
  notifications: Map<string, BackgroundTask[]>
  pendingByParent: Map<string, Set<string>>
  queuesByKey: Map<string, Array<{ task: BackgroundTask }>>
  concurrencyManager: ConcurrencyManager
}): void {
  pruneStaleTasksAndNotifications({
    tasks: args.tasks,
    notifications: args.notifications,
    onTaskPruned: (taskId, task, error) => {
      const pending = task.status === "pending"
      log("[background-agent] Pruning stale task:", { taskId, status: task.status })
      task.status = "error"
      task.error = error
      task.completedAt = new Date()

      if (task.concurrencyKey) {
        args.concurrencyManager.release(task.concurrencyKey)
        task.concurrencyKey = undefined
      }

      cleanupPendingByParent(args.pendingByParent, task)
      if (pending) {
        const key = task.model ? `${task.model.providerID}/${task.model.modelID}` : task.agent
        const queue = args.queuesByKey.get(key)
        const index = queue?.findIndex((item) => item.task.id === taskId) ?? -1
        if (queue && index !== -1) {
          queue.splice(index, 1)
          if (queue.length === 0) {
            args.queuesByKey.delete(key)
          }
        }
      }

      clearNotificationsForTask(args.notifications, taskId)
      getTaskToastManager()?.removeTask(taskId)
      args.tasks.delete(taskId)
      if (task.sessionID) {
        subagentSessions.delete(task.sessionID)
        SessionCategoryRegistry.remove(task.sessionID)
      }
    },
  })
}

export async function checkAndInterruptTasks(args: {
  tasks: Map<string, BackgroundTask>
  client: OpencodeClient
  config?: BackgroundTaskConfig
  concurrencyManager: ConcurrencyManager
  notifyParentSession: (task: BackgroundTask) => Promise<void>
  statuses?: Record<string, { type: string }>
}): Promise<void> {
  await checkAndInterruptStaleTasks({
    tasks: args.tasks.values(),
    client: args.client,
    config: args.config,
    concurrencyManager: args.concurrencyManager,
    notifyParentSession: args.notifyParentSession,
    sessionStatuses: args.statuses,
  })
}

export async function pollRunningTasks(args: {
  tasks: Map<string, BackgroundTask>
  notifications: Map<string, BackgroundTask[]>
  pendingByParent: Map<string, Set<string>>
  queuesByKey: Map<string, Array<{ task: BackgroundTask }>>
  client: OpencodeClient
  config?: BackgroundTaskConfig
  concurrencyManager: ConcurrencyManager
  stopPolling: () => void
  hasRunningTasks: () => boolean
  validateSessionHasOutput: (sessionID: string) => Promise<boolean>
  checkSessionTodos: (sessionID: string) => Promise<boolean>
  tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
  tryFallbackRetry: (task: BackgroundTask, errorInfo: { name?: string; message?: string }, source: string) => boolean
  notifyParentSession: (task: BackgroundTask) => Promise<void>
}): Promise<void> {
  pruneTasksAndNotifications(args)

  if (!args.client.session.status) {
    if (!args.hasRunningTasks()) {
      args.stopPolling()
    }
    return
  }

  const result = await args.client.session.status()
  const all = result.data ?? {}

  await checkAndInterruptTasks({
    tasks: args.tasks,
    client: args.client,
    config: args.config,
    concurrencyManager: args.concurrencyManager,
    notifyParentSession: args.notifyParentSession,
    statuses: all,
  })

  for (const task of args.tasks.values()) {
    if (task.status !== "running" || !task.sessionID) {
      continue
    }

    try {
      const status = all[task.sessionID]
      if (status?.type === "idle") {
        if (!(await args.validateSessionHasOutput(task.sessionID))) {
          log("[background-agent] Polling idle but no valid output yet, waiting:", task.id)
          continue
        }

        if (task.status !== "running") {
          continue
        }

        if (await args.checkSessionTodos(task.sessionID)) {
          log("[background-agent] Task has incomplete todos via polling, waiting:", task.id)
          continue
        }

        await args.tryCompleteTask(task, "polling (idle status)")
        continue
      }

      if (
        status?.type === "retry" &&
        args.tryFallbackRetry(
          task,
          {
            name: "SessionRetry",
            message: typeof status.message === "string" ? status.message : undefined,
          },
          "polling:session.status",
        )
      ) {
        continue
      }

      log("[background-agent] Session still running, relying on event-based progress:", {
        taskId: task.id,
        sessionID: task.sessionID,
        sessionStatus: status?.type ?? "not_in_status",
        toolCalls: task.progress?.toolCalls ?? 0,
      })
    } catch (error) {
      log("[background-agent] Poll error for task:", { taskId: task.id, error })
    }
  }

  if (!args.hasRunningTasks()) {
    args.stopPolling()
  }
}
