// Merged from: iteration-continuation.ts + loop-session-recovery.ts

import type { PluginInput } from "../../../plugin/sdk"
import type { RalphLoopState } from "./types"
import { log } from "../../../util/logger"
import { HOOK_NAME } from "./types"
import { buildContinuationPrompt } from "./continuation-prompt-builder"
import { injectContinuationPrompt } from "./continuation-prompt-injector"
import { createIterationSession, selectSessionInTui } from "./session-reset-strategy"

// --- Iteration Continuation ---

type ContinuationOptions = {
  directory: string
  apiTimeoutMs: number
  previousSessionID: string
  loopState: {
    setSessionID: (sessionID: string) => RalphLoopState | null
  }
}

export async function continueIteration(
  ctx: PluginInput,
  state: RalphLoopState,
  options: ContinuationOptions,
): Promise<void> {
  const strategy = state.strategy ?? "continue"
  const continuationPrompt = buildContinuationPrompt(state)

  if (strategy === "reset") {
    const newSessionID = await createIterationSession(
      ctx,
      options.previousSessionID,
      options.directory,
    )
    if (!newSessionID) {
      return
    }

    await injectContinuationPrompt(ctx, {
      sessionID: newSessionID,
      inheritFromSessionID: options.previousSessionID,
      prompt: continuationPrompt,
      directory: options.directory,
      apiTimeoutMs: options.apiTimeoutMs,
    })

    await selectSessionInTui(ctx.client, newSessionID)

    const boundState = options.loopState.setSessionID(newSessionID)
    if (!boundState) {
      log(`[${HOOK_NAME}] Failed to bind loop state to new session`, {
        previousSessionID: options.previousSessionID,
        newSessionID,
      })
      return
    }

    return
  }

  await injectContinuationPrompt(ctx, {
    sessionID: options.previousSessionID,
    prompt: continuationPrompt,
    directory: options.directory,
    apiTimeoutMs: options.apiTimeoutMs,
  })
}

// --- Loop Session Recovery ---

type SessionState = {
	isRecovering?: boolean
}

export function createLoopSessionRecovery(options?: { recoveryWindowMs?: number }) {
	const recoveryWindowMs = options?.recoveryWindowMs ?? 5000
	const sessions = new Map<string, SessionState>()

	function getSessionState(sessionID: string): SessionState {
		let state = sessions.get(sessionID)
		if (!state) {
			state = {}
			sessions.set(sessionID, state)
		}
		return state
	}

	return {
		isRecovering(sessionID: string): boolean {
			return getSessionState(sessionID).isRecovering === true
		},
		markRecovering(sessionID: string): void {
			const state = getSessionState(sessionID)
			state.isRecovering = true
			setTimeout(() => {
				state.isRecovering = false
			}, recoveryWindowMs)
		},
		clear(sessionID: string): void {
			sessions.delete(sessionID)
		},
	}
}
