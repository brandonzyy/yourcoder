import { join } from "node:path"
import { normalizeSDKResponse } from "../../model/normalize"
import { MESSAGE_STORAGE } from "../../hooks/context-injection/message-injector"
import { createInternalAgentTextPart } from "../../util/internal-initiator-marker"
import { normalizePromptTools, resolveInheritedPromptTools } from "../../util/prompt-tools"
import { log } from "../../util/logger"
import { getTaskToastManager } from "../../cli/toast"
import { findNearestMessageExcludingCompaction, isCompactionAgent } from "./compaction-aware-message-resolver"
import { TASK_CLEANUP_DELAY_MS } from "./constants"
import { formatDuration } from "./duration-formatter"
import { isAbortedSessionError, isRecord } from "./error-classifier"
import type { YcClient } from "./constants"
import type { BackgroundTask } from "./types"

type Part = {
  type: string
  text?: string
  content?: string | unknown[]
  [key: string]: unknown
}

type Output = {
  parts: Part[]
}

type Message = {
  info?: {
    role?: string
    agent?: string
    model?: { providerID: string; modelID: string }
    modelID?: string
    providerID?: string
    tools?: Record<string, boolean | "allow" | "deny" | "ask">
  }
  parts?: Array<{
    type?: string
    text?: string
    content?: string | unknown[]
  }>
}

type MessagePart = NonNullable<Message["parts"]>[number]

export function markForNotification(notifications: Map<string, BackgroundTask[]>, task: BackgroundTask): void {
  const queue = notifications.get(task.parentSessionID) ?? []
  queue.push(task)
  notifications.set(task.parentSessionID, queue)
}

export function getPendingNotifications(
  notifications: Map<string, BackgroundTask[]>,
  sessionID: string,
): BackgroundTask[] {
  return notifications.get(sessionID) ?? []
}

export function clearNotifications(notifications: Map<string, BackgroundTask[]>, sessionID: string): void {
  notifications.delete(sessionID)
}

export function queuePendingNotification(
  pending: Map<string, string[]>,
  sessionID: string | undefined,
  notification: string,
): void {
  if (!sessionID) return

  const list = pending.get(sessionID) ?? []
  list.push(notification)
  pending.set(sessionID, list)
}

export function injectPendingNotificationsIntoChatMessage(
  pending: Map<string, string[]>,
  output: Output,
  sessionID: string,
): void {
  const list = pending.get(sessionID)
  if (!list || list.length === 0) {
    return
  }

  pending.delete(sessionID)
  const text = list.join("\n\n")
  const index = output.parts.findIndex((part) => part.type === "text")

  if (index === -1) {
    output.parts.unshift(createInternalAgentTextPart(text))
    return
  }

  output.parts[index].text = `${text}\n\n---\n\n${output.parts[index].text ?? ""}`
}

export function clearNotificationsForTask(notifications: Map<string, BackgroundTask[]>, taskId: string): void {
  for (const [sessionID, tasks] of notifications.entries()) {
    const list = tasks.filter((task) => task.id !== taskId)
    if (list.length === 0) {
      notifications.delete(sessionID)
      continue
    }

    notifications.set(sessionID, list)
  }
}

export function cleanupPendingByParent(pending: Map<string, Set<string>>, task: BackgroundTask): void {
  if (!task.parentSessionID) return

  const ids = pending.get(task.parentSessionID)
  if (!ids) {
    return
  }

  ids.delete(task.id)
  if (ids.size === 0) {
    pending.delete(task.parentSessionID)
  }
}

function hasContent(part: MessagePart | undefined): boolean {
  if (!part) return false

  if ((part.type === "text" || part.type === "reasoning") && part.text?.trim()) {
    return true
  }

  if (part.type === "tool") {
    return true
  }

  if (part.type !== "tool_result") {
    return false
  }

  if (typeof part.content === "string") {
    return part.content.trim().length > 0
  }

  return Array.isArray(part.content) && part.content.length > 0
}

