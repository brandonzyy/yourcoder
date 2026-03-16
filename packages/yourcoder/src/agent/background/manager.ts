import type { PluginInput } from "../../plugin/sdk"
import type { BackgroundTaskConfig, TmuxConfig } from "../../config/plugin-schema"
import type { BackgroundEvent, OnSubagentSessionCreated, QueueItem, SubagentSessionCreatedEvent } from "./constants"
import type { BackgroundTask, LaunchInput, ResumeInput } from "./types"
import { TaskHistory } from "./task-history"
import { ConcurrencyManager } from "./concurrency"
import { POLLING_INTERVAL_MS } from "./constants"
import { log } from "../../util/logger"
import { getTaskToastManager } from "../../cli/toast"
import { registerManagerForCleanup, unregisterManagerForCleanup } from "./process-cleanup"
import { tryFallbackRetry } from "./fallback-retry-handler"
import { cancelTask as cancelTaskOp, tryCompleteTask as tryCompleteTaskOp } from "./manager-task"
import {
  checkSessionTodos,
  processKey as processKeyOp,
  resumeTask,
  startTask as startTaskOp,
  trackTask as trackTaskOp,
} from "./manager-runner"
import {
  clearNotifications,
  enqueueNotificationForParent,
  getPendingNotifications,
  injectPendingNotificationsIntoChatMessage,
  markForNotification,
  notifyParentSession,
  queuePendingNotification,
  validateSessionHasOutput,
} from "./manager-notification"
import {
  findBySession,
  getAllDescendantTasks,
  getConcurrencyKeyFromInput,
  getNonRunningTasks,
  getRunningTasks,
  getTask,
  getTasksByParentSession,
  hasRunningTasks,
} from "./manager-query"
import { handleEvent as handleEventOp } from "./manager-events"
import { checkAndInterruptTasks, pollRunningTasks, pruneTasksAndNotifications } from "./manager-polling"
import { shutdownManager } from "./manager-shutdown"

type YcClient = PluginInput["client"]

export type { OnSubagentSessionCreated, SubagentSessionCreatedEvent }

export class BackgroundManager {
  private tasks: Map<string, BackgroundTask>
  private notifications: Map<string, BackgroundTask[]>
  private pendingNotifications: Map<string, string[]>
  private pendingByParent: Map<string, Set<string>>
  private client: YcClient
  private directory: string
  private pollingInterval?: ReturnType<typeof setInterval>
  private pollingInFlight = false
  private concurrencyManager: ConcurrencyManager
  private shutdownTriggered = false
  private config?: BackgroundTaskConfig
  private tmuxEnabled: boolean
  private onSubagentSessionCreated?: OnSubagentSessionCreated
  private onShutdown?: () => void
  private queuesByKey: Map<string, QueueItem[]> = new Map()
  private processingKeys: Set<string> = new Set()
  private completionTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private notificationQueueByParent: Map<string, Promise<void>> = new Map()
  private enableParentSessionNotifications: boolean
  readonly taskHistory = new TaskHistory()

  constructor(
    ctx: PluginInput,
    config?: BackgroundTaskConfig,
    options?: {
      tmuxConfig?: TmuxConfig
      onSubagentSessionCreated?: OnSubagentSessionCreated
      onShutdown?: () => void
      enableParentSessionNotifications?: boolean
    },
  ) {
    this.tasks = new Map()
    this.notifications = new Map()
    this.pendingNotifications = new Map()
    this.pendingByParent = new Map()
    this.client = ctx.client
    this.directory = ctx.directory
    this.concurrencyManager = new ConcurrencyManager(config)
    this.config = config
    this.tmuxEnabled = options?.tmuxConfig?.enabled ?? false
    this.onSubagentSessionCreated = options?.onSubagentSessionCreated
    this.onShutdown = options?.onShutdown
    this.enableParentSessionNotifications = options?.enableParentSessionNotifications ?? true
    this.registerProcessCleanup()
  }

