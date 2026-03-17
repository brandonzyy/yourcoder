// Merged from: storage.ts + loop-state-controller.ts

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseFrontmatter } from "../../util/frontmatter"
import { log } from "../../util/logger"
import type { RalphLoopOptions, RalphLoopState } from "./types"
import {
	DEFAULT_COMPLETION_PROMISE,
	DEFAULT_MAX_ITERATIONS,
	DEFAULT_STATE_FILE,
	HOOK_NAME,
	ULTRAWORK_VERIFICATION_PROMISE,
} from "./types"

// --- Storage ---

export function getStateFilePath(directory: string, customPath?: string): string {
  return customPath
    ? join(directory, customPath)
    : join(directory, DEFAULT_STATE_FILE)
}

export function readState(directory: string, customPath?: string): RalphLoopState | null {
  const filePath = getStateFilePath(directory, customPath)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<Record<string, unknown>>(content)

    const active = data.active
    const iteration = data.iteration

    if (active === undefined || iteration === undefined) {
      return null
    }

    const isActive = active === true || active === "true"
    const iterationNum = typeof iteration === "number" ? iteration : Number(iteration)

    if (isNaN(iterationNum)) {
      return null
    }

    const stripQuotes = (val: unknown): string => {
      const str = String(val ?? "")
      return str.replace(/^["']|["']$/g, "")
    }

    const ultrawork = data.ultrawork === true || data.ultrawork === "true" ? true : undefined
    const maxIterations =
      data.max_iterations === undefined || data.max_iterations === ""
        ? ultrawork
          ? undefined
          : DEFAULT_MAX_ITERATIONS
        : Number(data.max_iterations) || DEFAULT_MAX_ITERATIONS

    return {
      active: isActive,
      iteration: iterationNum,
      max_iterations: maxIterations,
      message_count_at_start:
        typeof data.message_count_at_start === "number"
          ? data.message_count_at_start
          : typeof data.message_count_at_start === "string" && data.message_count_at_start.trim() !== ""
            ? Number(data.message_count_at_start)
            : undefined,
      completion_promise: stripQuotes(data.completion_promise) || DEFAULT_COMPLETION_PROMISE,
      initial_completion_promise: data.initial_completion_promise
        ? stripQuotes(data.initial_completion_promise)
        : undefined,
      verification_attempt_id: data.verification_attempt_id
        ? stripQuotes(data.verification_attempt_id)
        : undefined,
      verification_session_id: data.verification_session_id
        ? stripQuotes(data.verification_session_id)
        : undefined,
      started_at: stripQuotes(data.started_at) || new Date().toISOString(),
      prompt: body.trim(),
      session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
      ultrawork,
      verification_pending:
        data.verification_pending === true || data.verification_pending === "true"
          ? true
          : undefined,
      strategy: data.strategy === "reset" || data.strategy === "continue" ? data.strategy : undefined,
    }
  } catch {
    return null
  }
}

export function writeState(
  directory: string,
  state: RalphLoopState,
  customPath?: string
): boolean {
  const filePath = getStateFilePath(directory, customPath)

  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const sessionIdLine = state.session_id ? `session_id: "${state.session_id}"\n` : ""
    const ultraworkLine = state.ultrawork !== undefined ? `ultrawork: ${state.ultrawork}\n` : ""
    const verificationPendingLine =
      state.verification_pending !== undefined
        ? `verification_pending: ${state.verification_pending}\n`
        : ""
    const strategyLine = state.strategy ? `strategy: "${state.strategy}"\n` : ""
    const initialCompletionPromiseLine = state.initial_completion_promise
      ? `initial_completion_promise: "${state.initial_completion_promise}"\n`
      : ""
    const verificationAttemptLine = state.verification_attempt_id
      ? `verification_attempt_id: "${state.verification_attempt_id}"\n`
      : ""
    const verificationSessionLine = state.verification_session_id
      ? `verification_session_id: "${state.verification_session_id}"\n`
      : ""
    const messageCountAtStartLine =
      typeof state.message_count_at_start === "number"
        ? `message_count_at_start: ${state.message_count_at_start}\n`
        : ""
    const maxIterationsLine =
      typeof state.max_iterations === "number"
        ? `max_iterations: ${state.max_iterations}\n`
        : ""
    const content = `---
active: ${state.active}
iteration: ${state.iteration}
${maxIterationsLine}completion_promise: "${state.completion_promise}"
${initialCompletionPromiseLine}${verificationAttemptLine}${verificationSessionLine}started_at: "${state.started_at}"
${sessionIdLine}${ultraworkLine}${verificationPendingLine}${strategyLine}${messageCountAtStartLine}---
${state.prompt}
`

    writeFileSync(filePath, content, "utf-8")
    return true
  } catch {
    return false
  }
}

export function clearState(directory: string, customPath?: string): boolean {
  const filePath = getStateFilePath(directory, customPath)

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
}

