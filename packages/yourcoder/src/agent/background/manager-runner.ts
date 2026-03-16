import { setSessionTools } from "../../session/session-tools-store"
import { subagentSessions } from "../../session/state"
import { createInternalAgentTextPart } from "../../util/internal-initiator-marker"
import { log } from "../../util/logger"
import { promptWithModelSuggestionRetry } from "../../model/model-suggestion-retry"
import { normalizeSDKResponse } from "../../model/normalize"
import { getTaskToastManager } from "../../cli/toast"
import { isInsideTmux } from "../../tool/interactive-bash/tmux/shared"
import type { PluginInput } from "../../plugin/sdk"
import type { ConcurrencyManager } from "./concurrency"
import type { OnSubagentSessionCreated, QueueItem, Todo } from "./constants"
import type { TaskHistory } from "./task-history"
import type { BackgroundTask, ResumeInput } from "./types"
import { TMUX_CALLBACK_DELAY_MS } from "./constants"
import { enqueueNotificationForParent, cleanupPendingByParent, markForNotification } from "./manager-notification"
import { findBySession, getConcurrencyKeyFromInput } from "./manager-query"

type YcClient = PluginInput["client"]

function getTools(sessionID: string): Record<string, boolean> {
  const tools = {
    task: false,
    call_omo_agent: true,
    question: false,
  }
  setSessionTools(sessionID, tools)
  return tools
}

export async function processKey(args: {
  key: string
  processingKeys: Set<string>
  queuesByKey: Map<string, QueueItem[]>
  concurrencyManager: ConcurrencyManager
  startTask: (item: QueueItem) => Promise<void>
}): Promise<void> {
  if (args.processingKeys.has(args.key)) {
    return
  }

  args.processingKeys.add(args.key)

  try {
    const queue = args.queuesByKey.get(args.key)
    while (queue && queue.length > 0) {
      const item = queue[0]
      await args.concurrencyManager.acquire(args.key)

      if (item.task.status === "cancelled" || item.task.status === "error") {
        args.concurrencyManager.release(args.key)
        queue.shift()
        continue
      }

      try {
        await args.startTask(item)
      } catch (error) {
        log("[background-agent] Error starting task:", error)
        if (!item.task.concurrencyKey) {
          args.concurrencyManager.release(args.key)
        }
      }

      queue.shift()
    }
  } finally {
    args.processingKeys.delete(args.key)
  }
}

