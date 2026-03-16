/**
 * Native builtin agents
 *
 * This module exports yac and other builtin agents
 * that are integrated directly into yourcoder core.
 */

export { createYcAgent, YC_PROMPT_METADATA } from "./yc"
export { createCodersearchAgent, CODERSEARCH_PROMPT_METADATA } from "./codersearch"
export { createCodereyeAgent, CODEREYE_PROMPT_METADATA } from "./codereye"
export { createCoderhandAgent } from "./coderhand"
export { BuiltinAgentRegistry } from "./registry"

// Re-export types for convenience
export type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "./yc/prompt-builder"

export type {
  AgentMode,
  AgentPromptMetadata,
} from "../plugin-agent-types"
