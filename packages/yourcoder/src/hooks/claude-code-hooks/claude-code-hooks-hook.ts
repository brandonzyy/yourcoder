import type { PluginInput } from "../../plugin/sdk"
import type { PluginConfig, ClaudeHookEvent } from "./types"
import type { ContextCollector } from "../context-injection/context-injector"
import { loadClaudeHooksConfig } from "./config"
import { loadPluginExtendedConfig } from "./config"
import {
	executeUserPromptSubmitHooks,
	type MessagePart,
	type UserPromptSubmitContext,
} from "./user-prompt-submit"
import { executePreToolUseHooks, type PreToolUseContext } from "./pre-tool-use"
import {
	executePostToolUseHooks,
	type PostToolUseClient,
	type PostToolUseContext,
} from "./post-tool-use"
import { executeStopHooks, type StopContext } from "./stop"
import { executePreCompactHooks, type PreCompactContext } from "./pre-compact"
import { getToolInput, cacheToolInput } from "./state"
import {
	sessionFirstMessageProcessed,
	sessionInterruptState,
	clearSessionHookState,
	sessionErrorState,
} from "./state"
import { appendTranscriptEntry, getTranscriptPath } from "./transcript"
import { log } from "../../util/logger"
import { createInternalAgentTextPart } from "../../util/internal-initiator-marker"

// --- Hook disabled check (inlined from shared/hook-disabled.ts) ---

function isHookDisabled(
	config: PluginConfig,
	hookType: ClaudeHookEvent,
): boolean {
	const { disabledHooks } = config
	if (disabledHooks === undefined) return false
	if (disabledHooks === true) return true
	if (Array.isArray(disabledHooks)) return disabledHooks.includes(hookType)
	return false
}

// --- Chat message handler ---

function createChatMessageHandler(
	ctx: PluginInput,
	config: PluginConfig,
	contextCollector?: ContextCollector,
) {
	return async (
		input: {
			sessionID: string
			agent?: string
			model?: { providerID: string; modelID: string }
			messageID?: string
		},
		output: {
			message: Record<string, unknown>
			parts: Array<{ type: string; text?: string; [key: string]: unknown }>
		},
	): Promise<void> => {
		const interruptState = sessionInterruptState.get(input.sessionID)
		if (interruptState?.interrupted) {
			log("chat.message hook skipped - session interrupted", {
				sessionID: input.sessionID,
			})
			return
		}

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		const textParts = output.parts.filter((p) => p.type === "text" && p.text)
		const prompt = textParts.map((p) => p.text ?? "").join("\n")

		appendTranscriptEntry(input.sessionID, {
			type: "user",
			timestamp: new Date().toISOString(),
			content: prompt,
		})

		const messageParts: MessagePart[] = textParts.map((p) => ({
			type: "text",
			text: p.text,
		}))

		const interruptStateBeforeHooks = sessionInterruptState.get(input.sessionID)
		if (interruptStateBeforeHooks?.interrupted) {
			log("chat.message hooks skipped - interrupted during preparation", {
				sessionID: input.sessionID,
			})
			return
		}

		let parentSessionId: string | undefined
		try {
			const sessionInfo = await ctx.client.session.get({
				path: { id: input.sessionID },
			})
			parentSessionId = sessionInfo.data?.parentID
		} catch {
			parentSessionId = undefined
		}

		const isFirstMessage = !sessionFirstMessageProcessed.has(input.sessionID)
		sessionFirstMessageProcessed.add(input.sessionID)

		if (isHookDisabled(config, "UserPromptSubmit")) {
			return
		}

		const userPromptCtx: UserPromptSubmitContext = {
			sessionId: input.sessionID,
			parentSessionId,
			prompt,
			parts: messageParts,
			cwd: ctx.directory,
		}

		const result = await executeUserPromptSubmitHooks(
			userPromptCtx,
			claudeConfig,
			extendedConfig,
		)

		if (result.block) {
			throw new Error(result.reason ?? "Hook blocked the prompt")
		}

		const interruptStateAfterHooks = sessionInterruptState.get(input.sessionID)
		if (interruptStateAfterHooks?.interrupted) {
			log("chat.message injection skipped - interrupted during hooks", {
				sessionID: input.sessionID,
			})
			return
		}

		if (result.messages.length === 0) {
			return
		}

		const hookContent = result.messages.join("\n\n")
		log(`[claude-code-hooks] Injecting ${result.messages.length} hook messages`, {
			sessionID: input.sessionID,
			contentLength: hookContent.length,
			isFirstMessage,
		})

		if (!contextCollector) {
			return
		}

		log("[DEBUG] Registering hook content to contextCollector", {
			sessionID: input.sessionID,
			contentLength: hookContent.length,
			contentPreview: hookContent.slice(0, 100),
		})
		contextCollector.register(input.sessionID, {
			id: "hook-context",
			source: "custom",
			content: hookContent,
			priority: "high",
		})

		log("Hook content registered for synthetic message injection", {
			sessionID: input.sessionID,
			contentLength: hookContent.length,
		})
	}
}

