// Merged from: time-formatter.ts + timing.ts + token-limiter.ts + error-formatting.ts + parent-context-resolver.ts + model-string-parser.ts

import type { ToolContextWithMetadata, BuildSystemContentInput, DelegateTaskArgs, YcClient } from "./types"
import type { ParentContext } from "./types"
import { resolveMessageContext } from "../../hooks/context-injection/message-injector"
import { getSessionAgent } from "../../session/state"
import { log } from "../../util/logger"
import { getMessageDir } from "../../util/opencode-message-dir"

// --- Time Formatter ---

export function formatDuration(start: Date, end?: Date): string {
  const duration = (end ?? new Date()).getTime() - start.getTime()
  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

// --- Timing ---

let POLL_INTERVAL_MS = 1000
let MIN_STABILITY_TIME_MS = 10000
let STABILITY_POLLS_REQUIRED = 3
let WAIT_FOR_SESSION_INTERVAL_MS = 100
let WAIT_FOR_SESSION_TIMEOUT_MS = 30000
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60 * 1000
let MAX_POLL_TIME_MS = DEFAULT_POLL_TIMEOUT_MS
let SESSION_CONTINUATION_STABILITY_MS = 5000

export const DEFAULT_SYNC_POLL_TIMEOUT_MS = DEFAULT_POLL_TIMEOUT_MS

export function getDefaultSyncPollTimeoutMs(): number {
  return MAX_POLL_TIME_MS
}

export function getTimingConfig() {
  return {
    POLL_INTERVAL_MS,
    MIN_STABILITY_TIME_MS,
    STABILITY_POLLS_REQUIRED,
    WAIT_FOR_SESSION_INTERVAL_MS,
    WAIT_FOR_SESSION_TIMEOUT_MS,
    MAX_POLL_TIME_MS,
    SESSION_CONTINUATION_STABILITY_MS,
  }
}

export function __resetTimingConfig(): void {
  POLL_INTERVAL_MS = 1000
  MIN_STABILITY_TIME_MS = 10000
  STABILITY_POLLS_REQUIRED = 3
  WAIT_FOR_SESSION_INTERVAL_MS = 100
  WAIT_FOR_SESSION_TIMEOUT_MS = 30000
  MAX_POLL_TIME_MS = DEFAULT_POLL_TIMEOUT_MS
  SESSION_CONTINUATION_STABILITY_MS = 5000
}

export function __setTimingConfig(overrides: Partial<ReturnType<typeof getTimingConfig>>): void {
  if (overrides.POLL_INTERVAL_MS !== undefined) POLL_INTERVAL_MS = overrides.POLL_INTERVAL_MS
  if (overrides.MIN_STABILITY_TIME_MS !== undefined) MIN_STABILITY_TIME_MS = overrides.MIN_STABILITY_TIME_MS
  if (overrides.STABILITY_POLLS_REQUIRED !== undefined) STABILITY_POLLS_REQUIRED = overrides.STABILITY_POLLS_REQUIRED
  if (overrides.WAIT_FOR_SESSION_INTERVAL_MS !== undefined) WAIT_FOR_SESSION_INTERVAL_MS = overrides.WAIT_FOR_SESSION_INTERVAL_MS
  if (overrides.WAIT_FOR_SESSION_TIMEOUT_MS !== undefined) WAIT_FOR_SESSION_TIMEOUT_MS = overrides.WAIT_FOR_SESSION_TIMEOUT_MS
  if (overrides.MAX_POLL_TIME_MS !== undefined) MAX_POLL_TIME_MS = overrides.MAX_POLL_TIME_MS
  if (overrides.SESSION_CONTINUATION_STABILITY_MS !== undefined) SESSION_CONTINUATION_STABILITY_MS = overrides.SESSION_CONTINUATION_STABILITY_MS
}

// --- Token Limiter ---

const CHARACTERS_PER_TOKEN = 4

export function estimateTokenCount(text: string): number {
  if (!text) {
    return 0
  }

  return Math.ceil(text.length / CHARACTERS_PER_TOKEN)
}

export function truncateToTokenBudget(content: string, maxTokens: number): string {
  if (!content || maxTokens <= 0) {
    return ""
  }

  const maxCharacters = maxTokens * CHARACTERS_PER_TOKEN
  if (content.length <= maxCharacters) {
    return content
  }

  const sliced = content.slice(0, maxCharacters)
  const lastNewline = sliced.lastIndexOf("\n")
  if (lastNewline > 0) {
    return `${sliced.slice(0, lastNewline)}\n[TRUNCATED]`
  }

  return `${sliced}\n[TRUNCATED]`
}

function joinSystemParts(parts: string[]): string | undefined {
  const filtered = parts.filter((part) => part.trim().length > 0)
  if (filtered.length === 0) {
    return undefined
  }

  return filtered.join("\n\n")
}

function reduceSegmentToFitBudget(content: string, overflowTokens: number): string {
  if (overflowTokens <= 0 || !content) {
    return content
  }

  const currentTokens = estimateTokenCount(content)
  const nextBudget = Math.max(0, currentTokens - overflowTokens)
  return truncateToTokenBudget(content, nextBudget)
}

export function buildSystemContentWithTokenLimit(
  input: BuildSystemContentInput,
  maxTokens: number | undefined
): string | undefined {
  const skillParts = input.skillContents?.length
    ? [...input.skillContents]
    : input.skillContent
      ? [input.skillContent]
      : []
  const categoryPromptAppend = input.categoryPromptAppend ?? ""
  const agentsContext = input.agentsContext ?? input.planAgentPrepend ?? ""

  if (maxTokens === undefined) {
    return joinSystemParts([agentsContext, ...skillParts, categoryPromptAppend])
  }

  let nextSkills = [...skillParts]
  let nextCategoryPromptAppend = categoryPromptAppend
  let nextAgentsContext = agentsContext

  const buildCurrentContent = (): string | undefined =>
    joinSystemParts([nextAgentsContext, ...nextSkills, nextCategoryPromptAppend])

  let systemContent = buildCurrentContent()
  if (!systemContent) {
    return undefined
  }

  let overflowTokens = estimateTokenCount(systemContent) - maxTokens

  if (overflowTokens > 0) {
    for (let index = 0; index < nextSkills.length && overflowTokens > 0; index += 1) {
      const skill = nextSkills[index]
      const reducedSkill = reduceSegmentToFitBudget(skill, overflowTokens)
      nextSkills[index] = reducedSkill
      systemContent = buildCurrentContent()
      if (!systemContent) {
        return undefined
      }
      overflowTokens = estimateTokenCount(systemContent) - maxTokens
    }

    nextSkills = nextSkills.filter((skill) => skill.trim().length > 0)
    systemContent = buildCurrentContent()
    if (!systemContent) {
      return undefined
    }
    overflowTokens = estimateTokenCount(systemContent) - maxTokens
  }

  if (overflowTokens > 0 && nextCategoryPromptAppend) {
    nextCategoryPromptAppend = reduceSegmentToFitBudget(nextCategoryPromptAppend, overflowTokens)
    systemContent = buildCurrentContent()
    if (!systemContent) {
      return undefined
    }
    overflowTokens = estimateTokenCount(systemContent) - maxTokens
  }

  if (overflowTokens > 0 && nextAgentsContext) {
    nextAgentsContext = reduceSegmentToFitBudget(nextAgentsContext, overflowTokens)
    systemContent = buildCurrentContent()
    if (!systemContent) {
      return undefined
    }
  }

  if (!systemContent) {
    return undefined
  }

  return truncateToTokenBudget(systemContent, maxTokens)
}

// --- Error Formatting ---

export interface ErrorContext {
  operation: string
  args?: DelegateTaskArgs
  sessionID?: string
  agent?: string
  category?: string
}

export function formatDetailedError(error: unknown, ctx: ErrorContext): string {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? error.stack : undefined

  const lines: string[] = [`${ctx.operation} failed`, "", `**Error**: ${message}`]

  if (ctx.sessionID) {
    lines.push(`**Session ID**: ${ctx.sessionID}`)
  }

  if (ctx.agent) {
    lines.push(`**Agent**: ${ctx.agent}${ctx.category ? ` (category: ${ctx.category})` : ""}`)
  }

  if (ctx.args) {
    lines.push("", "**Arguments**:")
    lines.push(`- description: "${ctx.args.description}"`)
    lines.push(`- category: ${ctx.args.category ?? "(none)"}`)
    lines.push(`- subagent_type: ${ctx.args.subagent_type ?? "(none)"}`)
    lines.push(`- run_in_background: ${ctx.args.run_in_background}`)
    lines.push(`- load_skills: [${ctx.args.load_skills?.join(", ") ?? ""}]`)
    if (ctx.args.session_id) {
      lines.push(`- session_id: ${ctx.args.session_id}`)
    }
  }

  if (stack) {
    lines.push("", "**Stack Trace**:")
    lines.push("```")
    lines.push(stack.split("\n").slice(0, 10).join("\n"))
    lines.push("```")
  }

  return lines.join("\n")
}

// --- Parent Context Resolver ---

export async function resolveParentContext(
  ctx: ToolContextWithMetadata,
  client: YcClient
): Promise<ParentContext> {
  const messageDir = getMessageDir(ctx.sessionID)
  const { prevMessage, firstMessageAgent } = await resolveMessageContext(
    ctx.sessionID,
    client,
    messageDir
  )

  const sessionAgent = getSessionAgent(ctx.sessionID)
  const parentAgent = ctx.agent ?? sessionAgent ?? firstMessageAgent ?? prevMessage?.agent

  log("[task] parentAgent resolution", {
    sessionID: ctx.sessionID,
    messageDir,
    ctxAgent: ctx.agent,
    sessionAgent,
    firstMessageAgent,
    prevMessageAgent: prevMessage?.agent,
    resolvedParentAgent: parentAgent,
  })

  const parentModel = prevMessage?.model?.providerID && prevMessage?.model?.modelID
    ? {
        providerID: prevMessage.model.providerID,
        modelID: prevMessage.model.modelID,
        ...(prevMessage.model.variant ? { variant: prevMessage.model.variant } : {}),
      }
    : undefined

  return {
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    agent: parentAgent,
    model: parentModel,
  }
}

// --- Model String Parser ---

export function parseModelString(model: string): { providerID: string; modelID: string } | undefined {
  const parts = model.split("/")
  if (parts.length >= 2) {
    return { providerID: parts[0], modelID: parts.slice(1).join("/") }
  }
  return undefined
}
