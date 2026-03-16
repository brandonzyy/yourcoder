/**
 * Ultrawork message module - routes to appropriate message based on agent/model.
 *
 * Routing:
 * 1. Planner agents (prometheus, plan) → planner.ts
 * 2. GPT models → gpt.ts
 * 3. Gemini models → gemini.ts
 * 4. Default (Claude, etc.) → default.ts (optimized for Claude series)
 */

import { isGptModel, isGeminiModel } from "../../../agent/plugin-agent-types"

export {
  ULTRAWORK_PLANNER_SECTION,
  getPlannerUltraworkMessage,
} from "./planner";
export { ULTRAWORK_GPT_MESSAGE, getGptUltraworkMessage } from "./gpt";
export { ULTRAWORK_GEMINI_MESSAGE, getGeminiUltraworkMessage } from "./gemini";
export {
  ULTRAWORK_DEFAULT_MESSAGE,
  getDefaultUltraworkMessage,
} from "./default";

import { getPlannerUltraworkMessage } from "./planner";
import { getGptUltraworkMessage } from "./gpt";
import { getDefaultUltraworkMessage } from "./default";
import { getGeminiUltraworkMessage } from "./gemini";

// --- Source detection (inlined from source-detector.ts) ---

export { isGptModel, isGeminiModel }

/**
 * Checks if agent is a planner-type agent.
 * Planners don't need ultrawork injection (they ARE the planner).
 */
export function isPlannerAgent(agentName?: string): boolean {
  if (!agentName) return false
  const lowerName = agentName.toLowerCase()
  if (lowerName.includes("prometheus") || lowerName.includes("planner")) return true

  const normalized = lowerName.replace(/[_-]+/g, " ")
  return /\bplan\b/.test(normalized)
}

/** Ultrawork message source type */
export type UltraworkSource = "planner" | "gpt" | "gemini" | "default"

/**
 * Determines which ultrawork message source to use.
 */
function getUltraworkSource(
  agentName?: string,
  modelID?: string
): UltraworkSource {
  if (isPlannerAgent(agentName)) {
    return "planner"
  }
  if (modelID && isGptModel(modelID)) {
    return "gpt"
  }
  if (modelID && isGeminiModel(modelID)) {
    return "gemini"
  }
  return "default"
}

/**
 * Gets the appropriate ultrawork message based on agent and model context.
 */
export function getUltraworkMessage(
  agentName?: string,
  modelID?: string,
): string {
  const source = getUltraworkSource(agentName, modelID);

  switch (source) {
    case "planner":
      return getPlannerUltraworkMessage();
    case "gpt":
      return getGptUltraworkMessage();
    case "gemini":
      return getGeminiUltraworkMessage();
    case "default":
    default:
      return getDefaultUltraworkMessage();
  }
}
