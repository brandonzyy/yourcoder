import type { PluginInput } from "../../../plugin/sdk"
import { log } from "../../../util/logger"
import { buildVerificationFailurePrompt } from "./continuation-prompt-builder"
import { HOOK_NAME } from "./types"
import { injectContinuationPrompt } from "./continuation-prompt-injector"
import { getMessageCountFromResponse } from "./ralph-loop-hook"
import type { RalphLoopState } from "./types"

type LoopStateController = {
	restartAfterFailedVerification: (
		sessionID: string,
		messageCountAtStart?: number,
	) => RalphLoopState | null
}

async function getSessionMessageCount(
	ctx: PluginInput,
	sessionID: string,
	directory: string,
): Promise<number> {
	const messagesResponse = await ctx.client.session.messages({
		path: { id: sessionID },
		query: { directory },
	})

	return getMessageCountFromResponse(messagesResponse)
}

export async function handleFailedVerification(
	ctx: PluginInput,
	input: {
		state: RalphLoopState
		directory: string
		apiTimeoutMs: number
		loopState: LoopStateController
	},
): Promise<boolean> {
	const { state, directory, apiTimeoutMs, loopState } = input
	const parentSessionID = state.session_id
	if (!parentSessionID) {
		return false
	}

	let messageCountAtStart: number
	try {
		messageCountAtStart = await getSessionMessageCount(ctx, parentSessionID, directory)
	} catch (error) {
		log(`[${HOOK_NAME}] Failed to read parent session before verification retry`, {
			parentSessionID,
			error: String(error),
		})
		return false
	}

	const resumedState = loopState.restartAfterFailedVerification(
		parentSessionID,
		messageCountAtStart,
	)
	if (!resumedState) {
		log(`[${HOOK_NAME}] Failed to restart loop after verification failure`, {
			parentSessionID,
		})
		return false
	}

	await injectContinuationPrompt(ctx, {
		sessionID: parentSessionID,
		prompt: buildVerificationFailurePrompt(resumedState),
		directory,
		apiTimeoutMs,
	})

	await ctx.client.tui?.showToast?.({
		body: {
			title: "ULTRAWORK LOOP",
			message: "Oracle verification failed. Continuing ULTRAWORK loop.",
			variant: "warning",
			duration: 5000,
		},
	}).catch(() => {})

	return true
}
