import type { AvailableAgent } from "./yc/prompt-builder"
import type { AgentPromptMetadata } from "../plugin-agent-types"
import { CODERSEARCH_PROMPT_METADATA } from "./codersearch"
import { CODEREYE_PROMPT_METADATA } from "./codereye"
import { WEBSEARCH_PROMPT_METADATA } from "./websearch"

export const CODERHAND_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "CHEAP",
  triggers: [{ domain: "Parallel execution", trigger: "Focused subtasks that do not need delegation" }],
}

const AGENTS = [
  {
    name: "codersearch",
    description: "Open-source documentation and codebase search specialist",
    metadata: CODERSEARCH_PROMPT_METADATA,
  },
  {
    name: "codereye",
    description: "Semantic code search via Manon knowledge graph",
    metadata: CODEREYE_PROMPT_METADATA,
  },
  {
    name: "coderhand",
    description: "Focused task executor without delegation",
    metadata: CODERHAND_PROMPT_METADATA,
  },
  {
    name: "websearch",
    description: "Web search for current information and online resources",
    metadata: WEBSEARCH_PROMPT_METADATA,
  },
] as const satisfies readonly AvailableAgent[]

export function listBuiltinAgents(): AvailableAgent[] {
  return [...AGENTS]
}

export function listBuiltinAgentNames(): string[] {
  return AGENTS.map((item) => item.name)
}

export function renderBuiltinAgentList(): string {
  return AGENTS.map((item) => `- ${item.name}: ${item.description}`).join("\n")
}
