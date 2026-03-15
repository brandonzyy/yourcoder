import type { AgentConfig } from "@opencode-ai/sdk"
import type { ToolDefinition } from "../../plugin/sdk"
import { BackgroundManager } from "../../features/background-agent"

/**
 * Native builtin agent registry
 * Loads sisyphus, librarian, manon-explorer directly into opencode core
 */
export class BuiltinAgentRegistry {
  private static agents: Map<string, AgentConfig> = new Map()
  private static tools: Map<string, ToolDefinition> = new Map()
  private static backgroundManager?: BackgroundManager

  /**
   * Load all builtin agents based on config
   */
  static async load(config: { model?: string }, client?: any, directory?: string): Promise<{
    agents: Record<string, AgentConfig>
    tools: Record<string, ToolDefinition>
  }> {
    const agents: Record<string, AgentConfig> = {}
    const tools: Record<string, ToolDefinition> = {}

    // Get model from config
    const model = config.model ?? "claude-opus-4-6"

    // Load sisyphus agent
    const sisyphus = await this.loadSisyphus(config)
    if (sisyphus) {
      agents.sisyphus = sisyphus
      this.agents.set("sisyphus", sisyphus)
    }

    // Load librarian agent
    const librarian = await this.loadLibrarian(model)
    if (librarian) {
      agents.librarian = librarian
      this.agents.set("librarian", librarian)
    }

    // Load manon-explorer agent
    const manonExplorer = await this.loadManonExplorer(model)
    if (manonExplorer) {
      agents["manon-explorer"] = manonExplorer
      this.agents.set("manon-explorer", manonExplorer)
    }

    // Load sisyphus-junior agent
    const sisyphusJunior = await this.loadSisyphusJunior(model)
    if (sisyphusJunior) {
      agents["sisyphus-junior"] = sisyphusJunior
      this.agents.set("sisyphus-junior", sisyphusJunior)
    }

    // Initialize BackgroundManager and load delegate-task tool
    if (client && directory) {
      // Create BackgroundManager instance
      this.backgroundManager = new BackgroundManager(
        { client, directory } as any,
        { defaultConcurrency: 5 },
      )

      const delegateTask = await this.loadDelegateTask(client, this.backgroundManager)
      if (delegateTask) {
        tools.task = delegateTask
        this.tools.set("task", delegateTask)
      }
    }

    return { agents, tools }
  }

  /**
   * Load sisyphus agent with config
   */
  private static async loadSisyphus(config: { model?: string }): Promise<AgentConfig | null> {
    try {
      const { createSisyphusAgent } = await import("./sisyphus")

      const model = config.model ?? "claude-opus-4-6"

      // Build available agents from already-loaded subagents with proper metadata
      const { LIBRARIAN_PROMPT_METADATA } = await import("./librarian")
      const { MANON_EXPLORER_PROMPT_METADATA } = await import("./manon-explorer")

      const availableAgents = [
        { name: "librarian", description: "Open-source documentation and codebase search specialist", metadata: LIBRARIAN_PROMPT_METADATA },
        { name: "manon-explorer", description: "Semantic code search via Manon knowledge graph", metadata: MANON_EXPLORER_PROMPT_METADATA },
        { name: "sisyphus-junior", description: "Focused task executor without delegation", metadata: { category: "specialist" as const, cost: "CHEAP" as const, triggers: [{ domain: "Parallel execution", trigger: "Focused subtasks that don't need delegation" }] } },
      ]

      return createSisyphusAgent(
        model,
        availableAgents,
        undefined,
        [],
        [],
        false
      )
    } catch (error) {
      console.error("Failed to load sisyphus agent:", error)
      return null
    }
  }

  /**
   * Get a specific agent by name
   */
  static get(name: string): AgentConfig | undefined {
    return this.agents.get(name)
  }

  /**
   * Check if an agent is registered
   */
  static has(name: string): boolean {
    return this.agents.has(name)
  }

  /**
   * Get all registered agent names
   */
  static names(): string[] {
    return Array.from(this.agents.keys())
  }

  /**
   * Load delegate-task tool with BackgroundManager
   */
  private static async loadDelegateTask(
    client: any,
    backgroundManager: BackgroundManager
  ): Promise<ToolDefinition | null> {
    try {
      const { createDelegateTask } = await import("../../features/background-agent/delegate-task-factory")
      return createDelegateTask(client, backgroundManager)
    } catch (error) {
      console.error("Failed to load delegate-task tool:", error)
      return null
    }
  }

  /**
   * Get BackgroundManager instance
   */
  static getBackgroundManager(): BackgroundManager | undefined {
    return this.backgroundManager
  }

  /**
   * Get a specific tool by name
   */
  static getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  /**
   * Get all registered tools
   */
  static getTools(): Record<string, ToolDefinition> {
    return Object.fromEntries(this.tools)
  }

  /**
   * Load librarian agent
   */
  private static async loadLibrarian(model: string): Promise<AgentConfig | null> {
    try {
      const { createLibrarianAgent } = await import("./librarian")
      return createLibrarianAgent(model)
    } catch (error) {
      console.error("Failed to load librarian agent:", error)
      return null
    }
  }

  /**
   * Load manon-explorer agent
   */
  private static async loadManonExplorer(model: string): Promise<AgentConfig | null> {
    try {
      const { createManonExplorerAgent } = await import("./manon-explorer")
      return createManonExplorerAgent(model)
    } catch (error) {
      console.error("Failed to load manon-explorer agent:", error)
      return null
    }
  }

  /**
   * Load sisyphus-junior agent
   */
  private static async loadSisyphusJunior(model: string): Promise<AgentConfig | null> {
    try {
      const { createSisyphusJuniorAgent } = await import("./sisyphus-junior")
      return createSisyphusJuniorAgent(model, false) // useTaskSystem = false
    } catch (error) {
      console.error("Failed to load sisyphus-junior agent:", error)
      return null
    }
  }
}
