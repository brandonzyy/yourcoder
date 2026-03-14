/**
 * Native builtin agents
 *
 * This module exports sisyphus and other builtin agents
 * that are integrated directly into opencode core.
 */

export { createSisyphusAgent, SISYPHUS_PROMPT_METADATA } from "./sisyphus"
export { createLibrarianAgent, LIBRARIAN_PROMPT_METADATA } from "./librarian"
export { createManonExplorerAgent, MANON_EXPLORER_PROMPT_METADATA } from "./manon-explorer"
export { createSisyphusJuniorAgent } from "./sisyphus-junior"
export { BuiltinAgentRegistry } from "./registry"

// Re-export types for convenience
export type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "./sisyphus/prompt-builder"

export type {
  AgentMode,
  AgentPromptMetadata,
} from "./sisyphus/types"
