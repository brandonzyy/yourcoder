import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "./types"

const MODE: AgentMode = "subagent"

export const MANON_EXPLORER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "exploration",
  cost: "FREE",
  promptAlias: "Manon-Explorer",
  keyTrigger: "2+ modules involved → fire `manon-explorer` background",
  triggers: [
    { domain: "Explore", trigger: "Find existing codebase structure, patterns, dependencies and call graphs" },
  ],
  useWhen: [
    "Multiple search angles needed",
    "Unfamiliar module structure",
    "Cross-layer pattern discovery",
    "Understanding call graphs and dependencies",
    "Semantic code search across the codebase",
  ],
  avoidWhen: [
    "You know exactly what to search",
    "Single keyword/pattern suffices",
    "Known file location",
  ],
}

export function createManonExplorerAgent(model: string): AgentConfig {
  return {
    description:
      'Semantic code search agent powered by Manon knowledge graph. Answers "Where is X?", "Who calls Y?", "What depends on Z?". Fire multiple in parallel for broad searches. Uses manon_search for semantic lookup, manon_graph for call/dependency graphs, manon_deep_query for complex multi-hop questions. (Manon-Explorer - OhMyOpenCode)',
    mode: MODE,
    model,
    temperature: 0.1,
    capabilities: {
      include: ["core", "mcp"],
    },
    prompt: `You are a codebase search specialist powered by Manon knowledge graph. Find files and code using semantic search, return actionable results.

## Tools

- **manon_search** — Semantic search for code entities, functions, classes, modules
- **manon_graph** — Trace call graphs: who calls a symbol, what does it call (callers/callees/both)
- **manon_deep_query** — Multi-round deep queries for complex questions spanning multiple concepts
- **bash** (git commands) — History/evolution: when added, who changed

Launch **3+ Manon calls simultaneously** in your first action. Cross-validate findings.

## Output Requirements

Every response MUST include a \`<results>\` block:

\`\`\`
<results>
<files>
- /absolute/path/to/file.ts — [why relevant]
</files>
<answer>
[Direct answer addressing the actual need, not just file list]
[Include call graph relationships if relevant]
</answer>
<next_steps>
[What to do next, or "Ready to proceed"]
</next_steps>
</results>
\`\`\`

## Quality Standards

- ALL paths must be **absolute**
- Find ALL relevant matches, not just the first one
- Address the **actual need** behind the literal request
- Caller should be able to proceed **without follow-up questions**

## Constraints

- **Read-only**: You cannot create, modify, or delete files
- **No emojis**: Keep output clean and parseable`,
  }
}
createManonExplorerAgent.mode = MODE
