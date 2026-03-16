import { log } from "../util/logger"
import * as connectedProvidersCache from "../util/connected-providers-cache"
import { fuzzyMatchModel } from "./model-availability"
import type { FallbackEntry } from "./model-requirements"
import { transformModelForProvider } from "../util/provider-model-id-transform"
import { normalizeModel } from "./model-normalization"

export type ModelResolutionRequest = {
  intent?: {
    uiSelectedModel?: string
    userModel?: string
    userFallbackModels?: string[]
    categoryDefaultModel?: string
  }
  constraints: {
    availableModels: Set<string>
    connectedProviders?: string[] | null
  }
  policy?: {
    fallbackChain?: FallbackEntry[]
    systemDefaultModel?: string
  }
}

export type ModelSource =
  | "override"
  | "category-default"
  | "provider-fallback"
  | "system-default"

export type ModelResolutionResult = {
  model: string
  source: ModelSource
  variant?: string
  attempted?: string[]
  reason?: string
}

function getProviderHint(model: string): string[] | undefined {
  const parts = model.split("/")
  return parts.length >= 2 ? [parts[0]] : undefined
}

function resolveAvailableModel(model: string, availableModels: Set<string>): string | undefined {
  return fuzzyMatchModel(model, availableModels, getProviderHint(model)) ?? undefined
}

function resolveConnectedModel(
  model: string,
  connectedProviders?: string[] | null,
): string | undefined {
  const connected = connectedProviders ?? connectedProvidersCache.readConnectedProvidersCache()
  if (connected === null) return undefined
  const parts = model.split("/")
  if (parts.length < 2) return undefined
  const provider = parts[0]
  if (!provider) return undefined
  if (!connected.includes(provider)) return undefined
  const modelName = parts.slice(1).join("/")
  return `${provider}/${transformModelForProvider(provider, modelName)}`
}

function resolveConfiguredModel(
  model: string,
  source: ModelSource,
  availableModels: Set<string>,
  connectedProviders: string[] | null | undefined,
  attempted: string[],
  allowFirstRun: boolean,
): ModelResolutionResult | undefined {
  attempted.push(model)

  if (availableModels.size > 0) {
    const match = resolveAvailableModel(model, availableModels)
    if (!match) return undefined
    log("Model resolved via configured candidate (availability confirmed)", {
      model,
      match,
      source,
    })
    return { model: match, source, attempted }
  }

  const connected = connectedProviders ?? connectedProvidersCache.readConnectedProvidersCache()
  if (connected === null) {
    if (!allowFirstRun) return undefined
    log("Model resolved via configured candidate (no cache, first run)", {
      model,
      source,
    })
    return { model, source, attempted }
  }

  const transformed = resolveConnectedModel(model, connected)
  if (!transformed) return undefined
  log("Model resolved via configured candidate (connected provider)", {
    model: transformed,
    original: model,
    source,
  })
  return { model: transformed, source, attempted }
}

function resolveFallbackModel(
  fallbackChain: FallbackEntry[],
  availableModels: Set<string>,
  connectedProviders: string[] | null | undefined,
  attempted: string[],
): ModelResolutionResult | undefined {
  if (availableModels.size === 0) {
    const connected = connectedProviders ?? connectedProvidersCache.readConnectedProvidersCache()
    if (connected === null) return undefined
    for (const entry of fallbackChain) {
      for (const provider of entry.providers) {
        if (!connected.includes(provider)) continue
        const model = `${provider}/${transformModelForProvider(provider, entry.model)}`
        log("Model resolved via fallback chain (connected provider)", {
          provider,
          model: entry.model,
          variant: entry.variant,
        })
        return {
          model,
          source: "provider-fallback",
          variant: entry.variant,
          attempted,
        }
      }
    }
    return undefined
  }

  for (const entry of fallbackChain) {
    for (const provider of entry.providers) {
      const match = fuzzyMatchModel(`${provider}/${entry.model}`, availableModels, [provider])
      if (match) {
        log("Model resolved via fallback chain (availability confirmed)", {
          provider,
          model: entry.model,
          match,
          variant: entry.variant,
        })
        return {
          model: match,
          source: "provider-fallback",
          variant: entry.variant,
          attempted,
        }
      }
    }

    const crossProviderMatch = fuzzyMatchModel(entry.model, availableModels)
    if (!crossProviderMatch) continue
    log("Model resolved via fallback chain (cross-provider fuzzy match)", {
      model: entry.model,
      match: crossProviderMatch,
      variant: entry.variant,
    })
    return {
      model: crossProviderMatch,
      source: "provider-fallback",
      variant: entry.variant,
      attempted,
    }
  }
}

export function resolveModelPipeline(
  request: ModelResolutionRequest,
): ModelResolutionResult | undefined {
  const attempted: string[] = []
  const { intent, constraints, policy } = request
  const availableModels = constraints.availableModels
  const fallbackChain = policy?.fallbackChain
  const systemDefaultModel = policy?.systemDefaultModel

  const normalizedUiModel = normalizeModel(intent?.uiSelectedModel)
  if (normalizedUiModel) {
    log("Model resolved via UI selection", { model: normalizedUiModel })
    return { model: normalizedUiModel, source: "override" }
  }

  const normalizedUserModel = normalizeModel(intent?.userModel)
  if (normalizedUserModel) {
    log("Model resolved via config override", { model: normalizedUserModel })
    return { model: normalizedUserModel, source: "override" }
  }

  const normalizedCategoryDefault = normalizeModel(intent?.categoryDefaultModel)
  if (normalizedCategoryDefault) {
    const resolved = resolveConfiguredModel(
      normalizedCategoryDefault,
      "category-default",
      availableModels,
      constraints.connectedProviders,
      attempted,
      true,
    )
    if (resolved) return resolved
    log("Category default model not available, falling through to fallback chain", { model: normalizedCategoryDefault })
  }

  //#when - user configured fallback_models, try them before hardcoded fallback chain
  const userFallbackModels = intent?.userFallbackModels
  if (userFallbackModels && userFallbackModels.length > 0) {
    for (const model of userFallbackModels) {
      const resolved = resolveConfiguredModel(
        model,
        "provider-fallback",
        availableModels,
        constraints.connectedProviders,
        attempted,
        false,
      )
      if (resolved) return resolved
    }
    log("No available model found in user fallback_models, falling through to hardcoded chain")
  }

  if (fallbackChain && fallbackChain.length > 0) {
    const resolved = resolveFallbackModel(
      fallbackChain,
      availableModels,
      constraints.connectedProviders,
      attempted,
    )
    if (resolved) return resolved
    log("No available model found in fallback chain, falling through to system default")
  }

  if (systemDefaultModel === undefined) {
    log("No model resolved - systemDefaultModel not configured")
    return undefined
  }

  log("Model resolved via system default", { model: systemDefaultModel })
  return { model: systemDefaultModel, source: "system-default", attempted }
}
