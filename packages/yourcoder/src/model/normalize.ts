// Merged from: model-normalization.ts, model-format-normalizer.ts, model-sanitizer.ts, normalize-sdk-response.ts

export function normalizeModel(model?: string): string | undefined {
	const trimmed = model?.trim()
	return trimmed || undefined
}

export function normalizeModelID(modelID: string): string {
	return modelID.replace(/\.(\d+)/g, "-$1")
}

export function normalizeModelFormat(
  model: string | { providerID: string; modelID: string }
): { providerID: string; modelID: string } | undefined {
  if (!model) {
    return undefined
  }

  if (typeof model === "object" && "providerID" in model && "modelID" in model) {
    return { providerID: model.providerID, modelID: model.modelID }
  }

  if (typeof model === "string") {
    const parts = model.split("/")
    if (parts.length >= 2) {
      return { providerID: parts[0], modelID: parts.slice(1).join("/") }
    }
  }

  return undefined
}

type CommandSource = "claude-code" | "opencode"

export function sanitizeModelField(model: unknown, source: CommandSource = "claude-code"): string | undefined {
  if (source === "claude-code") {
    return undefined
  }

  if (typeof model === "string" && model.trim().length > 0) {
    return model.trim()
  }
  return undefined
}

export interface NormalizeSDKResponseOptions {
  preferResponseOnMissingData?: boolean
}

export function normalizeSDKResponse<TData>(
  response: unknown,
  fallback: TData,
  options?: NormalizeSDKResponseOptions,
): TData {
  if (response === null || response === undefined) {
    return fallback
  }

  if (Array.isArray(response)) {
    return response as TData
  }

  if (typeof response === "object" && "data" in response) {
    const data = (response as { data?: unknown }).data
    if (data !== null && data !== undefined) {
      return data as TData
    }

    if (options?.preferResponseOnMissingData === true) {
      return response as TData
    }

    return fallback
  }

  if (options?.preferResponseOnMissingData === true) {
    return response as TData
  }

  return fallback
}
