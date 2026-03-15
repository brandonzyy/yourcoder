import type { PluginInput } from "../../../plugin/sdk"
import type { RuntimeFallbackConfig, PluginConfig } from "../../../config/plugin-config-types"

export interface FallbackState {
  originalModel: string
  currentModel: string
  fallbackIndex: number
  failedModels: Map<string, number>
  attemptCount: number
  pendingFallbackModel?: string
}

export interface FallbackResult {
  success: boolean
  newModel?: string
  error?: string
  maxAttemptsReached?: boolean
}

export interface RuntimeFallbackOptions {
  config?: RuntimeFallbackConfig
  pluginConfig?: PluginConfig
  session_timeout_ms?: number
}

export interface RuntimeFallbackHook {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  "chat.message"?: (input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } }, output: { message: { model?: { providerID: string; modelID: string } }; parts?: Array<{ type: string; text?: string }> }) => Promise<void>
}

export interface HookDeps {
  ctx: PluginInput
  config: Required<RuntimeFallbackConfig>
  options: RuntimeFallbackOptions | undefined
  pluginConfig: PluginConfig | undefined
  sessionStates: Map<string, FallbackState>
  sessionLastAccess: Map<string, number>
  sessionRetryInFlight: Set<string>
  sessionAwaitingFallbackResult: Set<string>
  sessionFallbackTimeouts: Map<string, ReturnType<typeof setTimeout>>
}
