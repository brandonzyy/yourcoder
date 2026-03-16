// Merged from: sync-task.ts + sync-session-creator.ts + sync-prompt-sender.ts + sync-session-poller.ts + sync-result-fetcher.ts + sync-continuation.ts + sync-task-deps.ts + sync-continuation-deps.ts

import type { ModelFallbackInfo } from "../../cli/toast/types"
import type { FallbackEntry } from "../../model/model-requirements"
import type { DelegateTaskArgs, ToolContextWithMetadata, YcClient } from "./types"
import type { ExecutorContext, ParentContext, SessionMessage } from "./types"
import { getTaskToastManager } from "../../cli/toast"
import { storeToolMetadata } from "../../tool/metadata-store"
import { subagentSessions, syncSubagentSessions, setSessionAgent } from "../../session/state"
import { log } from "../../util/logger"
import { SessionCategoryRegistry } from "../../session/session-category-registry"
import { formatDuration, formatDetailedError, getDefaultSyncPollTimeoutMs, getTimingConfig } from "./util"
import { isPlanFamily } from "./constants"
import { buildTaskPrompt } from "./prompt-builder"
import { normalizeSDKResponse } from "../../model/normalize"
import {
  promptSyncWithModelSuggestionRetry,
  promptWithModelSuggestionRetry,
} from "../../model/model-suggestion-retry"
import { setSessionTools } from "../../session/session-tools-store"
import { createInternalAgentTextPart } from "../../util/internal-initiator-marker"
import { getMessageDir } from "../../util/opencode-message-dir"
import { findNearestMessageWithFields } from "../../hooks/context-injection/message-injector"
import { setSessionFallbackChain, clearSessionFallbackChain } from "../../hooks/model-switching/model-fallback/hook"

// --- Sync Session Creator ---

export async function createSyncSession(
  client: YcClient,
  input: { parentSessionID: string; agentToUse: string; description: string; defaultDirectory: string }
): Promise<{ ok: true; sessionID: string; parentDirectory: string } | { ok: false; error: string }> {
  const parentSession = client.session.get
    ? await client.session.get({ path: { id: input.parentSessionID } }).catch(() => null)
    : null
  const parentDirectory = parentSession?.data?.directory ?? input.defaultDirectory

  const createResult = await client.session.create({
    body: {
      parentID: input.parentSessionID,
      title: `${input.description} (@${input.agentToUse} subagent)`,
    } as Record<string, unknown>,
    query: {
      directory: parentDirectory,
    },
  })

  if (createResult.error) {
    return { ok: false, error: `Failed to create session: ${createResult.error}` }
  }

  return { ok: true, sessionID: createResult.data.id, parentDirectory }
}


// --- Sync Prompt Sender ---

type SendSyncPromptDeps = {
  promptWithModelSuggestionRetry: typeof promptWithModelSuggestionRetry
  promptSyncWithModelSuggestionRetry: typeof promptSyncWithModelSuggestionRetry
}

const sendSyncPromptDeps: SendSyncPromptDeps = {
  promptWithModelSuggestionRetry,
  promptSyncWithModelSuggestionRetry,
}

function isOracleAgent(agentToUse: string): boolean {
  return agentToUse.toLowerCase() === "oracle"
}

function isUnexpectedEofError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const lowered = message.toLowerCase()
  return lowered.includes("unexpected eof") || lowered.includes("json parse error")
}

