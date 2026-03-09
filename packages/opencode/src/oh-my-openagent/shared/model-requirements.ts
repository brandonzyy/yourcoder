export type FallbackEntry = {
  providers: string[];
  model: string;
  variant?: string; // Entry-specific variant (e.g., GPT→high, Opus→max)
};

export type ModelRequirement = {
  fallbackChain: FallbackEntry[];
  variant?: string; // Default variant (used when entry doesn't specify one)
  requiresModel?: string; // If set, only activates when this model is available (fuzzy match)
  requiresAnyModel?: boolean; // If true, requires at least ONE model in fallbackChain to be available (or empty availability treated as unavailable)
  requiresProvider?: string[]; // If set, only activates when any of these providers is connected
};

export const AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["opencode"], model: "kimi-k2.5" },
    ],
  },
  hephaestus: {
    fallbackChain: [
      { providers: ["opencode"], model: "kimi-k2.5" },
      { providers: ["opencode"], model: "glm-5" },
    ],
  },
  oracle: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["opencode"], model: "glm-5" },
    ],
  },
  librarian: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-haiku-4-5" },
      { providers: ["opencode"], model: "glm-4.7-fp8" },
    ],
  },
  explore: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-haiku-4-5" },
      { providers: ["opencode"], model: "glm-4.7-fp8" },
    ],
  },
  "multimodal-looker": {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-sonnet-4-6" },
      { providers: ["opencode"], model: "glm-4.7-fp8" },
    ],
  },
  prometheus: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["opencode"], model: "glm-5" },
    ],
  },
  metis: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["opencode"], model: "kimi-k2.5" },
    ],
  },
  momus: {
    fallbackChain: [
      { providers: ["opencode"], model: "kimi-k2.5" },
      { providers: ["opencode"], model: "claude-sonnet-4-6" },
    ],
  },
  atlas: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-sonnet-4-6" },
      { providers: ["opencode"], model: "glm-4.7-fp8" },
    ],
  },
};

export const CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  "visual-engineering": {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["opencode"], model: "glm-5" },
    ],
  },
  ultrabrain: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["opencode"], model: "kimi-k2.5" },
    ],
  },
  deep: {
    fallbackChain: [
      { providers: ["opencode"], model: "kimi-k2.5" },
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
    ],
  },
  artistry: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["opencode"], model: "glm-5" },
    ],
  },
  quick: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-haiku-4-5" },
      { providers: ["opencode"], model: "glm-4.7-fp8" },
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-sonnet-4-6" },
      { providers: ["opencode"], model: "glm-4.7-fp8" },
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["opencode"], model: "kimi-k2.5" },
    ],
  },
  writing: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-sonnet-4-6" },
      { providers: ["opencode"], model: "glm-4.7-fp8" },
    ],
  },
};