export async function validateSessionHasOutput(client: YcClient, sessionID: string): Promise<boolean> {
  try {
    const response = await client.session.messages({
      path: { id: sessionID },
    })
    const messages = normalizeSDKResponse(response, [] as Message[], {
      preferResponseOnMissingData: true,
    })

    const hasMessage = messages.some((msg) => msg.info?.role === "assistant" || msg.info?.role === "tool")
    if (!hasMessage) {
      log("[background-agent] No assistant/tool messages found in session:", sessionID)
      return false
    }

    const valid = messages.some(
      (msg) =>
        (msg.info?.role === "assistant" || msg.info?.role === "tool") &&
        (msg.parts ?? []).some((part) => hasContent(part)),
    )

    if (!valid) {
      log("[background-agent] Messages exist but no content found in session:", sessionID)
      return false
    }

    return true
  } catch (error) {
    log("[background-agent] Error validating session output:", error)
    return true
  }
}

function getStatusText(task: BackgroundTask): string {
  if (task.status === "completed") return "COMPLETED"
  if (task.status === "interrupt") return "INTERRUPTED"
  return "CANCELLED"
}

function getNotification(task: BackgroundTask, tasks: BackgroundTask[], done: boolean, left: number): string {
  const err = task.error ? `\n**Error:** ${task.error}` : ""
  const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)

  if (done) {
    const list = tasks.map((item) => `- \`${item.id}\`: ${item.description}`).join("\n")

    return `<system-reminder>
[ALL BACKGROUND TASKS COMPLETE]

**Completed:**
${list || `- \`${task.id}\`: ${task.description}`}

Use \`background_output(task_id="<id>")\` to retrieve each result.
</system-reminder>`
  }

  return `<system-reminder>
[BACKGROUND TASK ${getStatusText(task)}]
**ID:** \`${task.id}\`
**Description:** ${task.description}
**Duration:** ${duration}${err}

**${left} task${left === 1 ? "" : "s"} still in progress.** You WILL be notified when ALL complete.
Do NOT poll - continue productive work.

Use \`background_output(task_id="${task.id}")\` to retrieve this result when ready.
</system-reminder>`
}

async function getParentContext(args: { client: YcClient; task: BackgroundTask }): Promise<{
  agent: string | undefined
  model: { providerID: string; modelID: string } | undefined
  tools: Record<string, boolean> | undefined
}> {
  const { client, task } = args
  const base = {
    agent: task.parentAgent,
    model: undefined as { providerID: string; modelID: string } | undefined,
    tools: task.parentTools,
  }

  try {
    const response = await client.session.messages({ path: { id: task.parentSessionID } })
    const messages = normalizeSDKResponse(response, [] as Message[])

    for (let i = messages.length - 1; i >= 0; i--) {
      const info = messages[i].info
      if (isCompactionAgent(info?.agent)) {
        continue
      }

      const tools = isRecord(info?.tools)
        ? normalizePromptTools(info.tools as Record<string, boolean | "allow" | "deny" | "ask">)
        : undefined

      if (!info?.agent && !info?.model && !(info?.providerID && info?.modelID) && !tools) {
        continue
      }

      return {
        agent: info?.agent ?? task.parentAgent,
        model:
          info?.model ??
          (info?.providerID && info?.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined),
        tools: tools ?? base.tools,
      }
    }
  } catch (error) {
    if (isAbortedSessionError(error)) {
      log("[background-agent] Parent session aborted while loading messages; using messageDir fallback:", {
        taskId: task.id,
        parentSessionID: task.parentSessionID,
      })
    }

    const dir = join(MESSAGE_STORAGE, task.parentSessionID)
    const msg = findNearestMessageExcludingCompaction(dir)
    return {
      agent: msg?.agent ?? task.parentAgent,
      model:
        msg?.model?.providerID && msg?.model?.modelID
          ? { providerID: msg.model.providerID, modelID: msg.model.modelID }
          : undefined,
      tools: normalizePromptTools(msg?.tools) ?? base.tools,
    }
  }

  return base
}

