// Merged from constants.ts

export { YC_STORAGE, MESSAGE_STORAGE, PART_STORAGE } from "../../config/opencode-storage-paths"

export const THINKING_TYPES = new Set(["thinking", "redacted_thinking", "reasoning"])
export const META_TYPES = new Set(["step-start", "step-finish"])
export const CONTENT_TYPES = new Set(["text", "tool", "tool_use", "tool_result"])

// Types

export type ThinkingPartType = "thinking" | "redacted_thinking" | "reasoning"
export type MetaPartType = "step-start" | "step-finish"
export type ContentPartType = "text" | "tool" | "tool_use" | "tool_result"

export interface StoredMessageMeta {
  id: string
  sessionID: string
  role: "user" | "assistant"
  parentID?: string
  time?: {
    created: number
    completed?: number
  }
  error?: unknown
}

export interface StoredTextPart {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
  ignored?: boolean
}

export interface StoredToolPart {
  id: string
  sessionID: string
  messageID: string
  type: "tool"
  callID: string
  tool: string
  state: {
    status: "pending" | "running" | "completed" | "error"
    input: Record<string, unknown>
    output?: string
    error?: string
  }
}

export interface StoredReasoningPart {
  id: string
  sessionID: string
  messageID: string
  type: "reasoning"
  text: string
}

export interface StoredStepPart {
  id: string
  sessionID: string
  messageID: string
  type: "step-start" | "step-finish"
}

export type StoredPart = StoredTextPart | StoredToolPart | StoredReasoningPart | StoredStepPart | {
  id: string
  sessionID: string
  messageID: string
  type: string
  [key: string]: unknown
}

export interface MessageData {
  info?: {
    id?: string
    role?: string
    sessionID?: string
    parentID?: string
    error?: unknown
    agent?: string
    model?: {
      providerID: string
      modelID: string
    }
    system?: string
    tools?: Record<string, boolean>
  }
  parts?: Array<{
    type: string
    id?: string
    text?: string
    thinking?: string
    name?: string
    input?: Record<string, unknown>
    callID?: string
  }>
}

export interface ResumeConfig {
  sessionID: string
  agent?: string
  model?: {
    providerID: string
    modelID: string
  }
  tools?: Record<string, boolean>
}

// Merged from detect-error-type.ts

export type RecoveryErrorType =
  | "tool_result_missing"
  | "thinking_block_order"
  | "thinking_disabled_violation"
  | "assistant_prefill_unsupported"
  | "unavailable_tool"
  | null

function getErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error.toLowerCase()

  const errorObj = error as Record<string, unknown>
  const paths = [errorObj.data, errorObj.error, errorObj, (errorObj.data as Record<string, unknown>)?.error]

  for (const obj of paths) {
    if (obj && typeof obj === "object") {
      const msg = (obj as Record<string, unknown>).message
      if (typeof msg === "string" && msg.length > 0) {
        return msg.toLowerCase()
      }
    }
  }

  try {
    return JSON.stringify(error).toLowerCase()
  } catch {
    return ""
  }
}

export function extractMessageIndex(error: unknown): number | null {
  try {
    const message = getErrorMessage(error)
    const match = message.match(/messages\.(\d+)/)
    return match ? parseInt(match[1], 10) : null
  } catch {
    return null
  }
}

export function extractUnavailableToolName(error: unknown): string | null {
  try {
    const message = getErrorMessage(error)
    const match = message.match(/(?:unavailable tool|no such tool)[:\s'"]+([^'".\s]+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export function detectErrorType(error: unknown): RecoveryErrorType {
  try {
    const message = getErrorMessage(error)

    if (
      message.includes("assistant message prefill") ||
      message.includes("conversation must end with a user message")
    ) {
      return "assistant_prefill_unsupported"
    }

    if (
      message.includes("thinking") &&
      (message.includes("first block") ||
        message.includes("must start with") ||
        message.includes("preceding") ||
        message.includes("preceeding") ||
        message.includes("final block") ||
        message.includes("cannot be thinking") ||
        (message.includes("expected") && message.includes("found")))
    ) {
      return "thinking_block_order"
    }

    if (message.includes("thinking is disabled") && message.includes("cannot contain")) {
      return "thinking_disabled_violation"
    }

    if (message.includes("tool_use") && message.includes("tool_result")) {
      return "tool_result_missing"
    }

    if (
      message.includes("dummy_tool") ||
      message.includes("unavailable tool") ||
      message.includes("model tried to call unavailable") ||
      message.includes("nosuchtoolerror") ||
      message.includes("no such tool")
    ) {
      return "unavailable_tool"
    }

    return null
  } catch {
    return null
  }
}
