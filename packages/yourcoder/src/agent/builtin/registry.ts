import type { AgentConfig } from "@yourcoder/sdk"
import type { ToolDefinition } from "../../plugin/sdk"
import { BackgroundManager } from "../../agent/background"
import { listBuiltinAgents } from "./catalog"
import { loadBuiltinRuntime } from "./runtime"

/**
 * Native builtin agent registry
 * Loads yac, codersearch directly into yourcoder core
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

    // Load yc agent
    const yac = await this.loadYc(config)
    if (yac) {
      agents.yac = yac
      this.agents.set("yc", yac)
    }

    // Load codersearch agent
    const codersearch = await this.loadCodersearch(model)
    if (codersearch) {
      agents.codersearch = codersearch
      this.agents.set("codersearch", codersearch)
    }

    // Load coderhand agent
    const coderhand = await this.loadCoderhand(model)
    if (coderhand) {
      agents["coderhand"] = coderhand
      this.agents.set("coderhand", coderhand)
    }

    // Initialize BackgroundManager and load delegate-task tool
    if (client && directory) {
      const runtime = loadBuiltinRuntime({ client, directory } as any)
      this.backgroundManager = runtime.manager
      for (const [name, item] of Object.entries(runtime.tools)) {
        tools[name] = item
        this.tools.set(name, item)
      }
    }

    return { agents, tools }
  }

  /**
   * Load yc agent with config
   */
  private static async loadYc(config: { model?: string }): Promise<AgentConfig | null> {
    try {
      const { createYcAgent } = await import("./yc")

      const model = config.model ?? "claude-opus-4-6"

      return createYcAgent(
        model,
        listBuiltinAgents(),
        undefined,
        [],
        [],
        false
      )
    } catch (error) {
      console.error("Failed to load yc agent:", error)
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
   * Load codersearch agent
   */
  private static async loadCodersearch(model: string): Promise<AgentConfig | null> {
    try {
      const { createCodersearchAgent } = await import("./codersearch")
      return createCodersearchAgent(model)
    } catch (error) {
      console.error("Failed to load codersearch agent:", error)
      return null
    }
  }

  /**
   * Load coderhand agent
   */
  private static async loadCoderhand(model: string): Promise<AgentConfig | null> {
    try {
      const { createCoderhandAgent } = await import("./coderhand")
      return createCoderhandAgent(model, false) // useTaskSystem = false
    } catch (error) {
      console.error("Failed to load coderhand agent:", error)
      return null
    }
  }
}