// --- Pre-compact handler ---

function createPreCompactHandler(ctx: PluginInput, config: PluginConfig) {
	return async (
		input: { sessionID: string },
		output: { context: string[] },
	): Promise<void> => {
		if (isHookDisabled(config, "PreCompact")) {
			return
		}

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		const preCompactCtx: PreCompactContext = {
			sessionId: input.sessionID,
			cwd: ctx.directory,
		}

		const result = await executePreCompactHooks(
			preCompactCtx,
			claudeConfig,
			extendedConfig,
		)

		if (result.context.length > 0) {
			log("PreCompact hooks injecting context", {
				sessionID: input.sessionID,
				contextCount: result.context.length,
				hookName: result.hookName,
				elapsedMs: result.elapsedMs,
			})
			output.context.push(...result.context)
		}
	}
}

// --- Session event handler ---

function createSessionEventHandler(ctx: PluginInput, config: PluginConfig) {
	return async (input: { event: { type: string; properties?: unknown } }) => {
		const { event } = input

		if (event.type === "session.error") {
			const props = event.properties as Record<string, unknown> | undefined
			const sessionID = props?.sessionID as string | undefined
			if (sessionID) {
				sessionErrorState.set(sessionID, {
					hasError: true,
					errorMessage: String(props?.error ?? "Unknown error"),
				})
			}
			return
		}

		if (event.type === "session.deleted") {
			const props = event.properties as Record<string, unknown> | undefined
			const sessionInfo = props?.info as { id?: string } | undefined
			if (sessionInfo?.id) {
				clearSessionHookState(sessionInfo.id)
			}
			return
		}

		if (event.type !== "session.idle") {
			return
		}

		const props = event.properties as Record<string, unknown> | undefined
		const sessionID = props?.sessionID as string | undefined
		if (!sessionID) return

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		const errorStateBefore = sessionErrorState.get(sessionID)
		const endedWithErrorBefore = errorStateBefore?.hasError === true
		const interruptStateBefore = sessionInterruptState.get(sessionID)
		const interruptedBefore = interruptStateBefore?.interrupted === true

		let parentSessionId: string | undefined
		try {
			const sessionInfo = await ctx.client.session.get({
				path: { id: sessionID },
			})
			parentSessionId = sessionInfo.data?.parentID
		} catch {
			parentSessionId = undefined
		}

		if (!isHookDisabled(config, "Stop")) {
			const stopCtx: StopContext = {
				sessionId: sessionID,
				parentSessionId,
				cwd: ctx.directory,
			}

			const stopResult = await executeStopHooks(stopCtx, claudeConfig, extendedConfig)

			const errorStateAfter = sessionErrorState.get(sessionID)
			const endedWithErrorAfter = errorStateAfter?.hasError === true
			const interruptStateAfter = sessionInterruptState.get(sessionID)
			const interruptedAfter = interruptStateAfter?.interrupted === true

			const shouldBypass =
				endedWithErrorBefore ||
				endedWithErrorAfter ||
				interruptedBefore ||
				interruptedAfter

			if (shouldBypass && stopResult.block) {
				log("Stop hook block ignored", {
					sessionID,
					block: stopResult.block,
					interrupted: interruptedBefore || interruptedAfter,
					endedWithError: endedWithErrorBefore || endedWithErrorAfter,
				})
			} else if (stopResult.block && stopResult.injectPrompt) {
				log("Stop hook returned block with inject_prompt", { sessionID })
				ctx.client.session
					.prompt({
						path: { id: sessionID },
						body: {
							parts: [createInternalAgentTextPart(stopResult.injectPrompt)],
						},
						query: { directory: ctx.directory },
					})
					.catch((err: unknown) =>
						log("Failed to inject prompt from Stop hook", { error: String(err) }),
					)
			} else if (stopResult.block) {
				log("Stop hook returned block", { sessionID, reason: stopResult.reason })
			}
		}

		clearSessionHookState(sessionID)
	}
}

// --- Tool execute before handler ---

