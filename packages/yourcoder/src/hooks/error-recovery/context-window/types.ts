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

import { MESSAGE_STORAGE, PART_STORAGE } from "../../../config/opencode-storage-paths"

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