export async function sendSyncPrompt(
  client: YcClient,
  input: {
    sessionID: string
    agentToUse: string
    args: DelegateTaskArgs
    systemContent: string | undefined
    categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
    toastManager: { removeTask: (id: string) => void } | null | undefined
    taskId: string | undefined
  },
  deps: SendSyncPromptDeps = sendSyncPromptDeps
): Promise<string | null> {
  const allowTask = isPlanFamily(input.agentToUse)
  const effectivePrompt = buildTaskPrompt(input.args.prompt, input.agentToUse)
  const tools = {
    task: allowTask,
    call_omo_agent: true,
    question: false,
  }
  setSessionTools(input.sessionID, tools)

  const promptArgs = {
    path: { id: input.sessionID },
    body: {
      agent: input.agentToUse,
      system: input.systemContent,
      tools,
      parts: [createInternalAgentTextPart(effectivePrompt)],
      ...(input.categoryModel
        ? { model: { providerID: input.categoryModel.providerID, modelID: input.categoryModel.modelID } }
        : {}),
      ...(input.categoryModel?.variant ? { variant: input.categoryModel.variant } : {}),
    },
  }

  try {
    await deps.promptWithModelSuggestionRetry(client, promptArgs)
  } catch (promptError) {
    if (isOracleAgent(input.agentToUse) && isUnexpectedEofError(promptError)) {
      try {
        await deps.promptSyncWithModelSuggestionRetry(client, promptArgs)
        return null
      } catch (oracleRetryError) {
        promptError = oracleRetryError
      }
    }

    if (input.toastManager && input.taskId !== undefined) {
      input.toastManager.removeTask(input.taskId)
    }
    const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
    if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
      return formatDetailedError(new Error(`Agent "${input.agentToUse}" not found. Make sure the agent is registered in your yourcoder.json or provided by a plugin.`), {
        operation: "Send prompt to agent",
        args: input.args,
        sessionID: input.sessionID,
        agent: input.agentToUse,
        category: input.args.category,
      })
    }
    return formatDetailedError(promptError, {
      operation: "Send prompt",
      args: input.args,
      sessionID: input.sessionID,
      agent: input.agentToUse,
      category: input.args.category,
    })
  }

  return null
}


// --- Sync Session Poller ---

const NON_TERMINAL_FINISH_REASONS = new Set(["tool-calls", "unknown"])

export function isSessionComplete(messages: SessionMessage[]): boolean {
  let lastUser: SessionMessage | undefined
  let lastAssistant: SessionMessage | undefined

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!lastAssistant && msg.info?.role === "assistant") lastAssistant = msg
    if (!lastUser && msg.info?.role === "user") lastUser = msg
    if (lastUser && lastAssistant) break
  }

  if (!lastAssistant?.info?.finish) return false
  if (NON_TERMINAL_FINISH_REASONS.has(lastAssistant.info.finish)) return false
  if (!lastUser?.info?.id || !lastAssistant?.info?.id) return false
  return lastUser.info.id < lastAssistant.info.id
}

