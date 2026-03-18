import type { AgentConfig } from "@yourcoder/sdk";

/**
 * Agent mode determines UI model selection behavior:
 * - "primary": Respects user's UI-selected model (yac)
 * - "subagent": Uses own fallback chain, ignores UI selection (codersearch, etc.)
 * - "all": Available in both contexts (OpenCode compatibility)
 */
export type AgentMode = "primary" | "subagent" | "all";

/**
 * Agent factory function with static mode property.
 * Mode is exposed as static property for pre-instantiation access.
 */
export type AgentFactory = ((model: string) => AgentConfig) & {
  mode: AgentMode;
};

/**
 * Agent category for grouping in Yc prompt sections
 */
export type AgentCategory =
  | "exploration"
  | "specialist"
  | "advisor"
  | "utility";

/**
 * Cost classification for Tool Selection table
 */
export type AgentCost = "FREE" | "CHEAP" | "EXPENSIVE";

/**
 * Delegation trigger for Yc prompt's Delegation Table
 */
export interface DelegationTrigger {
  /** Domain of work (e.g., "Frontend UI/UX") */
  domain: string;
  /** When to delegate (e.g., "Visual changes only...") */
  trigger: string;
}

/**
 * Metadata for generating Yc prompt sections dynamically
 * This allows adding/removing agents without manually updating the Yc prompt
 */
export interface AgentPromptMetadata {
  /** Category for grouping in prompt sections */
  category: AgentCategory;

  /** Cost classification for Tool Selection table */
  cost: AgentCost;

  /** Domain triggers for Delegation Table */
  triggers: DelegationTrigger[];
}

function extractModelName(model: string): string {
  return model.includes("/") ? (model.split("/").pop() ?? model) : model;
}

export function isGptModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt");
}

export function isGpt5_4Model(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt-5.4") || modelName.includes("gpt-5-4");
}

export function isGpt5_3CodexModel(model: string): boolean {
  const modelName = extractModelName(model).toLowerCase();
  return modelName.includes("gpt-5.3-codex") || modelName.includes("gpt-5-3-codex");
}

const GEMINI_PROVIDERS = ["google/", "google-vertex/"];

export function isGeminiModel(model: string): boolean {
  if (GEMINI_PROVIDERS.some((prefix) => model.startsWith(prefix))) return true;

  if (
    model.startsWith("github-copilot/") &&
    extractModelName(model).toLowerCase().startsWith("gemini")
  )
    return true;

  const modelName = extractModelName(model).toLowerCase();
  return modelName.startsWith("gemini-");
}

export type BuiltinAgentName =
  | "yc"
  | "codersearch";

export type OverridableAgentName = "build" | "coderhand" | BuiltinAgentName;

export type AgentName = BuiltinAgentName;

export type AgentOverrideConfig = Partial<AgentConfig> & {
  prompt_append?: string;
  variant?: string;
  fallback_models?: string | string[];
};

export type AgentOverrides = Partial<
  Record<OverridableAgentName, AgentOverrideConfig>
>;
