import { log } from "../../util/logger"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient } from "./constants"
import type { BackgroundTask } from "./types"

export function shutdownManager(args: {
  tasks: Map<string, BackgroundTask>
  notifications: Map<string, BackgroundTask[]>
  pendingNotifications: Map<string, string[]>
  pendingByParent: Map<string, Set<string>>
  notificationQueueByParent: Map<string, Promise<void>>
  queuesByKey: Map<string, Array<{ task: BackgroundTask }>>
  processingKeys: Set<string>
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  client: OpencodeClient
  concurrencyManager: ConcurrencyManager
  stopPolling: () => void
  unregisterProcessCleanup: () => void
  onShutdown?: () => void
}): void {
  log("[background-agent] Shutting down BackgroundManager")
  args.stopPolling()

  for (const task of args.tasks.values()) {
    if (task.status === "running" && task.sessionID) {
      args.client.session
        .abort({
          path: { id: task.sessionID },
        })
        .catch(() => {})
    }
  }

  if (args.onShutdown) {
    try {
      args.onShutdown()
    } catch (error) {
      log("[background-agent] Error in onShutdown callback:", error)
    }
  }

  for (const task of args.tasks.values()) {
    if (task.concurrencyKey) {
      args.concurrencyManager.release(task.concurrencyKey)
      task.concurrencyKey = undefined
    }
  }

  for (const timer of args.completionTimers.values()) {
    clearTimeout(timer)
  }
  args.completionTimers.clear()

  for (const timer of args.idleDeferralTimers.values()) {
    clearTimeout(timer)
  }
  args.idleDeferralTimers.clear()

  args.concurrencyManager.clear()
  args.tasks.clear()
  args.notifications.clear()
  args.pendingNotifications.clear()
  args.pendingByParent.clear()
  args.notificationQueueByParent.clear()
  args.queuesByKey.clear()
  args.processingKeys.clear()
  args.unregisterProcessCleanup()
  log("[background-agent] Shutdown complete")
}
