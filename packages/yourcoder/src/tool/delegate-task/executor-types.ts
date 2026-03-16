import type { BackgroundManager } from "../../agent/background"
import type { CategoriesConfig, GitMasterConfig, BrowserAutomationProvider, AgentOverrides } from "../../config/plugin-schema"
import type { YcClient } from "./types"

export interface ExecutorContext {
  manager: BackgroundManager
  client: YcClient
  directory: string
  userCategories?: CategoriesConfig
  gitMasterConfig?: GitMasterConfig
  coderhandModel?: string
  browserProvider?: BrowserAutomationProvider
  agentOverrides?: AgentOverrides
  onSyncSessionCreated?: (event: { sessionID: string; parentID: string; title: string }) => Promise<void>
  syncPollTimeoutMs?: number
}

export interface ParentContext {
  sessionID: string
  messageID: string
  agent?: string
  model?: { providerID: string; modelID: string; variant?: string }
}

export interface SessionMessage {
  info?: {
    id?: string
    role?: string
    time?: { created?: number }
    finish?: string
    agent?: string
    model?: { providerID: string; modelID: string; variant?: string }
    modelID?: string
    providerID?: string
    variant?: string
  }
  parts?: Array<{ type?: string; text?: string }>
}
