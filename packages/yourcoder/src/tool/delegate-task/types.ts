import type { PluginInput } from "../../plugin/sdk"
import type { BackgroundManager } from "../../agent/background"
import type { CategoriesConfig, GitMasterConfig, BrowserAutomationProvider, AgentOverrides } from "../../config/plugin-schema"
import type {
  AvailableCategory,
  AvailableSkill,
} from "../../agent/dynamic-agent-prompt-builder"

export type YcClient = PluginInput["client"]

export interface DelegateTaskArgs {
  description: string
  prompt: string
  category?: string
  subagent_type?: string
  run_in_background: boolean
  session_id?: string
  command?: string
  load_skills: string[]
  execute?: {
    task_id: string
    task_dir?: string
  }
}

export interface ToolContextWithMetadata {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void | Promise<void>
  /**
   * Tool call ID injected by OpenCode's internal context (not in plugin ToolContext type,
   * but present at runtime via spread in fromPlugin()). Used for metadata store keying.
   */
  callID?: string
  /** @deprecated OpenCode internal naming may vary across versions */
  callId?: string
  /** @deprecated OpenCode internal naming may vary across versions */
  call_id?: string
}

export interface SyncSessionCreatedEvent {
  sessionID: string
  parentID: string
  title: string
}

export interface DelegateTaskToolOptions {
  manager: BackgroundManager
  client: YcClient
  directory: string
  /**
   * Test hook: bypass global cache reads (Bun runs tests in parallel).
   * If provided, resolveCategoryExecution/resolveSubagentExecution uses this instead of reading from disk cache.
   */
  connectedProvidersOverride?: string[] | null
  /**
   * Test hook: bypass fetchAvailableModels() by providing an explicit available model set.
   */
  availableModelsOverride?: Set<string>
  userCategories?: CategoriesConfig
  gitMasterConfig?: GitMasterConfig
  coderhandModel?: string
  browserProvider?: BrowserAutomationProvider
  disabledSkills?: Set<string>
  availableCategories?: AvailableCategory[]
  availableSkills?: AvailableSkill[]
  agentOverrides?: AgentOverrides
  onSyncSessionCreated?: (event: SyncSessionCreatedEvent) => Promise<void>
  syncPollTimeoutMs?: number
}

export interface BuildSystemContentInput {
  skillContent?: string
  skillContents?: string[]
  categoryPromptAppend?: string
  agentsContext?: string
  planAgentPrepend?: string
  maxPromptTokens?: number
  model?: { providerID: string; modelID: string; variant?: string }
  agentName?: string
  availableCategories?: AvailableCategory[]
  availableSkills?: AvailableSkill[]
}

// Merged from executor-types.ts

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