export async function pollSyncSession(
  ctx: ToolContextWithMetadata,
  client: YcClient,
  input: {
    sessionID: string
    agentToUse: string
    toastManager: { removeTask: (id: string) => void } | null | undefined
    taskId: string | undefined
    anchorMessageCount?: number
  },
  timeoutMs?: number
): Promise<string | null> {
  const syncTiming = getTimingConfig()
  const maxPollTimeMs = Math.max(timeoutMs ?? getDefaultSyncPollTimeoutMs(), 50)
  const pollStart = Date.now()
  let pollCount = 0
  let timedOut = false

  log("[task] Starting poll loop", { sessionID: input.sessionID, agentToUse: input.agentToUse })

  while (Date.now() - pollStart < maxPollTimeMs) {
    if (ctx.abort?.aborted) {
      log("[task] Aborted by user", { sessionID: input.sessionID })
      if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
      return `Task aborted.\n\nSession ID: ${input.sessionID}`
    }

    await new Promise(resolve => setTimeout(resolve, syncTiming.POLL_INTERVAL_MS))
    pollCount++

    let statusResult: { data?: Record<string, { type: string }> }
    try {
      statusResult = await client.session.status()
    } catch (error) {
      log("[task] Poll status fetch failed, retrying", { sessionID: input.sessionID, error: String(error) })
      continue
    }
    const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)
    const sessionStatus = allStatuses[input.sessionID]

    if (pollCount % 10 === 0) {
      log("[task] Poll status", {
        sessionID: input.sessionID,
        pollCount,
        elapsed: Math.floor((Date.now() - pollStart) / 1000) + "s",
        sessionStatus: sessionStatus?.type ?? "not_in_status",
      })
    }

    if (sessionStatus && sessionStatus.type !== "idle") {
      continue
    }

    let messagesResult: { data?: unknown } | SessionMessage[]
    try {
      messagesResult = await client.session.messages({ path: { id: input.sessionID } })
    } catch (error) {
      log("[task] Poll messages fetch failed, retrying", { sessionID: input.sessionID, error: String(error) })
      continue
    }
    const rawData = (messagesResult as { data?: unknown })?.data ?? messagesResult
    const msgs = Array.isArray(rawData) ? (rawData as SessionMessage[]) : []

    if (input.anchorMessageCount !== undefined && msgs.length <= input.anchorMessageCount) {
      continue
    }

    if (isSessionComplete(msgs)) {
      log("[task] Poll complete - terminal finish detected", { sessionID: input.sessionID, pollCount })
      break
    }

    const lastAssistant = [...msgs].reverse().find((m) => m.info?.role === "assistant")
    const hasAssistantText = msgs.some((m) => {
      if (m.info?.role !== "assistant") return false
      const parts = m.parts ?? []
      return parts.some((p) => {
        if (p.type !== "text" && p.type !== "reasoning") return false
        const text = (p.text ?? "").trim()
        return text.length > 0
      })
    })

    if (!lastAssistant?.info?.finish && hasAssistantText) {
      log("[task] Poll complete - assistant text detected (fallback)", {
        sessionID: input.sessionID,
        pollCount,
      })
      break
    }
  }

  if (Date.now() - pollStart >= maxPollTimeMs) {
    timedOut = true
    log("[task] Poll timeout reached", { sessionID: input.sessionID, pollCount })
  }

  return timedOut ? `Poll timeout reached after ${maxPollTimeMs}ms for session ${input.sessionID}` : null
}


// --- Sync Result Fetcher ---

export async function fetchSyncResult(
  client: YcClient,
  sessionID: string,
  anchorMessageCount?: number
): Promise<{ ok: true; textContent: string } | { ok: false; error: string }> {
  const messagesResult = await client.session.messages({
    path: { id: sessionID },
  })

  if ((messagesResult as { error?: unknown }).error) {
    return { ok: false, error: `Error fetching result: ${(messagesResult as { error: unknown }).error}\n\nSession ID: ${sessionID}` }
  }

  const messages = normalizeSDKResponse(messagesResult, [] as SessionMessage[], {
    preferResponseOnMissingData: true,
  })

  const messagesAfterAnchor = anchorMessageCount !== undefined ? messages.slice(anchorMessageCount) : messages

  if (anchorMessageCount !== undefined && messagesAfterAnchor.length === 0) {
    return {
      ok: false,
      error: `Session completed but no new response was generated. The model may have failed silently.\n\nSession ID: ${sessionID}`,
    }
  }

  const assistantMessages = messagesAfterAnchor
    .filter((m) => m.info?.role === "assistant")
    .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))
  const lastMessage = assistantMessages[0]

  if (anchorMessageCount !== undefined && !lastMessage) {
    return {
      ok: false,
      error: `Session completed but no new response was generated. The model may have failed silently.\n\nSession ID: ${sessionID}`,
    }
  }

  if (!lastMessage) {
    return { ok: false, error: `No assistant response found.\n\nSession ID: ${sessionID}` }
  }

  // Search assistant messages (newest first) for one with text/reasoning content.
  // The last assistant message may only contain tool calls with no text.
  let textContent = ""
  for (const msg of assistantMessages) {
    const textParts = msg.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
    const content = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")
    if (content) {
      textContent = content
      break
    }
  }

  return { ok: true, textContent }
}


// --- Sync Deps ---

export const syncTaskDeps = {
  createSyncSession,
  sendSyncPrompt,
  pollSyncSession,
  fetchSyncResult,
}

export type SyncTaskDeps = typeof syncTaskDeps

export const syncContinuationDeps = {
  pollSyncSession,
  fetchSyncResult,
}

export type SyncContinuationDeps = typeof syncContinuationDeps

// --- Sync Task ---