export function incrementIteration(
  directory: string,
  customPath?: string
): RalphLoopState | null {
  const state = readState(directory, customPath)
  if (!state) return null

  state.iteration += 1
  if (writeState(directory, state, customPath)) {
    return state
  }
  return null
}

// --- Loop State Controller ---

export function createLoopStateController(options: {
	directory: string
	stateDir: string | undefined
	config: RalphLoopOptions["config"] | undefined
}) {
	const directory = options.directory
	const stateDir = options.stateDir
	const config = options.config

	return {
		startLoop(
			sessionID: string,
			prompt: string,
			loopOptions?: {
				maxIterations?: number
				completionPromise?: string
				messageCountAtStart?: number
				ultrawork?: boolean
				strategy?: "reset" | "continue"
			},
		): boolean {
			const initialCompletionPromise =
				loopOptions?.completionPromise ??
				DEFAULT_COMPLETION_PROMISE
			const state: RalphLoopState = {
				active: true,
				iteration: 1,
				max_iterations: loopOptions?.ultrawork
					? undefined
					: loopOptions?.maxIterations ??
						config?.default_max_iterations ??
						DEFAULT_MAX_ITERATIONS,
				message_count_at_start: loopOptions?.messageCountAtStart,
				completion_promise: initialCompletionPromise,
				initial_completion_promise: initialCompletionPromise,
				verification_attempt_id: undefined,
				verification_session_id: undefined,
				ultrawork: loopOptions?.ultrawork,
				verification_pending: undefined,
				strategy: loopOptions?.strategy ?? config?.default_strategy ?? "continue",
				started_at: new Date().toISOString(),
				prompt,
				session_id: sessionID,
			}

			const success = writeState(directory, state, stateDir)
			if (success) {
				log(`[${HOOK_NAME}] Loop started`, {
					sessionID,
					maxIterations: state.max_iterations,
					completionPromise: state.completion_promise,
				})
			}
			return success
		},

		cancelLoop(sessionID: string): boolean {
			const state = readState(directory, stateDir)
			if (!state || state.session_id !== sessionID) {
				return false
			}

			const success = clearState(directory, stateDir)
			if (success) {
				log(`[${HOOK_NAME}] Loop cancelled`, { sessionID, iteration: state.iteration })
			}
			return success
		},

		getState(): RalphLoopState | null {
			return readState(directory, stateDir)
		},

		clear(): boolean {
			return clearState(directory, stateDir)
		},

		incrementIteration(): RalphLoopState | null {
			return incrementIteration(directory, stateDir)
		},

		setSessionID(sessionID: string): RalphLoopState | null {
			const state = readState(directory, stateDir)
			if (!state) {
				return null
			}

			state.session_id = sessionID
			if (!writeState(directory, state, stateDir)) {
				return null
			}

			return state
		},

		setMessageCountAtStart(sessionID: string, messageCountAtStart: number): RalphLoopState | null {
			const state = readState(directory, stateDir)
			if (!state || state.session_id !== sessionID) {
				return null
			}

			state.message_count_at_start = messageCountAtStart
			if (!writeState(directory, state, stateDir)) {
				return null
			}

			return state
		},

		markVerificationPending(sessionID: string): RalphLoopState | null {
			const state = readState(directory, stateDir)
			if (!state || state.session_id !== sessionID || !state.ultrawork) {
				return null
			}

			state.verification_pending = true
			state.completion_promise = ULTRAWORK_VERIFICATION_PROMISE
			state.verification_attempt_id = undefined
			state.verification_session_id = undefined
			state.initial_completion_promise ??= DEFAULT_COMPLETION_PROMISE

			if (!writeState(directory, state, stateDir)) {
				return null
			}

			return state
		},

		setVerificationSessionID(sessionID: string, verificationSessionID: string): RalphLoopState | null {
			const state = readState(directory, stateDir)
			if (!state || state.session_id !== sessionID || !state.ultrawork || !state.verification_pending) {
				return null
			}

			state.verification_session_id = verificationSessionID

			if (!writeState(directory, state, stateDir)) {
				return null
			}

			return state
		},

		restartAfterFailedVerification(sessionID: string, messageCountAtStart?: number): RalphLoopState | null {
			const state = readState(directory, stateDir)
			if (!state || state.session_id !== sessionID || !state.ultrawork || !state.verification_pending) {
				return null
			}

			state.iteration += 1
			state.started_at = new Date().toISOString()
			state.completion_promise = state.initial_completion_promise ?? DEFAULT_COMPLETION_PROMISE
			state.verification_pending = undefined
			state.verification_attempt_id = undefined
			state.verification_session_id = undefined
			if (typeof messageCountAtStart === "number") {
				state.message_count_at_start = messageCountAtStart
			}

			if (!writeState(directory, state, stateDir)) {
				return null
			}

			return state
		},
	}
}
