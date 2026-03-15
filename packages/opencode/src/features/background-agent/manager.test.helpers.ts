import { tmpdir } from "node:os"
import type { PluginInput } from "../../plugin/sdk"
import type { BackgroundTask, LaunchInput, ResumeInput } from "./types"
import { MIN_IDLE_TIME_MS } from "./constants"
import { BackgroundManager } from "./manager"
import { ConcurrencyManager } from "./concurrency"
import { _resetForTesting as resetProcessCleanup } from "./process-cleanup"
import { initTaskToastManager, _resetTaskToastManagerForTesting } from "../task-toast-manager/manager"

export { BackgroundManager, ConcurrencyManager, MIN_IDLE_TIME_MS, resetProcessCleanup, tmpdir }
export type { BackgroundTask, LaunchInput, PluginInput, ResumeInput }

export const TASK_TTL_MS = 30 * 60 * 1000

export class MockBackgroundManager {
  private tasks: Map<string, BackgroundTask> = new Map()
  private notifications: Map<string, BackgroundTask[]> = new Map()
  public resumeCalls: Array<{ sessionId: string; prompt: string }> = []

  addTask(task: BackgroundTask): void {
    this.tasks.set(task.id, task)
  }

  getTask(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  findBySession(sessionID: string): BackgroundTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.sessionID === sessionID) {
        return task
      }
    }
    return undefined
  }

  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    for (const task of this.tasks.values()) {
      if (task.parentSessionID === sessionID) {
        result.push(task)
      }
    }
    return result
  }

  getAllDescendantTasks(sessionID: string): BackgroundTask[] {
    const result: BackgroundTask[] = []
    const directChildren = this.getTasksByParentSession(sessionID)

    for (const child of directChildren) {
      result.push(child)
      if (child.sessionID) {
        const descendants = this.getAllDescendantTasks(child.sessionID)
        result.push(...descendants)
      }
    }

    return result
  }

  markForNotification(task: BackgroundTask): void {
    const queue = this.notifications.get(task.parentSessionID) ?? []
    queue.push(task)
    this.notifications.set(task.parentSessionID, queue)
  }

  getPendingNotifications(sessionID: string): BackgroundTask[] {
    return this.notifications.get(sessionID) ?? []
  }

  private clearNotificationsForTask(taskId: string): void {
    for (const [sessionID, tasks] of this.notifications.entries()) {
      const filtered = tasks.filter((task) => task.id !== taskId)
      if (filtered.length === 0) {
        this.notifications.delete(sessionID)
      } else {
        this.notifications.set(sessionID, filtered)
      }
    }
  }

  pruneStaleTasksAndNotifications(): { prunedTasks: string[]; prunedNotifications: number } {
    const now = Date.now()
    const prunedTasks: string[] = []
    let prunedNotifications = 0

    for (const [taskId, task] of this.tasks.entries()) {
      if (!task.startedAt) continue
      const age = now - task.startedAt.getTime()
      if (age > TASK_TTL_MS) {
        prunedTasks.push(taskId)
        this.clearNotificationsForTask(taskId)
        this.tasks.delete(taskId)
      }
    }

    for (const [sessionID, notifications] of this.notifications.entries()) {
      if (notifications.length === 0) {
        this.notifications.delete(sessionID)
        continue
      }
      const validNotifications = notifications.filter((task) => {
        if (!task.startedAt) return false
        const age = now - task.startedAt.getTime()
        return age <= TASK_TTL_MS
      })
      const removed = notifications.length - validNotifications.length
      prunedNotifications += removed
      if (validNotifications.length === 0) {
        this.notifications.delete(sessionID)
      } else if (validNotifications.length !== notifications.length) {
        this.notifications.set(sessionID, validNotifications)
      }
    }

    return { prunedTasks, prunedNotifications }
  }

  getTaskCount(): number {
    return this.tasks.size
  }

  getNotificationCount(): number {
    let count = 0
    for (const notifications of this.notifications.values()) {
      count += notifications.length
    }
    return count
  }

  resume(input: ResumeInput): BackgroundTask {
    const existingTask = this.findBySession(input.sessionId)
    if (!existingTask) {
      throw new Error(`Task not found for session: ${input.sessionId}`)
    }

    if (existingTask.status === "running") {
      return existingTask
    }

    this.resumeCalls.push({ sessionId: input.sessionId, prompt: input.prompt })
    existingTask.status = "running"
    existingTask.completedAt = undefined
    existingTask.error = undefined
    existingTask.parentSessionID = input.parentSessionID
    existingTask.parentMessageID = input.parentMessageID
    existingTask.parentModel = input.parentModel
    existingTask.progress = {
      toolCalls: existingTask.progress?.toolCalls ?? 0,
      lastUpdate: new Date(),
    }

    return existingTask
  }
}

