import os from "os"
import type { Info } from "./model-schema"
import { Config } from "../config/config"
import { Auth } from "../server/auth"
import { Env } from "../config/env"
import { iife } from "@yourcoder/util/iife"
import { Installation } from "../project/installation"
import type { AmazonBedrockProviderSettings } from "@ai-sdk/amazon-bedrock"
import { fromNodeProviderChain } from "@aws-sdk/credential-providers"
import { GoogleAuth } from "google-auth-library"
import { createGitLab, VERSION as GITLAB_PROVIDER_VERSION } from "@gitlab/gitlab-ai-provider"

export type CustomModelLoader = (sdk: any, modelID: string, options?: Record<string, any>) => Promise<any>
export type CustomLoader = (provider: Info) => Promise<{
  autoload: boolean
  getModel?: CustomModelLoader
  options?: Record<string, any>
}>

function isGpt5OrLater(modelID: string): boolean {
  const match = /^gpt-(\d+)/.exec(modelID)
  if (!match) {
    return false
  }
  return Number(match[1]) >= 5
}

function shouldUseCopilotResponsesApi(modelID: string): boolean {
  return isGpt5OrLater(modelID) && !modelID.startsWith("gpt-5-mini")
}

export const CUSTOM_LOADERS: Record<string, CustomLoader> = {
  async anthropic() {
    return {
      autoload: false,
      options: {
        headers: {
          "anthropic-beta":
            "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
        },
      },
    }
  },
  async opencode(input) {
    const hasKey = await (async () => {
      const env = Env.all()
      if (input.env.some((item) => env[item])) return true
      if (await Auth.get(input.id)) return true
      const config = await Config.get()
      if (config.provider?.["opencode"]?.options?.apiKey) return true
      return false
    })()

    if (!hasKey) {
      for (const [key, value] of Object.entries(input.models)) {
        if (value.cost.input === 0) continue
        delete input.models[key]
      }
    }

    return {
      autoload: Object.keys(input.models).length > 0,
      options: hasKey ? {} : { apiKey: "public" },
    }
  },
  openai: async () => {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
        return sdk.responses(modelID)
      },
      options: {},
    }
  },
  "github-copilot": async () => {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
        if (sdk.responses === undefined && sdk.chat === undefined) return sdk.languageModel(modelID)
        return shouldUseCopilotResponsesApi(modelID) ? sdk.responses(modelID) : sdk.chat(modelID)
      },
      options: {},
    }
  },
  "github-copilot-enterprise": async () => {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, _options?: Record<string, any>) {
        if (sdk.responses === undefined && sdk.chat === undefined) return sdk.languageModel(modelID)
        return shouldUseCopilotResponsesApi(modelID) ? sdk.responses(modelID) : sdk.chat(modelID)
      },
      options: {},
    }
  },
  azure: async () => {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
        if (options?.["useCompletionUrls"]) {
          return sdk.chat(modelID)
        } else {
          return sdk.responses(modelID)
        }
      },
      options: {},
    }
  },
  "azure-cognitive-services": async () => {
    const resourceName = Env.get("AZURE_COGNITIVE_SERVICES_RESOURCE_NAME")
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
        if (options?.["useCompletionUrls"]) {
          return sdk.chat(modelID)
        } else {
          return sdk.responses(modelID)
        }
      },
      options: {
        baseURL: resourceName ? `https://${resourceName}.cognitiveservices.azure.com/openai` : undefined,
      },
    }
  },
  "amazon-bedrock": async () => {
    const config = await Config.get()
    const providerConfig = config.provider?.["amazon-bedrock"]

    const auth = await Auth.get("amazon-bedrock")

    // Region precedence: 1) config file, 2) env var, 3) default
    const configRegion = providerConfig?.options?.region
    const envRegion = Env.get("AWS_REGION")
    const defaultRegion = configRegion ?? envRegion ?? "us-east-1"

    // Profile: config file takes precedence over env var
    const configProfile = providerConfig?.options?.profile
    const envProfile = Env.get("AWS_PROFILE")
    const profile = configProfile ?? envProfile

    const awsAccessKeyId = Env.get("AWS_ACCESS_KEY_ID")

    // TODO: Using process.env directly because Env.set only updates a process.env shallow copy,
    // until the scope of the Env API is clarified (test only or runtime?)
    const awsBearerToken = iife(() => {
      const envToken = process.env.AWS_BEARER_TOKEN_BEDROCK
      if (envToken) return envToken
      if (auth?.type === "api") {
        process.env.AWS_BEARER_TOKEN_BEDROCK = auth.key
        return auth.key
      }
      return undefined
    })

    const awsWebIdentityTokenFile = Env.get("AWS_WEB_IDENTITY_TOKEN_FILE")

    const containerCreds = Boolean(
      process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI || process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI,
    )

    if (!profile && !awsAccessKeyId && !awsBearerToken && !awsWebIdentityTokenFile && !containerCreds)
      return { autoload: false }

    const providerOptions: AmazonBedrockProviderSettings = {
      region: defaultRegion,
    }

    // Only use credential chain if no bearer token exists
    // Bearer token takes precedence over credential chain (profiles, access keys, IAM roles, web identity tokens)
    if (!awsBearerToken) {
      // Build credential provider options (only pass profile if specified)
      const credentialProviderOptions = profile ? { profile } : {}

      providerOptions.credentialProvider = fromNodeProviderChain(credentialProviderOptions)
    }

    // Add custom endpoint if specified (endpoint takes precedence over baseURL)
    const endpoint = providerConfig?.options?.endpoint ?? providerConfig?.options?.baseURL
    if (endpoint) {
      providerOptions.baseURL = endpoint
    }

    return {
      autoload: true,
      options: providerOptions,
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
        // Skip region prefixing if model already has a cross-region inference profile prefix
        // Models from models.dev may already include prefixes like us., eu., global., etc.
        const crossRegionPrefixes = ["global.", "us.", "eu.", "jp.", "apac.", "au."]
        if (crossRegionPrefixes.some((prefix) => modelID.startsWith(prefix))) {
          return sdk.languageModel(modelID)
        }

        // Region resolution precedence (highest to lowest):
        // 1. options.region from yourcoder.json provider config
        // 2. defaultRegion from AWS_REGION environment variable
        // 3. Default "us-east-1" (baked into defaultRegion)
        const region = options?.region ?? defaultRegion

        let regionPrefix = region.split("-")[0]

        switch (regionPrefix) {
          case "us": {
            const modelRequiresPrefix = [
              "nova-micro",
              "nova-lite",
              "nova-pro",
              "nova-premier",
              "nova-2",
              "claude",
              "deepseek",
            ].some((m) => modelID.includes(m))
            const isGovCloud = region.startsWith("us-gov")
            if (modelRequiresPrefix && !isGovCloud) {
              modelID = `${regionPrefix}.${modelID}`
            }
            break
          }
          case "eu": {
            const regionRequiresPrefix = [
              "eu-west-1",
              "eu-west-2",
              "eu-west-3",
              "eu-north-1",
              "eu-central-1",
              "eu-south-1",
              "eu-south-2",
            ].some((r) => region.includes(r))
            const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "llama3", "pixtral"].some((m) =>
              modelID.includes(m),
            )
            if (regionRequiresPrefix && modelRequiresPrefix) {
              modelID = `${regionPrefix}.${modelID}`
            }
            break
          }
          case "ap": {
            const isAustraliaRegion = ["ap-southeast-2", "ap-southeast-4"].includes(region)
            const isTokyoRegion = region === "ap-northeast-1"
            if (
              isAustraliaRegion &&
              ["anthropic.claude-sonnet-4-5", "anthropic.claude-haiku"].some((m) => modelID.includes(m))
            ) {
              regionPrefix = "au"
              modelID = `${regionPrefix}.${modelID}`
            } else if (isTokyoRegion) {
              // Tokyo region uses jp. prefix for cross-region inference
              const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) =>
                modelID.includes(m),
              )
              if (modelRequiresPrefix) {
                regionPrefix = "jp"
                modelID = `${regionPrefix}.${modelID}`
              }
            } else {
              // Other APAC regions use apac. prefix
              const modelRequiresPrefix = ["claude", "nova-lite", "nova-micro", "nova-pro"].some((m) =>
                modelID.includes(m),
              )
              if (modelRequiresPrefix) {
                regionPrefix = "apac"
                modelID = `${regionPrefix}.${modelID}`
              }
            }
            break
          }
        }

        return sdk.languageModel(modelID)
      },
    }
  },
  openrouter: async () => {
    return {
      autoload: false,
      options: {
        headers: {
          "HTTP-Referer": "https://opencode.ai/",
          "X-Title": "opencode",
        },
      },
    }
  },
  vercel: async () => {
    return {
      autoload: false,
      options: {
        headers: {
          "http-referer": "https://opencode.ai/",
          "x-title": "opencode",
        },
      },
    }
  },
  "google-vertex": async (provider) => {
    const project =
      provider.options?.project ??
      Env.get("GOOGLE_CLOUD_PROJECT") ??
      Env.get("GCP_PROJECT") ??
      Env.get("GCLOUD_PROJECT")

    const location =
      provider.options?.location ?? Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "us-central1"

    const autoload = Boolean(project)
    if (!autoload) return { autoload: false }
    return {
      autoload: true,
      options: {
        project,
        location,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const auth = new GoogleAuth()
          const client = await auth.getApplicationDefault()
          const token = await client.credential.getAccessToken()

          const headers = new Headers(init?.headers)
          headers.set("Authorization", `Bearer ${token.token}`)

          return fetch(input, { ...init, headers })
        },
      },
      async getModel(sdk: any, modelID: string) {
        const id = String(modelID).trim()
        return sdk.languageModel(id)
      },
    }
  },
  "google-vertex-anthropic": async () => {
    const project = Env.get("GOOGLE_CLOUD_PROJECT") ?? Env.get("GCP_PROJECT") ?? Env.get("GCLOUD_PROJECT")
    const location = Env.get("GOOGLE_CLOUD_LOCATION") ?? Env.get("VERTEX_LOCATION") ?? "global"
    const autoload = Boolean(project)
    if (!autoload) return { autoload: false }
    return {
      autoload: true,
      options: {
        project,
        location,
      },
      async getModel(sdk: any, modelID) {
        const id = String(modelID).trim()
        return sdk.languageModel(id)
      },
    }
  },
  "sap-ai-core": async () => {
    const auth = await Auth.get("sap-ai-core")
    // TODO: Using process.env directly because Env.set only updates a shallow copy (not process.env),
    // until the scope of the Env API is clarified (test only or runtime?)
    const envServiceKey = iife(() => {
      const envAICoreServiceKey = process.env.AICORE_SERVICE_KEY
      if (envAICoreServiceKey) return envAICoreServiceKey
      if (auth?.type === "api") {
        process.env.AICORE_SERVICE_KEY = auth.key
        return auth.key
      }
      return undefined
    })
    const deploymentId = process.env.AICORE_DEPLOYMENT_ID
    const resourceGroup = process.env.AICORE_RESOURCE_GROUP

    return {
      autoload: !!envServiceKey,
      options: envServiceKey ? { deploymentId, resourceGroup } : {},
      async getModel(sdk: any, modelID: string) {
        return sdk(modelID)
      },
    }
  },
  zenmux: async () => {
    return {
      autoload: false,
      options: {
        headers: {
          "HTTP-Referer": "https://opencode.ai/",
          "X-Title": "opencode",
        },
      },
    }
  },
  gitlab: async (input) => {
    const instanceUrl = Env.get("GITLAB_INSTANCE_URL") || "https://gitlab.com"

    const auth = await Auth.get(input.id)
    const apiKey = await (async () => {
      if (auth?.type === "oauth") return auth.access
      if (auth?.type === "api") return auth.key
      return Env.get("GITLAB_TOKEN")
    })()

    const config = await Config.get()
    const providerConfig = config.provider?.["gitlab"]

    const aiGatewayHeaders = {
      "User-Agent": `opencode/${Installation.VERSION} gitlab-ai-provider/${GITLAB_PROVIDER_VERSION} (${os.platform()} ${os.release()}; ${os.arch()})`,
      ...(providerConfig?.options?.aiGatewayHeaders || {}),
    }

    return {
      autoload: !!apiKey,
      options: {
        instanceUrl,
        apiKey,
        aiGatewayHeaders,
        featureFlags: {
          duo_agent_platform_agentic_chat: true,
          duo_agent_platform: true,
          ...(providerConfig?.options?.featureFlags || {}),
        },
      },
      async getModel(sdk: ReturnType<typeof createGitLab>, modelID: string) {
        return sdk.agenticChat(modelID, {
          aiGatewayHeaders,
          featureFlags: {
            duo_agent_platform_agentic_chat: true,
            duo_agent_platform: true,
            ...(providerConfig?.options?.featureFlags || {}),
          },
        })
      },
    }
  },
  "cloudflare-workers-ai": async (input) => {
    const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
    if (!accountId) return { autoload: false }

    const apiKey = await iife(async () => {
      const envToken = Env.get("CLOUDFLARE_API_KEY")
      if (envToken) return envToken
      const auth = await Auth.get(input.id)
      if (auth?.type === "api") return auth.key
      return undefined
    })

    return {
      autoload: !!apiKey,
      options: {
        apiKey,
        baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
      },
      async getModel(sdk: any, modelID: string) {
        return sdk.languageModel(modelID)
      },
    }
  },
  "cloudflare-ai-gateway": async (input) => {
    const accountId = Env.get("CLOUDFLARE_ACCOUNT_ID")
    const gateway = Env.get("CLOUDFLARE_GATEWAY_ID")

    if (!accountId || !gateway) return { autoload: false }

    // Get API token from env or auth - required for authenticated gateways
    const apiToken = await (async () => {
      const envToken = Env.get("CLOUDFLARE_API_TOKEN") || Env.get("CF_AIG_TOKEN")
      if (envToken) return envToken
      const auth = await Auth.get(input.id)
      if (auth?.type === "api") return auth.key
      return undefined
    })()

    if (!apiToken) {
      throw new Error(
        "CLOUDFLARE_API_TOKEN (or CF_AIG_TOKEN) is required for Cloudflare AI Gateway. " +
          "Set it via environment variable or run `opencode auth cloudflare-ai-gateway`.",
      )
    }

    // Use official ai-gateway-provider package (v2.x for AI SDK v5 compatibility)
    const { createAiGateway } = await import("ai-gateway-provider")
    const { createUnified } = await import("ai-gateway-provider/providers/unified")

    const metadata = iife(() => {
      if (input.options?.metadata) return input.options.metadata
      try {
        return JSON.parse(input.options?.headers?.["cf-aig-metadata"])
      } catch {
        return undefined
      }
    })
    const opts = {
      metadata,
      cacheTtl: input.options?.cacheTtl,
      cacheKey: input.options?.cacheKey,
      skipCache: input.options?.skipCache,
      collectLog: input.options?.collectLog,
    }

    const aigateway = createAiGateway({
      accountId,
      gateway,
      apiKey: apiToken,
      ...(Object.values(opts).some((v) => v !== undefined) ? { options: opts } : {}),
    })
    const unified = createUnified()

    return {
      autoload: true,
      async getModel(_sdk: any, modelID: string, _options?: Record<string, any>) {
        // Model IDs use Unified API format: provider/model (e.g., "anthropic/claude-sonnet-4-5")
        return aigateway(unified(modelID))
      },
      options: {},
    }
  },
  cerebras: async () => {
    return {
      autoload: false,
      options: {
        headers: {
          "X-Cerebras-3rd-Party-Integration": "opencode",
        },
      },
    }
  },
  kilo: async () => {
    return {
      autoload: false,
      options: {
        headers: {
          "HTTP-Referer": "https://opencode.ai/",
          "X-Title": "opencode",
        },
      },
    }
  },
}
