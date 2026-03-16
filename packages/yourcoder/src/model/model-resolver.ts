import type { FallbackEntry } from "./model-requirements"
import { normalizeModel } from "./model-normalization"
import { resolveModelPipeline } from "./model-resolution-pipeline"
export type { ModelSource, ModelResolutionResult } from "./model-resolution-pipeline"

export type ModelResolutionInput = {
	userModel?: string
	inheritedModel?: string
	systemDefault?: string
}

export type ExtendedModelResolutionInput = {
	uiSelectedModel?: string
	userModel?: string
	userFallbackModels?: string[]
	categoryDefaultModel?: string
	fallbackChain?: FallbackEntry[]
	availableModels: Set<string>
	systemDefaultModel?: string
}


export function resolveModel(input: ModelResolutionInput): string | undefined {
	return (
		normalizeModel(input.userModel) ??
		normalizeModel(input.inheritedModel) ??
		input.systemDefault
	)
}

export function resolveModelWithFallback(
	input: ExtendedModelResolutionInput,
) {
	const { uiSelectedModel, userModel, userFallbackModels, categoryDefaultModel, fallbackChain, availableModels, systemDefaultModel } = input
	return resolveModelPipeline({
		intent: { uiSelectedModel, userModel, userFallbackModels, categoryDefaultModel },
		constraints: { availableModels },
		policy: { fallbackChain, systemDefaultModel },
	})
}

/**
 * Normalizes fallback_models config (which can be string or string[]) to string[]
 * Centralized helper to avoid duplicated normalization logic
 */
export function normalizeFallbackModels(models: string | string[] | undefined): string[] | undefined {
	if (!models) return undefined
	if (typeof models === "string") return [models]
	return models
}
