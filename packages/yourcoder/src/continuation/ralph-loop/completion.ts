// Merged from: completion-handler.ts + completion-promise-detector.ts

import type { PluginInput } from "../../plugin/sdk"
import { existsSync, readFileSync } from "node:fs"
import { log } from "../../util/logger"
import { buildContinuationPrompt } from "./continuation-prompt-builder"
import { HOOK_NAME } from "./types"
import { injectContinuationPrompt } from "./continuation-prompt-injector"
import type { RalphLoopState } from "./types"
import { withTimeout } from "./with-timeout"

// --- Completion Handler ---

type LoopStateController = {
	clear: () => boolean
	markVerificationPending: (sessionID: string) => RalphLoopState | null
}

export async function handleDetectedCompletion(
	ctx: PluginInput,
	input: {
		sessionID: string
		state: RalphLoopState
		loopState: LoopStateController
		directory: string
		apiTimeoutMs: number
	},
): Promise<void> {
	const { sessionID, state, loopState, directory, apiTimeoutMs } = input

	if (state.ultrawork && !state.verification_pending) {
		const verificationState = loopState.markVerificationPending(sessionID)
		if (!verificationState) {
			log(`[${HOOK_NAME}] Failed to transition ultrawork loop to verification`, {
				sessionID,
			})
			return
		}

		await injectContinuationPrompt(ctx, {
			sessionID,
			prompt: buildContinuationPrompt(verificationState),
			directory,
			apiTimeoutMs,
		})

		await ctx.client.tui?.showToast?.({
			body: {
				title: "ULTRAWORK LOOP",
				message: "DONE detected. Oracle verification is now required.",
				variant: "info",
				duration: 5000,
			},
		}).catch(() => {})
		return
	}

	loopState.clear()

	const title = state.ultrawork ? "ULTRAWORK LOOP COMPLETE!" : "Ralph Loop Complete!"
	const message = state.ultrawork
		? `JUST ULW ULW! Task completed after ${state.iteration} iteration(s)`
		: `Task completed after ${state.iteration} iteration(s)`
	await ctx.client.tui?.showToast?.({
		body: { title, message, variant: "success", duration: 5000 },
	}).catch(() => {})
}

// --- Completion Promise Detector ---

interface OpenCodeSessionMessage {
	info?: { role?: string }
	parts?: Array<{ type: string; text?: string }>
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function buildPromisePattern(promise: string): RegExp {
	return new RegExp(`<promise>\\s*${escapeRegex(promise)}\\s*</promise>`, "is")
}

export function detectCompletionInTranscript(
	transcriptPath: string | undefined,
	promise: string,
	startedAt?: string,
): boolean {
	if (!transcriptPath) return false

	try {
		if (!existsSync(transcriptPath)) return false

		const content = readFileSync(transcriptPath, "utf-8")
		const pattern = buildPromisePattern(promise)
		const lines = content.split("\n").filter((line) => line.trim())

		for (const line of lines) {
			try {
				const entry = JSON.parse(line) as { type?: string; timestamp?: string }
				if (entry.type === "user") continue
				if (startedAt && entry.timestamp && entry.timestamp < startedAt) continue
				if (pattern.test(line)) return true
			} catch {
				continue
			}
		}
		return false
	} catch {
		return false
	}
}

export async function detectCompletionInSessionMessages(
	ctx: PluginInput,
	options: {
		sessionID: string
		promise: string
		apiTimeoutMs: number
		directory: string
		sinceMessageIndex?: number
	},
): Promise<boolean> {
	try {
		const response = await withTimeout(
			ctx.client.session.messages({
				path: { id: options.sessionID },
				query: { directory: options.directory },
			}),
			options.apiTimeoutMs,
		)

		const messagesResponse: unknown = response
		const responseData =
			typeof messagesResponse === "object" && messagesResponse !== null && "data" in messagesResponse
				? (messagesResponse as { data?: unknown }).data
				: undefined

		const messageArray: unknown[] = Array.isArray(messagesResponse)
			? messagesResponse
			: Array.isArray(responseData)
				? responseData
				: []

		const scopedMessages =
			typeof options.sinceMessageIndex === "number" && options.sinceMessageIndex >= 0 && options.sinceMessageIndex < messageArray.length
				? messageArray.slice(options.sinceMessageIndex)
				: messageArray

		const assistantMessages = (scopedMessages as OpenCodeSessionMessage[]).filter((msg) => msg.info?.role === "assistant")
		if (assistantMessages.length === 0) return false

		const pattern = buildPromisePattern(options.promise)
		for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
			const assistant = assistantMessages[index]
			if (!assistant.parts) continue

			let responseText = ""
			for (const part of assistant.parts) {
				if (part.type !== "text") continue
				responseText += `${responseText ? "\n" : ""}${part.text ?? ""}`
			}

			if (pattern.test(responseText)) {
				return true
			}
		}

		return false
	} catch (err) {
		setTimeout(() => {
			log(`[${HOOK_NAME}] Session messages check failed`, {
				sessionID: options.sessionID,
				error: String(err),
			})
		}, 0)
		return false
	}
}