  async launch(input: LaunchInput): Promise<BackgroundTask> {
    log("[background-agent] launch() called with:", {
      agent: input.agent,
      model: input.model,
      description: input.description,
      parentSessionID: input.parentSessionID,
    })

    if (!input.agent || input.agent.trim() === "") {
      throw new Error("Agent parameter is required")
    }

    const task: BackgroundTask = {
      id: `bg_${crypto.randomUUID().slice(0, 8)}`,
      status: "pending",
      queuedAt: new Date(),
      description: input.description,
      prompt: input.prompt,
      agent: input.agent,
      parentSessionID: input.parentSessionID,
      parentMessageID: input.parentMessageID,
      parentModel: input.parentModel,
      parentAgent: input.parentAgent,
      parentTools: input.parentTools,
      model: input.model,
      fallbackChain: input.fallbackChain,
      attemptCount: 0,
      category: input.category,
    }

    this.tasks.set(task.id, task)
    this.taskHistory.record(input.parentSessionID, {
      id: task.id,
      agent: input.agent,
      description: input.description,
      status: "pending",
      category: input.category,
    })

    if (input.parentSessionID) {
      const ids = this.pendingByParent.get(input.parentSessionID) ?? new Set()
      ids.add(task.id)
      this.pendingByParent.set(input.parentSessionID, ids)
    }

    const key = this.getConcurrencyKeyFromInput(input)
    const queue = this.queuesByKey.get(key) ?? []
    queue.push({ task, input })
    this.queuesByKey.set(key, queue)

    log("[background-agent] Task queued:", {
      taskId: task.id,
      key,
      queueLength: queue.length,
    })

    getTaskToastManager()?.addTask({
      id: task.id,
      description: input.description,
      agent: input.agent,
      isBackground: true,
      status: "queued",
      skills: input.skills,
    })

    void this.processKey(key)
    return task
  }

  private async processKey(key: string): Promise<void> {
    await processKeyOp({
      key,
      processingKeys: this.processingKeys,
      queuesByKey: this.queuesByKey,
      concurrencyManager: this.concurrencyManager,
      startTask: (item) => this.startTask(item),
    })
  }

  private async startTask(item: QueueItem): Promise<void> {
    await startTaskOp({
      item,
      client: this.client,
      directory: this.directory,
      concurrencyManager: this.concurrencyManager,
      taskHistory: this.taskHistory,
      tmuxEnabled: this.tmuxEnabled,
      onSubagentSessionCreated: this.onSubagentSessionCreated,
      startPolling: () => this.startPolling(),
      notifications: this.notifications,
      pendingByParent: this.pendingByParent,
      notificationQueueByParent: this.notificationQueueByParent,
      notifyParentSession: (task) => this.notifyParentSession(task),
    })
  }

  getTask(id: string): BackgroundTask | undefined {
    return getTask(this.tasks, id)
  }

  getTasksByParentSession(sessionID: string): BackgroundTask[] {
    return getTasksByParentSession(this.tasks, sessionID)
  }

  getAllDescendantTasks(sessionID: string): BackgroundTask[] {
    return getAllDescendantTasks(this.tasks, sessionID)
  }

  findBySession(sessionID: string): BackgroundTask | undefined {
    return findBySession(this.tasks, sessionID)
  }

  private getConcurrencyKeyFromInput(input: LaunchInput): string {
    return getConcurrencyKeyFromInput(input)
  }

  async trackTask(input: {
    taskId: string
    sessionID: string
    parentSessionID: string
    description: string
    agent?: string
    parentAgent?: string
    concurrencyKey?: string
  }): Promise<BackgroundTask> {
    return trackTaskOp({
      input,
      tasks: this.tasks,
      pendingByParent: this.pendingByParent,
      concurrencyManager: this.concurrencyManager,
      taskHistory: this.taskHistory,
      startPolling: () => this.startPolling(),
    })
  }

  async resume(input: ResumeInput): Promise<BackgroundTask> {
    return resumeTask({
      input,
      tasks: this.tasks,
      completionTimers: this.completionTimers,
      pendingByParent: this.pendingByParent,
      concurrencyManager: this.concurrencyManager,
      client: this.client,
      startPolling: () => this.startPolling(),
      notifications: this.notifications,
      taskHistory: this.taskHistory,
      notificationQueueByParent: this.notificationQueueByParent,
      notifyParentSession: (task) => this.notifyParentSession(task),
    })
  }