export async function notifyParentSession(args: {
  task: BackgroundTask
  tasks: Map<string, BackgroundTask>
  notifications: Map<string, BackgroundTask[]>
  pending: Map<string, string[]>
  pendingByParent: Map<string, Set<string>>
  completionTimers: Map<string, ReturnType<typeof setTimeout>>
  client: YcClient
  enableParentSessionNotifications: boolean
}): Promise<void> {
  const { task, tasks, notifications, pending, pendingByParent, completionTimers, client } = args
  log("[background-agent] notifyParentSession called for task:", task.id)

  const toast = getTaskToastManager()
  if (toast) {
    toast.showCompletionToast({
      id: task.id,
      description: task.description,
      duration: formatDuration(task.startedAt ?? new Date(), task.completedAt),
    })
  }

  const ids = pendingByParent.get(task.parentSessionID)
  const left = ids ? (ids.delete(task.id), ids.size) : 0
  const done = !ids || left === 0
  if (done) {
    pendingByParent.delete(task.parentSessionID)
  }

  const items = done
    ? Array.from(tasks.values()).filter(
        (item) =>
          item.parentSessionID === task.parentSessionID && item.status !== "running" && item.status !== "pending",
      )
    : []

  const notification = getNotification(task, items, done, left)

  if (args.enableParentSessionNotifications) {
    const parent = await getParentContext({ client, task })
    const tools = resolveInheritedPromptTools(task.parentSessionID, parent.tools)

    log("[background-agent] notifyParentSession context:", {
      taskId: task.id,
      resolvedAgent: parent.agent,
      resolvedModel: parent.model,
    })

    try {
      await client.session.promptAsync({
        path: { id: task.parentSessionID },
        body: {
          noReply: !done,
          ...(parent.agent !== undefined ? { agent: parent.agent } : {}),
          ...(parent.model !== undefined ? { model: parent.model } : {}),
          ...(tools ? { tools } : {}),
          parts: [createInternalAgentTextPart(notification)],
        },
      })
      log("[background-agent] Sent notification to parent session:", {
        taskId: task.id,
        allComplete: done,
        noReply: !done,
      })
    } catch (error) {
      if (isAbortedSessionError(error)) {
        log("[background-agent] Parent session aborted while sending notification; continuing cleanup:", {
          taskId: task.id,
          parentSessionID: task.parentSessionID,
        })
        queuePendingNotification(pending, task.parentSessionID, notification)
      } else {
        log("[background-agent] Failed to send notification:", error)
      }
    }
  } else {
    log("[background-agent] Parent session notifications disabled, skipping prompt injection:", {
      taskId: task.id,
      parentSessionID: task.parentSessionID,
    })
  }

  if (!done) {
    return
  }

  for (const item of items) {
    const prev = completionTimers.get(item.id)
    if (prev) {
      clearTimeout(prev)
      completionTimers.delete(item.id)
    }

    const timer = setTimeout(() => {
      completionTimers.delete(item.id)
      if (!tasks.has(item.id)) {
        return
      }

      clearNotificationsForTask(notifications, item.id)
      tasks.delete(item.id)
      log("[background-agent] Removed completed task from memory:", item.id)
    }, TASK_CLEANUP_DELAY_MS)

    completionTimers.set(item.id, timer)
  }
}

export function enqueueNotificationForParent(
  queue: Map<string, Promise<void>>,
  parentSessionID: string | undefined,
  op: () => Promise<void>,
): Promise<void> {
  if (!parentSessionID) {
    return op()
  }

  const prev = queue.get(parentSessionID) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(op)
  queue.set(parentSessionID, next)

  void next
    .finally(() => {
      if (queue.get(parentSessionID) === next) {
        queue.delete(parentSessionID)
      }
    })
    .catch(() => {})

  return next
}