export async function startTask(args: {
  item: QueueItem
  client: YcClient
  directory: string
  concurrencyManager: ConcurrencyManager
  taskHistory: TaskHistory
  tmuxEnabled: boolean
  onSubagentSessionCreated?: OnSubagentSessionCreated
  startPolling: () => void
  notifications: Map<string, BackgroundTask[]>
  pendingByParent: Map<string, Set<string>>
  notificationQueueByParent: Map<string, Promise<void>>
  notifyParentSession: (task: BackgroundTask) => Promise<void>
}): Promise<void> {
  const { task, input } = args.item
  log("[background-agent] Starting task:", {
    taskId: task.id,
    agent: input.agent,
    model: input.model,
  })

  const key = getConcurrencyKeyFromInput(input)
  const parent = await args.client.session
    .get({
      path: { id: input.parentSessionID },
    })
    .catch((error) => {
      log(`[background-agent] Failed to get parent session: ${error}`)
      return null
    })
  const dir = parent?.data?.directory ?? args.directory
  log(`[background-agent] Parent dir: ${parent?.data?.directory}, using: ${dir}`)

  const created = await args.client.session.create({
    body: {
      parentID: input.parentSessionID,
      title: `${input.description} (@${input.agent} subagent)`,
    } as Record<string, unknown>,
    query: {
      directory: dir,
    },
  })

  if (created.error) {
    throw new Error(`Failed to create background session: ${created.error}`)
  }

  if (!created.data?.id) {
    throw new Error("Failed to create background session: API returned no session ID")
  }

  const sessionID = created.data.id
  subagentSessions.add(sessionID)

  log("[background-agent] tmux callback check", {
    hasCallback: !!args.onSubagentSessionCreated,
    tmuxEnabled: args.tmuxEnabled,
    isInsideTmux: isInsideTmux(),
    sessionID,
    parentID: input.parentSessionID,
  })

  if (args.onSubagentSessionCreated && args.tmuxEnabled && isInsideTmux()) {
    log("[background-agent] Invoking tmux callback NOW", { sessionID })
    await args
      .onSubagentSessionCreated({
        sessionID,
        parentID: input.parentSessionID,
        title: input.description,
      })
      .catch((error) => {
        log("[background-agent] Failed to spawn tmux pane:", error)
      })
    log("[background-agent] tmux callback completed, waiting 200ms")
    await new Promise((resolve) => setTimeout(resolve, TMUX_CALLBACK_DELAY_MS))
  } else {
    log("[background-agent] SKIP tmux callback - conditions not met")
  }

  task.status = "running"
  task.startedAt = new Date()
  task.sessionID = sessionID
  task.progress = {
    toolCalls: 0,
    lastUpdate: new Date(),
  }
  task.concurrencyKey = key
  task.concurrencyGroup = key

  args.taskHistory.record(input.parentSessionID, {
    id: task.id,
    sessionID,
    agent: input.agent,
    description: input.description,
    status: "running",
    category: input.category,
    startedAt: task.startedAt,
  })
  args.startPolling()

  log("[background-agent] Launching task:", { taskId: task.id, sessionID, agent: input.agent })
  getTaskToastManager()?.updateTask(task.id, "running")

  log("[background-agent] Calling prompt (fire-and-forget) for launch with:", {
    sessionID,
    agent: input.agent,
    model: input.model,
    hasSkillContent: !!input.skillContent,
    promptLength: input.prompt.length,
  })

  const model = input.model ? { providerID: input.model.providerID, modelID: input.model.modelID } : undefined

  promptWithModelSuggestionRetry(args.client, {
    path: { id: sessionID },
    body: {
      agent: input.agent,
      ...(model ? { model } : {}),
      ...(input.model?.variant ? { variant: input.model.variant } : {}),
      system: input.skillContent,
      tools: getTools(sessionID),
      parts: [createInternalAgentTextPart(input.prompt)],
    },
  }).catch((error) => {
    log("[background-agent] promptAsync error:", error)
    task.status = "interrupt"
    task.error = error instanceof Error ? error.message : String(error)
    if (task.error.includes("agent.name") || task.error.includes("undefined")) {
      task.error = `Agent "${input.agent}" not found. Make sure the agent is registered in your yourcoder.json or provided by a plugin.`
    }
    task.completedAt = new Date()

    if (task.concurrencyKey) {
      args.concurrencyManager.release(task.concurrencyKey)
      task.concurrencyKey = undefined
    }

    args.client.session
      .abort({
        path: { id: sessionID },
      })
      .catch(() => {})

    markForNotification(args.notifications, task)
    cleanupPendingByParent(args.pendingByParent, task)
    enqueueNotificationForParent(args.notificationQueueByParent, task.parentSessionID, () =>
      args.notifyParentSession(task),
    ).catch((err) => {
      log("[background-agent] Failed to notify on error:", err)
    })
  })
}

export async function trackTask(args: {
  input: {
    taskId: string
    sessionID: string
    parentSessionID: string
    description: string
    agent?: string
    parentAgent?: string
    concurrencyKey?: string
  }
  tasks: Map<string, BackgroundTask>
  pendingByParent: Map<string, Set<string>>
  concurrencyManager: ConcurrencyManager
  taskHistory: TaskHistory
  startPolling: () => void
}): Promise<BackgroundTask> {
  const item = args.tasks.get(args.input.taskId)
  if (item) {
    const moved = args.input.parentSessionID !== item.parentSessionID
    if (moved) {
      cleanupPendingByParent(args.pendingByParent, item)
      item.parentSessionID = args.input.parentSessionID
    }
    if (args.input.parentAgent !== undefined) {
      item.parentAgent = args.input.parentAgent
    }
    if (!item.concurrencyGroup) {
      item.concurrencyGroup = args.input.concurrencyKey ?? item.agent
    }
    if (item.sessionID) {
      subagentSessions.add(item.sessionID)
    }
    args.startPolling()

    if (item.status === "pending" || item.status === "running") {
      const ids = args.pendingByParent.get(args.input.parentSessionID) ?? new Set()
      ids.add(item.id)
      args.pendingByParent.set(args.input.parentSessionID, ids)
    } else if (!moved) {
      cleanupPendingByParent(args.pendingByParent, item)
    }

    log("[background-agent] External task already registered:", {
      taskId: item.id,
      sessionID: item.sessionID,
      status: item.status,
    })
    return item
  }

  const group = args.input.concurrencyKey ?? args.input.agent ?? "task"
  if (args.input.concurrencyKey) {
    await args.concurrencyManager.acquire(args.input.concurrencyKey)
  }

  const task: BackgroundTask = {
    id: args.input.taskId,
    sessionID: args.input.sessionID,
    parentSessionID: args.input.parentSessionID,
    parentMessageID: "",
    description: args.input.description,
    prompt: "",
    agent: args.input.agent || "task",
    status: "running",
    startedAt: new Date(),
    progress: {
      toolCalls: 0,
      lastUpdate: new Date(),
    },
    parentAgent: args.input.parentAgent,
    concurrencyKey: args.input.concurrencyKey,
    concurrencyGroup: group,
  }

  args.tasks.set(task.id, task)
  subagentSessions.add(args.input.sessionID)
  args.startPolling()
  args.taskHistory.record(args.input.parentSessionID, {
    id: task.id,
    sessionID: args.input.sessionID,
    agent: args.input.agent || "task",
    description: args.input.description,
    status: "running",
    startedAt: task.startedAt,
  })

  const ids = args.pendingByParent.get(args.input.parentSessionID) ?? new Set()
  ids.add(task.id)
  args.pendingByParent.set(args.input.parentSessionID, ids)

  log("[background-agent] Registered external task:", {
    taskId: task.id,
    sessionID: args.input.sessionID,
  })
  return task
}