export async function executeSyncTask(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  parentContext: ParentContext,
  agentToUse: string,
  categoryModel: { providerID: string; modelID: string; variant?: string } | undefined,
  systemContent: string | undefined,
  modelInfo?: ModelFallbackInfo,
  fallbackChain?: FallbackEntry[],
  deps: SyncTaskDeps = syncTaskDeps
): Promise<string> {
  const { client, directory, onSyncSessionCreated, syncPollTimeoutMs } = executorCtx
  const toastManager = getTaskToastManager()
  let taskId: string | undefined
  let syncSessionID: string | undefined

  try {
    const createSessionResult = await deps.createSyncSession(client, {
      parentSessionID: parentContext.sessionID,
      agentToUse,
      description: args.description,
      defaultDirectory: directory,
    })

    if (!createSessionResult.ok) {
      return createSessionResult.error
    }

    const sessionID = createSessionResult.sessionID
    syncSessionID = sessionID
    subagentSessions.add(sessionID)
    syncSubagentSessions.add(sessionID)
    setSessionAgent(sessionID, agentToUse)
    setSessionFallbackChain(sessionID, fallbackChain)

    if (args.category) {
      SessionCategoryRegistry.register(sessionID, args.category)
    }

    if (onSyncSessionCreated) {
      log("[task] Invoking onSyncSessionCreated callback", { sessionID, parentID: parentContext.sessionID })
      await onSyncSessionCreated({
        sessionID,
        parentID: parentContext.sessionID,
        title: args.description,
      }).catch((err) => {
      log("[task] onSyncSessionCreated callback failed", { error: String(err) })
      })
      await new Promise(r => setTimeout(r, 200))
    }

    taskId = `sync_${sessionID.slice(0, 8)}`
    const startTime = new Date()

    if (toastManager) {
      toastManager.addTask({
        id: taskId,
        sessionID,
        description: args.description,
        agent: agentToUse,
        isBackground: false,
        category: args.category,
        skills: args.load_skills,
        modelInfo,
      })
    }

    const syncTaskMeta = {
      title: args.description,
      metadata: {
        prompt: args.prompt,
        agent: agentToUse,
        category: args.category,
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        sessionId: sessionID,
        sync: true,
        command: args.command,
        model: categoryModel ? { providerID: categoryModel.providerID, modelID: categoryModel.modelID } : undefined,
      },
    }
    await ctx.metadata?.(syncTaskMeta)
    if (ctx.callID) {
      storeToolMetadata(ctx.sessionID, ctx.callID, syncTaskMeta)
    }

    const promptError = await deps.sendSyncPrompt(client, {
      sessionID,
      agentToUse,
      args,
      systemContent,
      categoryModel,
      toastManager,
      taskId,
    })
    if (promptError) {
      return promptError
    }

    try {
      const pollError = await deps.pollSyncSession(ctx, client, {
        sessionID,
        agentToUse,
        toastManager,
        taskId,
      }, syncPollTimeoutMs)
      if (pollError) {
        return pollError
      }

      const result = await deps.fetchSyncResult(client, sessionID)
      if (!result.ok) {
        return result.error
      }

      const duration = formatDuration(startTime)

      return `Task completed in ${duration}.

Agent: ${agentToUse}${args.category ? ` (category: ${args.category})` : ""}

---

${result.textContent || "(No text output)"}

<task_metadata>
session_id: ${sessionID}
</task_metadata>`
    } finally {
      if (toastManager && taskId !== undefined) {
        toastManager.removeTask(taskId)
      }
    }
  } catch (error) {
    return formatDetailedError(error, {
      operation: "Execute task",
      args,
      sessionID: syncSessionID,
      agent: agentToUse,
      category: args.category,
    })
  } finally {
    if (syncSessionID) {
      subagentSessions.delete(syncSessionID)
      syncSubagentSessions.delete(syncSessionID)
      clearSessionFallbackChain(syncSessionID)
      SessionCategoryRegistry.remove(syncSessionID)
    }
  }
}


// --- Sync Continuation ---

