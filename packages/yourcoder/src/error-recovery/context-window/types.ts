import type { PluginInput } from "../../plugin/sdk"

export type Client = PluginInput["client"] & {
  session: {
    promptAsync: (opts: {
      path: { id: string }
      body: { parts: Array<{ type: string; text: string }> }
      query: { directory: string }
    }) => Promise<unknown>
  }
  tui: {
    showToast: (opts: {
      body: {
        title: string
        message: string
        variant: string
        duration: number
      }
    }) => Promise<unknown>
  }
}

export interface ParsedTokenLimitError {
  currentTokens: number
  maxTokens: number
  requestId?: string
  errorType: string
  providerID?: string
  modelID?: string
  messageIndex?: number
}

export interface RetryState {
  attempt: number
  lastAttemptTime: number
  firstAttemptTime: number
}

export interface TruncateState {
  truncateAttempt: number
  lastTruncatedPartId?: string
}

export interface AutoCompactState {
  pendingCompact: Set<string>
  errorDataBySession: Map<string, ParsedTokenLimitError>
  retryStateBySession: Map<string, RetryState>
  truncateStateBySession: Map<string, TruncateState>
  emptyContentAttemptBySession: Map<string, number>
  compactionInProgress: Set<string>
}

export const RETRY_CONFIG = {
  maxAttempts: 2,
  initialDelayMs: 2000,
  backoffFactor: 2,
  maxDelayMs: 30000,
} as const

export const TRUNCATE_CONFIG = {
  maxTruncateAttempts: 20,
  minOutputSizeToTruncate: 500,
  targetTokenRatio: 0.5,
  charsPerToken: 4,
} as const

// Merged from storage-paths.ts

import { MESSAGE_STORAGE, PART_STORAGE } from "../../config/opencode-storage-paths"

export { MESSAGE_STORAGE as MESSAGE_STORAGE_DIR, PART_STORAGE as PART_STORAGE_DIR }

export const TRUNCATION_MESSAGE =
	"[TOOL RESULT TRUNCATED - Context limit exceeded. Original output was too large and has been truncated to recover the session. Please re-run this tool if you need the full output.]"

// Merged from state.ts

export function getOrCreateRetryState(
  autoCompactState: AutoCompactState,
  sessionID: string,
): RetryState {
  let state = autoCompactState.retryStateBySession.get(sessionID)
  if (!state) {
    state = { attempt: 0, lastAttemptTime: 0, firstAttemptTime: 0 }
    autoCompactState.retryStateBySession.set(sessionID, state)
  }
  return state
}

export function getOrCreateTruncateState(
  autoCompactState: AutoCompactState,
  sessionID: string,
): TruncateState {
  let state = autoCompactState.truncateStateBySession.get(sessionID)
  if (!state) {
    state = { truncateAttempt: 0 }
    autoCompactState.truncateStateBySession.set(sessionID, state)
  }
  return state
}

export function clearSessionState(
  autoCompactState: AutoCompactState,
  sessionID: string,
): void {
  autoCompactState.pendingCompact.delete(sessionID)
  autoCompactState.errorDataBySession.delete(sessionID)
  autoCompactState.retryStateBySession.delete(sessionID)
  autoCompactState.truncateStateBySession.delete(sessionID)
  autoCompactState.emptyContentAttemptBySession.delete(sessionID)
  autoCompactState.compactionInProgress.delete(sessionID)
}

export function getEmptyContentAttempt(
  autoCompactState: AutoCompactState,
  sessionID: string,
): number {
  return autoCompactState.emptyContentAttemptBySession.get(sessionID) ?? 0
}

export function incrementEmptyContentAttempt(
  autoCompactState: AutoCompactState,
  sessionID: string,
): number {
  const attempt = getEmptyContentAttempt(autoCompactState, sessionID)
  autoCompactState.emptyContentAttemptBySession.set(sessionID, attempt + 1)
  return attempt
}

// Merged from pruning-types.ts

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
		time?: {
			start: number
			end?: number
			compacted?: number
		}
	}
	truncated?: boolean
	originalSize?: number
}

export interface ToolResultInfo {
	partPath: string
	partId: string
	messageID: string
	toolName: string
	outputSize: number
}

export interface AggressiveTruncateResult {
	success: boolean
	sufficient: boolean
	truncatedCount: number
	totalBytesRemoved: number
	targetBytesToRemove: number
	truncatedTools: Array<{ toolName: string; originalSize: number }>
}

export interface ToolCallSignature {
  toolName: string
  signature: string
  callID: string
  turn: number
}

export interface FileOperation {
  callID: string
  tool: string
  filePath: string
  turn: number
}

export interface ErroredToolCall {
  callID: string
  toolName: string
  turn: number
  errorAge: number
}

export interface PruningResult {
  itemsPruned: number
  totalTokensSaved: number
  strategies: {
    deduplication: number
    supersedeWrites: number
    purgeErrors: number
  }
}

export interface PruningState {
  toolIdsToPrune: Set<string>
  currentTurn: number
  fileOperations: Map<string, FileOperation[]>
  toolSignatures: Map<string, ToolCallSignature[]>
  erroredTools: Map<string, ErroredToolCall>
}

export const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}