function createToolExecuteBeforeHandler(ctx: PluginInput, config: PluginConfig) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: { args: Record<string, unknown> },
	): Promise<void> => {
		if (input.tool.trim() === "todowrite" && typeof output.args.todos === "string") {
			let parsed: unknown
			try {
				parsed = JSON.parse(output.args.todos)
			} catch {
				throw new Error(
					`[todowrite ERROR] Failed to parse todos string as JSON. ` +
						`Received: ${
							output.args.todos.length > 100
								? output.args.todos.slice(0, 100) + "..."
								: output.args.todos
						} ` +
						`Expected: Valid JSON array. Pass todos as an array, not a string.`,
				)
			}

			if (!Array.isArray(parsed)) {
				throw new Error(
					`[todowrite ERROR] Parsed JSON is not an array. ` +
						`Received type: ${typeof parsed}. ` +
						`Expected: Array of todo objects. Pass todos as [{id, content, status, priority}, ...].`,
				)
			}

			output.args.todos = parsed
			log("todowrite: parsed todos string to array", { sessionID: input.sessionID })
		}

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		appendTranscriptEntry(input.sessionID, {
			type: "tool_use",
			timestamp: new Date().toISOString(),
			tool_name: input.tool,
			tool_input: output.args,
		})

		cacheToolInput(input.sessionID, input.tool, input.callID, output.args)

		if (isHookDisabled(config, "PreToolUse")) {
			return
		}

		const preCtx: PreToolUseContext = {
			sessionId: input.sessionID,
			toolName: input.tool,
			toolInput: output.args,
			cwd: ctx.directory,
			toolUseId: input.callID,
		}

		const result = await executePreToolUseHooks(preCtx, claudeConfig, extendedConfig)

		if (result.decision === "deny") {
			ctx.client.tui
				.showToast({
					body: {
						title: "PreToolUse Hook Executed",
						message: `[BLOCKED] ${result.toolName ?? input.tool} ${
							result.hookName ?? "hook"
						}: ${result.elapsedMs ?? 0}ms\n${result.inputLines ?? ""}`,
						variant: "error" as const,
						duration: 4000,
					},
				})
				.catch(() => {})
			throw new Error(result.reason ?? "Hook blocked the operation")
		}

		if (result.modifiedInput) {
			Object.assign(output.args, result.modifiedInput)
		}
	}
}

// --- Tool execute after handler ---

function createToolExecuteAfterHandler(ctx: PluginInput, config: PluginConfig) {
	return async (
		input: { tool: string; sessionID: string; callID: string },
		output: { title: string; output: string; metadata: unknown } | undefined,
	): Promise<void> => {
		if (!output) {
			return
		}

		const claudeConfig = await loadClaudeHooksConfig()
		const extendedConfig = await loadPluginExtendedConfig()

		const cachedInput = getToolInput(input.sessionID, input.tool, input.callID) || {}

		const metadata = output.metadata as Record<string, unknown> | undefined
		const hasMetadata =
			metadata && typeof metadata === "object" && Object.keys(metadata).length > 0
		const toolOutput = hasMetadata ? metadata : { output: output.output }

		appendTranscriptEntry(input.sessionID, {
			type: "tool_result",
			timestamp: new Date().toISOString(),
			tool_name: input.tool,
			tool_input: cachedInput,
			tool_output: toolOutput,
		})

		if (isHookDisabled(config, "PostToolUse")) {
			return
		}

		const postClient: PostToolUseClient = {
			session: {
				messages: (opts) => ctx.client.session.messages(opts),
			},
		}

		const postCtx: PostToolUseContext = {
			sessionId: input.sessionID,
			toolName: input.tool,
			toolInput: cachedInput,
			toolOutput: {
				title: input.tool,
				output: output.output,
				metadata: output.metadata as Record<string, unknown>,
			},
			cwd: ctx.directory,
			transcriptPath: getTranscriptPath(input.sessionID),
			toolUseId: input.callID,
			client: postClient,
			permissionMode: "bypassPermissions",
		}

		const result = await executePostToolUseHooks(postCtx, claudeConfig, extendedConfig)

		if (result.block) {
			ctx.client.tui
				.showToast({
					body: {
						title: "PostToolUse Hook Warning",
						message: result.reason ?? "Hook returned warning",
						variant: "warning",
						duration: 4000,
					},
				})
				.catch(() => {})
		}

		if (result.warnings && result.warnings.length > 0) {
			output.output = `${output.output}\n\n${result.warnings.join("\n")}`
		}

		if (result.message) {
			output.output = `${output.output}\n\n${result.message}`
		}

		if (result.hookName) {
			ctx.client.tui
				.showToast({
					body: {
						title: "PostToolUse Hook Executed",
						message: `▶ ${result.toolName ?? input.tool} ${result.hookName}: ${
							result.elapsedMs ?? 0
						}ms`,
						variant: "success",
						duration: 2000,
					},
				})
				.catch(() => {})
		}
	}
}

// --- Main hook factory ---

export function createClaudeCodeHooksHook(
	ctx: PluginInput,
	config: PluginConfig = {},
	contextCollector?: ContextCollector
) {
	return {
		"experimental.session.compacting": createPreCompactHandler(ctx, config),
		"chat.message": createChatMessageHandler(ctx, config, contextCollector),
		"tool.execute.before": createToolExecuteBeforeHandler(ctx, config),
		"tool.execute.after": createToolExecuteAfterHandler(ctx, config),
		event: createSessionEventHandler(ctx, config),
	}
}