  private async checkSessionTodos(sessionID: string): Promise<boolean> {
    return checkSessionTodos(this.client, sessionID)
  }

  handleEvent(event: BackgroundEvent): void {
    handleEventOp({
      event,
      tasks: this.tasks,
      notifications: this.notifications,
      pendingNotifications: this.pendingNotifications,
      pendingByParent: this.pendingByParent,
      completionTimers: this.completionTimers,
      idleDeferralTimers: this.idleDeferralTimers,
      taskHistory: this.taskHistory,
      concurrencyManager: this.concurrencyManager,
      findBySession: (sessionID) => this.findBySession(sessionID),
      getAllDescendantTasks: (sessionID) => this.getAllDescendantTasks(sessionID),
      validateSessionHasOutput: (sessionID) => this.validateSessionHasOutput(sessionID),
      checkSessionTodos: (sessionID) => this.checkSessionTodos(sessionID),
      tryCompleteTask: (task, source) => this.tryCompleteTask(task, source),
      cancelTask: (taskId, options) => this.cancelTask(taskId, options),
      tryFallbackRetry: (task, errorInfo, source) => this.tryFallbackRetry(task, errorInfo, source),
    })
  }

  private tryFallbackRetry(
    task: BackgroundTask,
    errorInfo: { name?: string; message?: string },
    source: string,
  ): boolean {
    return tryFallbackRetry({
      task,
      errorInfo,
      source,
      concurrencyManager: this.concurrencyManager,
      client: this.client,
      idleDeferralTimers: this.idleDeferralTimers,
      queuesByKey: this.queuesByKey,
      processKey: (key) => void this.processKey(key),
    })
  }

  markForNotification(task: BackgroundTask): void {
    markForNotification(this.notifications, task)
  }

  getPendingNotifications(sessionID: string): BackgroundTask[] {
    return getPendingNotifications(this.notifications, sessionID)
  }

  clearNotifications(sessionID: string): void {
    clearNotifications(this.notifications, sessionID)
  }

  queuePendingNotification(sessionID: string | undefined, notification: string): void {
    queuePendingNotification(this.pendingNotifications, sessionID, notification)
  }

  injectPendingNotificationsIntoChatMessage(
    output: { parts: Array<{ type: string; text?: string; [key: string]: unknown }> },
    sessionID: string,
  ): void {
    injectPendingNotificationsIntoChatMessage(this.pendingNotifications, output, sessionID)
  }

  private async validateSessionHasOutput(sessionID: string): Promise<boolean> {
    return validateSessionHasOutput(this.client, sessionID)
  }

  async cancelTask(
    taskId: string,
    options?: { source?: string; reason?: string; abortSession?: boolean; skipNotification?: boolean },
  ): Promise<boolean> {
    return cancelTaskOp({
      taskId,
      tasks: this.tasks,
      notifications: this.notifications,
      pendingByParent: this.pendingByParent,
      completionTimers: this.completionTimers,
      idleDeferralTimers: this.idleDeferralTimers,
      queuesByKey: this.queuesByKey,
      client: this.client,
      concurrencyManager: this.concurrencyManager,
      taskHistory: this.taskHistory,
      notifyParentSession: (task) => this.notifyParentSession(task),
      notificationQueueByParent: this.notificationQueueByParent,
      options,
    })
  }

  cancelPendingTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== "pending") {
      return false
    }

    void this.cancelTask(taskId, { source: "cancelPendingTask", abortSession: false })
    return true
  }

  private startPolling(): void {
    if (this.pollingInterval) {
      return
    }

    this.pollingInterval = setInterval(() => {
      void this.pollRunningTasks()
    }, POLLING_INTERVAL_MS)
    this.pollingInterval.unref()
  }

  private stopPolling(): void {
    if (!this.pollingInterval) {
      return
    }

    clearInterval(this.pollingInterval)
    this.pollingInterval = undefined
  }

  private registerProcessCleanup(): void {
    registerManagerForCleanup(this)
  }

  private unregisterProcessCleanup(): void {
    unregisterManagerForCleanup(this)
  }

  getRunningTasks(): BackgroundTask[] {
    return getRunningTasks(this.tasks)
  }

  getNonRunningTasks(): BackgroundTask[] {
    return getNonRunningTasks(this.tasks)
  }

  private async tryCompleteTask(task: BackgroundTask, source: string): Promise<boolean> {
    return tryCompleteTaskOp({
      task,
      source,
      notifications: this.notifications,
      pendingByParent: this.pendingByParent,
      idleDeferralTimers: this.idleDeferralTimers,
      client: this.client,
      concurrencyManager: this.concurrencyManager,
      taskHistory: this.taskHistory,
      notifyParentSession: (item) => this.notifyParentSession(item),
      notificationQueueByParent: this.notificationQueueByParent,
    })
  }

  private async notifyParentSession(task: BackgroundTask): Promise<void> {
    await notifyParentSession({
      task,
      tasks: this.tasks,
      notifications: this.notifications,
      pending: this.pendingNotifications,
      pendingByParent: this.pendingByParent,
      completionTimers: this.completionTimers,
      client: this.client,
      enableParentSessionNotifications: this.enableParentSessionNotifications,
    })
  }

  private hasRunningTasks(): boolean {
    return hasRunningTasks(this.tasks)
  }

  private pruneStaleTasksAndNotifications(): void {
    pruneTasksAndNotifications({
      tasks: this.tasks,
      notifications: this.notifications,
      pendingByParent: this.pendingByParent,
      queuesByKey: this.queuesByKey,
      concurrencyManager: this.concurrencyManager,
    })
  }

  private async checkAndInterruptStaleTasks(statuses: Record<string, { type: string }> = {}): Promise<void> {
    await checkAndInterruptTasks({
      tasks: this.tasks,
      client: this.client,
      config: this.config,
      concurrencyManager: this.concurrencyManager,
      notifyParentSession: (task) =>
        enqueueNotificationForParent(this.notificationQueueByParent, task.parentSessionID, () =>
          this.notifyParentSession(task),
        ),
      statuses,
    })
  }

  private async pollRunningTasks(): Promise<void> {
    if (this.pollingInFlight) {
      return
    }

    this.pollingInFlight = true
    try {
      await pollRunningTasks({
        tasks: this.tasks,
        notifications: this.notifications,
        pendingByParent: this.pendingByParent,
        queuesByKey: this.queuesByKey,
        client: this.client,
        config: this.config,
        concurrencyManager: this.concurrencyManager,
        stopPolling: () => this.stopPolling(),
        hasRunningTasks: () => this.hasRunningTasks(),
        validateSessionHasOutput: (sessionID) => this.validateSessionHasOutput(sessionID),
        checkSessionTodos: (sessionID) => this.checkSessionTodos(sessionID),
        tryCompleteTask: (task, source) => this.tryCompleteTask(task, source),
        tryFallbackRetry: (task, errorInfo, source) => this.tryFallbackRetry(task, errorInfo, source),
        notifyParentSession: (task) =>
          enqueueNotificationForParent(this.notificationQueueByParent, task.parentSessionID, () =>
            this.notifyParentSession(task),
          ),
      })
    } finally {
      this.pollingInFlight = false
    }
  }

  shutdown(): void {
    if (this.shutdownTriggered) {
      return
    }

    this.shutdownTriggered = true
    shutdownManager({
      tasks: this.tasks,
      notifications: this.notifications,
      pendingNotifications: this.pendingNotifications,
      pendingByParent: this.pendingByParent,
      notificationQueueByParent: this.notificationQueueByParent,
      queuesByKey: this.queuesByKey,
      processingKeys: this.processingKeys,
      completionTimers: this.completionTimers,
      idleDeferralTimers: this.idleDeferralTimers,
      client: this.client,
      concurrencyManager: this.concurrencyManager,
      stopPolling: () => this.stopPolling(),
      unregisterProcessCleanup: () => this.unregisterProcessCleanup(),
      onShutdown: this.onShutdown,
    })
  }
}