export async function resumeTask(args: {
  input: ResumeInput
  tasks: Map<string, BackgroundTask>
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  pendingByParent: Map<string, Set<string>>
  concurrencyManager: ConcurrencyManager
  client: YcClient
  startPolling: () => void
  notifications: Map<string, BackgroundTask[]>
  taskHistory: TaskHistory
  notificationQueueByParent: Map<string, Promise<void>>
  notifyParentSession: (task: BackgroundTask) => Promise<void>
}): Promise<BackgroundTask> {
  const task = findBySession(args.tasks, args.input.sessionId)
  if (!task) {
    throw new Error(`Task not found for session: ${args.input.sessionId}`)
  }

  if (!task.sessionID) {
    throw new Error(`Task has no sessionID: ${task.id}`)
  }

  if (task.status === "running") {
    log("[background-agent] Resume skipped - task already running:", {
      taskId: task.id,
      sessionID: task.sessionID,
    })
    return task
  }

  const timer = args.completionTimers.get(task.id)
  if (timer) {
    clearTimeout(timer)
    args.completionTimers.delete(task.id)
  }

  const key = task.concurrencyGroup ?? task.agent
  await args.concurrencyManager.acquire(key)
  task.concurrencyKey = key
  task.concurrencyGroup = key

  task.status = "running"
  task.completedAt = undefined
  task.error = undefined
  task.parentSessionID = args.input.parentSessionID
  task.parentMessageID = args.input.parentMessageID
  task.parentModel = args.input.parentModel
  task.parentAgent = args.input.parentAgent
  if (args.input.parentTools) {
    task.parentTools = args.input.parentTools
  }
  task.startedAt = new Date()
  task.progress = {
    toolCalls: task.progress?.toolCalls ?? 0,
    lastUpdate: new Date(),
  }

  args.startPolling()
  subagentSessions.add(task.sessionID)

  const ids = args.pendingByParent.get(args.input.parentSessionID) ?? new Set()
  ids.add(task.id)
  args.pendingByParent.set(args.input.parentSessionID, ids)

  getTaskToastManager()?.addTask({
    id: task.id,
    description: task.description,
    agent: task.agent,
    isBackground: true,
  })

  log("[background-agent] Resuming task:", { taskId: task.id, sessionID: task.sessionID })
  log("[background-agent] Resuming task - calling prompt (fire-and-forget) with:", {
    sessionID: task.sessionID,
    agent: task.agent,
    model: task.model,
    promptLength: args.input.prompt.length,
  })

  const model = task.model ? { providerID: task.model.providerID, modelID: task.model.modelID } : undefined

  args.client.session
    .promptAsync({
      path: { id: task.sessionID },
      body: {
        agent: task.agent,
        ...(model ? { model } : {}),
        ...(task.model?.variant ? { variant: task.model.variant } : {}),
        tools: getTools(task.sessionID),
        parts: [createInternalAgentTextPart(args.input.prompt)],
      },
    })
    .catch((error) => {
      log("[background-agent] resume prompt error:", error)
      task.status = "interrupt"
      task.error = error instanceof Error ? error.message : String(error)
      task.completedAt = new Date()

      if (task.concurrencyKey) {
        args.concurrencyManager.release(task.concurrencyKey)
        task.concurrencyKey = undefined
      }

      args.client.session
        .abort({
          path: { id: task.sessionID! },
        })
        .catch(() => {})

      markForNotification(args.notifications, task)
      cleanupPendingByParent(args.pendingByParent, task)
      enqueueNotificationForParent(args.notificationQueueByParent, task.parentSessionID, () =>
        args.notifyParentSession(task),
      ).catch((err) => {
        log("[background-agent] Failed to notify on resume error:", err)
      })
    })

  return task
}

export async function checkSessionTodos(client: YcClient, sessionID: string): Promise<boolean> {
  try {
    const response = await client.session.todo({
      path: { id: sessionID },
    })
    const todos = normalizeSDKResponse(response, [] as Todo[], {
      preferResponseOnMissingData: true,
    })
    if (!todos || todos.length === 0) {
      return false
    }

    return todos.some((todo) => todo.status !== "completed" && todo.status !== "cancelled")
  } catch {
    return false
  }
}
