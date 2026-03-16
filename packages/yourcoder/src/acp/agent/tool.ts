import { RequestError, type ToolKind } from "@agentclientprotocol/sdk"
import { pathToFileURL } from "bun"
import { LoadAPIKeyError } from "ai"
import { applyPatch } from "diff"
import { Provider } from "../../provider/provider"
import { MessageV2 } from "../../session/message-v2"
import type { ACPConfig } from "../types"
import { log } from "./shared"

export function toToolKind(name: string): ToolKind {
  const tool = name.toLocaleLowerCase()
  switch (tool) {
    case "bash":
      return "execute"
    case "webfetch":
      return "fetch"
    case "edit":
    case "patch":
    case "write":
      return "edit"
    case "grep":
    case "glob":
    case "context7_resolve_library_id":
    case "context7_get_library_docs":
      return "search"
    case "list":
    case "read":
      return "read"
    default:
      return "other"
  }
}

export function toLocations(name: string, input: Record<string, any>) {
  const tool = name.toLocaleLowerCase()
  switch (tool) {
    case "read":
    case "edit":
    case "write":
      return input["filePath"] ? [{ path: input["filePath"] }] : []
    case "glob":
    case "grep":
    case "list":
      return input["path"] ? [{ path: input["path"] }] : []
    case "bash":
      return []
    default:
      return []
  }
}

export function parseUri(
  uri: string,
): { type: "file"; url: string; filename: string; mime: string } | { type: "text"; text: string } {
  try {
    if (uri.startsWith("file://")) {
      const path = uri.slice(7)
      const name = path.split("/").pop() || path
      return {
        type: "file",
        url: uri,
        filename: name,
        mime: "text/plain",
      }
    }

    if (uri.startsWith("zed://")) {
      const url = new URL(uri)
      const path = url.searchParams.get("path")
      if (path) {
        const name = path.split("/").pop() || path
        return {
          type: "file",
          url: pathToFileURL(path).href,
          filename: name,
          mime: "text/plain",
        }
      }
    }

    return {
      type: "text",
      text: uri,
    }
  } catch {
    return {
      type: "text",
      text: uri,
    }
  }
}

export function getNewContent(old: string, diff: string) {
  const next = applyPatch(old, diff)
  if (next !== false) return next
  log.error("Failed to apply unified diff (context mismatch)")
  return undefined
}

export async function guard<T>(config: ACPConfig, fn: () => Promise<T>) {
  try {
    return await fn()
  } catch (err) {
    const error = MessageV2.fromError(err, {
      providerID: config.defaultModel?.providerID ?? "unknown",
    })
    if (LoadAPIKeyError.isInstance(error)) {
      throw RequestError.authRequired()
    }
    throw err
  }
}

export function sort<T extends { name: string }>(providers: T[]) {
  return [...providers].sort((a, b) => {
    const left = a.name.toLowerCase()
    const right = b.name.toLowerCase()
    if (left < right) return -1
    if (left > right) return 1
    return 0
  })
}

export function variants(
  providers: Array<{ id: string; models: Record<string, { variants?: Record<string, any> }> }>,
  model: { providerID: string; modelID: string },
) {
  const provider = providers.find((entry) => entry.id === model.providerID)
  if (!provider) return []
  const info = provider.models[model.modelID]
  if (!info?.variants) return []
  return Object.keys(info.variants)
}

export function models(
  providers: Array<{ id: string; name: string; models: Record<string, any> }>,
  input: { includeVariants?: boolean } = {},
) {
  const include = input.includeVariants ?? false
  return providers.flatMap((provider) => {
    const items = Provider.sort(Object.values(provider.models) as any)
    return items.flatMap((model) => {
      const base = {
        modelId: `${provider.id}/${model.id}`,
        name: `${provider.name}/${model.name}`,
      }
      if (!include || !model.variants) return [base]
      const variants = Object.keys(model.variants).filter((variant) => variant !== "default")
      return [
        base,
        ...variants.map((variant) => ({
          modelId: `${provider.id}/${model.id}/${variant}`,
          name: `${provider.name}/${model.name} (${variant})`,
        })),
      ]
    })
  })
}

export function format(
  model: { providerID: string; modelID: string },
  variant: string | undefined,
  available: string[],
  include: boolean,
) {
  const base = `${model.providerID}/${model.modelID}`
  if (!include || !variant || !available.includes(variant)) return base
  return `${base}/${variant}`
}

export function meta(input: { model: { providerID: string; modelID: string }; variant?: string; available: string[] }) {
  return {
    opencode: {
      modelId: `${input.model.providerID}/${input.model.modelID}`,
      variant: input.variant ?? null,
      availableVariants: input.available,
    },
  }
}

export function select(
  modelId: string,
  providers: Array<{ id: string; models: Record<string, { variants?: Record<string, any> }> }>,
) {
  const parsed = Provider.parseModel(modelId)
  const provider = providers.find((p) => p.id === parsed.providerID)
  if (!provider) {
    return { model: parsed, variant: undefined }
  }

  if (provider.models[parsed.modelID]) {
    return { model: parsed, variant: undefined }
  }

  const parts = parsed.modelID.split("/")
  if (parts.length < 2) {
    return { model: parsed, variant: undefined }
  }

  const variant = parts[parts.length - 1]
  const base = parts.slice(0, -1).join("/")
  const info = provider.models[base]
  if (!info?.variants || !(variant in info.variants)) {
    return { model: parsed, variant: undefined }
  }

  return {
    model: { providerID: parsed.providerID, modelID: base },
    variant,
  }
}

export async function model(config: ACPConfig, cwd?: string) {
  const sdk = config.sdk
  const preset = config.defaultModel
  if (preset) return preset

  const directory = cwd ?? process.cwd()
  const specified = await sdk.config
    .get({ directory }, { throwOnError: true })
    .then((resp) => {
      const cfg = resp.data
      if (!cfg?.model) return undefined
      const parsed = Provider.parseModel(cfg.model)
      return {
        providerID: parsed.providerID,
        modelID: parsed.modelID,
      }
    })
    .catch((err) => {
      log.error("failed to load user config for default model", { error: err })
      return undefined
    })

  const providers = await sdk.config
    .providers({ directory }, { throwOnError: true })
    .then((x) => x.data?.providers ?? [])
    .catch((err) => {
      log.error("failed to list providers for default model", { error: err })
      return []
    })

  if (specified && providers.length) {
    const provider = providers.find((p) => p.id === specified.providerID)
    if (provider && provider.models[specified.modelID]) return specified
  }

  if (specified && !providers.length) return specified

  const opencode = providers.find((p) => p.id === "opencode")
  if (opencode) {
    if (opencode.models["big-pickle"]) {
      return { providerID: "opencode", modelID: "big-pickle" }
    }
    const [best] = Provider.sort(Object.values(opencode.models))
    if (best) {
      return {
        providerID: best.providerID,
        modelID: best.id,
      }
    }
  }

  const items = providers.flatMap((p) => Object.values(p.models))
  const [best] = Provider.sort(items)
  if (best) {
    return {
      providerID: best.providerID,
      modelID: best.id,
    }
  }

  if (specified) return specified
  return { providerID: "opencode", modelID: "big-pickle" }
}
