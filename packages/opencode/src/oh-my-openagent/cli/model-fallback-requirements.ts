import type { ModelRequirement } from "../shared/model-requirements";

// NOTE: These requirements are used by the CLI config generator (`generateModelConfig`).
// They intentionally use "install-time" provider IDs (anthropic/openai/google/opencode/etc),
// not runtime-only providers like `nvidia`.

export const CLI_AGENT_MODEL_REQUIREMENTS: Record<string, ModelRequirement> = {
  sisyphus: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["opencode"], model: "kimi-k2.5" },
    ],
  },
  librarian: {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-haiku-4-5" },
      { providers: ["opencode"], model: "glm-4.7-fp8" },
    ],
  },
  "manon-explorer": {
    fallbackChain: [
      { providers: ["opencode"], model: "claude-haiku-4-5" },
      { providers: ["opencode"], model: "glm-4.7-fp8" },
    ],
  },
};

export const CLI_CATEGORY_MODEL_REQUIREMENTS: Record<string, ModelRequirement> =
  {
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