export function createMockTask(
  overrides: Partial<BackgroundTask> & { id: string; sessionID: string; parentSessionID: string },
): BackgroundTask {
  return {
    parentMessageID: "mock-message-id",
    description: "test task",
    prompt: "test prompt",
    agent: "test-agent",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
}

export function createBackgroundManager(): BackgroundManager {
  const client = {
    session: {
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
    },
  }
  return new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
}

export function getConcurrencyManager(manager: BackgroundManager): ConcurrencyManager {
  return (manager as unknown as { concurrencyManager: ConcurrencyManager }).concurrencyManager
}

export function getTaskMap(manager: BackgroundManager): Map<string, BackgroundTask> {
  return (manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks
}

export function getPendingByParent(manager: BackgroundManager): Map<string, Set<string>> {
  return (manager as unknown as { pendingByParent: Map<string, Set<string>> }).pendingByParent
}

export function getPendingNotifications(manager: BackgroundManager): Map<string, string[]> {
  return (manager as unknown as { pendingNotifications: Map<string, string[]> }).pendingNotifications
}

export function getCompletionTimers(manager: BackgroundManager): Map<string, ReturnType<typeof setTimeout>> {
  return (manager as unknown as { completionTimers: Map<string, ReturnType<typeof setTimeout>> }).completionTimers
}

export function getQueuesByKey(
  manager: BackgroundManager,
): Map<string, Array<{ task: BackgroundTask; input: LaunchInput }>> {
  return (
    manager as unknown as {
      queuesByKey: Map<string, Array<{ task: BackgroundTask; input: LaunchInput }>>
    }
  ).queuesByKey
}

export async function processKeyForTest(manager: BackgroundManager, key: string): Promise<void> {
  return (manager as unknown as { processKey: (key: string) => Promise<void> }).processKey(key)
}

export function pruneStaleTasksAndNotificationsForTest(manager: BackgroundManager): void {
  ;(manager as unknown as { pruneStaleTasksAndNotifications: () => void }).pruneStaleTasksAndNotifications()
}

export async function tryCompleteTaskForTest(manager: BackgroundManager, task: BackgroundTask): Promise<boolean> {
  return (
    manager as unknown as {
      tryCompleteTask: (task: BackgroundTask, source: string) => Promise<boolean>
    }
  ).tryCompleteTask(task, "test")
}

export async function checkAndInterruptStaleTasksForTest(
  manager: BackgroundManager,
  statuses?: Record<string, { type: string }>,
): Promise<void> {
  return (
    manager as unknown as {
      checkAndInterruptStaleTasks: (statuses?: Record<string, { type: string }>) => Promise<void>
    }
  ).checkAndInterruptStaleTasks(statuses)
}

export function stubNotifyParentSession(manager: BackgroundManager): void {
  ;(manager as unknown as { notifyParentSession: () => Promise<void> }).notifyParentSession = async () => {}
}

export function createToastRemoveTaskTracker(): { removeTaskCalls: string[]; resetToastManager: () => void } {
  _resetTaskToastManagerForTesting()
  const toastManager = initTaskToastManager({
    tui: { showToast: async () => {} },
  } as unknown as PluginInput["client"])
  const removeTaskCalls: string[] = []
  const originalRemoveTask = toastManager.removeTask.bind(toastManager)
  toastManager.removeTask = (taskId: string): void => {
    removeTaskCalls.push(taskId)
    originalRemoveTask(taskId)
  }
  return {
    removeTaskCalls,
    resetToastManager: _resetTaskToastManagerForTesting,
  }
}

export function getCleanupSignals(): Array<NodeJS.Signals | "beforeExit" | "exit"> {
  const signals: Array<NodeJS.Signals | "beforeExit" | "exit"> = ["SIGINT", "SIGTERM", "beforeExit", "exit"]
  if (process.platform === "win32") {
    signals.push("SIGBREAK")
  }
  return signals
}

export function getListenerCounts(signals: Array<NodeJS.Signals | "beforeExit" | "exit">): Record<string, number> {
  return Object.fromEntries(signals.map((signal) => [signal, process.listenerCount(signal)]))
}
