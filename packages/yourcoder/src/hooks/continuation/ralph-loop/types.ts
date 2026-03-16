// Merged from: types.ts + constants.ts
import type { RalphLoopConfig } from "../../../config/plugin-schema"

export const HOOK_NAME = "ralph-loop"
export const DEFAULT_STATE_FILE = ".yac/ralph-loop.local.md"
export const COMPLETION_TAG_PATTERN = /<promise>(.*?)<\/promise>/is
export const DEFAULT_MAX_ITERATIONS = 100
export const DEFAULT_COMPLETION_PROMISE = "DONE"
export const ULTRAWORK_VERIFICATION_PROMISE = "VERIFIED"

export interface RalphLoopState {
  active: boolean
  iteration: number
  max_iterations?: number
  message_count_at_start?: number
  completion_promise: string
  initial_completion_promise?: string
  verification_attempt_id?: string
  verification_session_id?: string
  started_at: string
  prompt: string
  session_id?: string
  ultrawork?: boolean
  verification_pending?: boolean
  strategy?: "reset" | "continue"
}

export interface RalphLoopOptions {
  config?: RalphLoopConfig
  getTranscriptPath?: (sessionId: string) => string
  apiTimeout?: number
  checkSessionExists?: (sessionId: string) => Promise<boolean>
}