export async function executeSyncContinuation(
  args: DelegateTaskArgs,
  ctx: ToolContextWithMetadata,
  executorCtx: ExecutorContext,
  deps: SyncContinuationDeps = syncContinuationDeps
): Promise<string> {
  const { client, syncPollTimeoutMs } = executorCtx
  const toastManager = getTaskToastManager()
  const taskId = `resume_sync_${args.session_id!.slice(0, 8)}`
  const startTime = new Date()

  if (toastManager) {
    toastManager.addTask({
      id: taskId,
      description: args.description,
      agent: "continue",
      isBackground: false,
    })
  }

  let syncContMeta: { title: string; metadata: Record<string, unknown> } | undefined

  let resumeAgent: string | undefined
  let resumeModel: { providerID: string; modelID: string } | undefined
  let resumeVariant: string | undefined
  let anchorMessageCount: number | undefined

  try {
    try {
      const messagesResp = await client.session.messages({ path: { id: args.session_id! } })
      const messages = normalizeSDKResponse(messagesResp, [] as SessionMessage[])
      anchorMessageCount = messages.length
      for (let i = messages.length - 1; i >= 0; i--) {
        const info = messages[i].info
        if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
          resumeAgent = info.agent
          resumeModel = info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined)
          resumeVariant = info.variant
          break
        }
      }
    } catch {
      const resumeMessageDir = getMessageDir(args.session_id!)
      const resumeMessage = resumeMessageDir ? findNearestMessageWithFields(resumeMessageDir) : null
      resumeAgent = resumeMessage?.agent
      resumeModel = resumeMessage?.model?.providerID && resumeMessage?.model?.modelID
        ? { providerID: resumeMessage.model.providerID, modelID: resumeMessage.model.modelID }
        : undefined
      resumeVariant = resumeMessage?.model?.variant
    }

    syncContMeta = {
      title: `Continue: ${args.description}`,
      metadata: {
        prompt: args.prompt,
        load_skills: args.load_skills,
        description: args.description,
        run_in_background: args.run_in_background,
        sessionId: args.session_id,
        sync: true,
        command: args.command,
        model: resumeModel,
      },
    }
    await ctx.metadata?.(syncContMeta)
    if (ctx.callID) {
      storeToolMetadata(ctx.sessionID, ctx.callID, syncContMeta)
    }

    const allowTask = isPlanFamily(resumeAgent)
    const effectivePrompt = buildTaskPrompt(args.prompt, resumeAgent)
    const tools = {
      task: allowTask,
      call_omo_agent: true,
      question: false,
    }
    setSessionTools(args.session_id!, tools)

    await promptWithModelSuggestionRetry(client, {
      path: { id: args.session_id! },
      body: {
        ...(resumeAgent !== undefined ? { agent: resumeAgent } : {}),
        ...(resumeModel !== undefined ? { model: resumeModel } : {}),
        ...(resumeVariant !== undefined ? { variant: resumeVariant } : {}),
        tools,
        parts: [{ type: "text", text: effectivePrompt }],
      },
    })
   } catch (promptError) {
     if (toastManager) {
       toastManager.removeTask(taskId)
     }
     const errorMessage = promptError instanceof Error ? promptError.message : String(promptError)
     return `Failed to send continuation prompt: ${errorMessage}\n\nSession ID: ${args.session_id}`
   }

    try {
      const pollError = await deps.pollSyncSession(ctx, client, {
        sessionID: args.session_id!,
        agentToUse: resumeAgent ?? "continue",
        toastManager,
        taskId,
        anchorMessageCount,
      }, syncPollTimeoutMs)
      if (pollError) {
        return pollError
      }

      const result = await deps.fetchSyncResult(client, args.session_id!, anchorMessageCount)
      if (!result.ok) {
        return result.error
      }

     const duration = formatDuration(startTime)

     return `Task continued and completed in ${duration}.

---

${result.textContent || "(No text output)"}

<task_metadata>
session_id: ${args.session_id}
${resumeAgent ? `subagent: ${resumeAgent}\n` : ""}</task_metadata>`
   } finally {
     if (toastManager) {
       toastManager.removeTask(taskId)
     }
   }
}

