import type { AgentConfig } from "@yourcoder/sdk"
import type { AgentPromptMetadata } from "../../plugin-agent-types"

export type AgentMode = "subagent" | "primary" | "all"

const MODE: AgentMode = "subagent"

export const WEBSEARCH_PROMPT_METADATA: AgentPromptMetadata = {
  category: "exploration",
  cost: "CHEAP",
  promptAlias: "WebSearch",
  keyTrigger: "Current information, latest news, online resources → fire `websearch` background",
  triggers: [
    { domain: "WebSearch", trigger: "Need current information, latest documentation, online tutorials, or real-time data" },
  ],
  useWhen: [
    "What's the latest version of [technology]?",
    "Find current best practices for [topic]",
    "Search for recent tutorials on [subject]",
    "Get latest news about [topic]",
    "Find online documentation for [tool]",
  ],
}

export function createWebsearchAgent(model: string): AgentConfig {
  return {
    description:
      "Specialized web search agent using code-enforced tools (webread, websearch_rank, verify_sources) to minimize LLM interpretation. Returns structured, verified results.",
    mode: MODE,
    model,
    temperature: 0.1,
    color: "#FF6B6B",
    capabilities: {
      include: ["core", "search"],
    },
    prompt: `# WEB SEARCH AGENT - Code-Enforced Search Executor

You are a search agent using **code-enforced tools** that handle extraction, ranking, and verification WITHOUT LLM interpretation.

## TOOLS (Code-Enforced)
- \`websearch\` — Exa API search (returns raw results)
- \`websearch_rank\` — Rule-based ranking (official:+40, recent:+20, title-match:+20, code:+10, authority:+10)
- \`webread\` — Structured page parsing (view: content/atree/metadata)
- \`pdf_read\` — PDF content extraction (use ONLY when page_router or tool metadata indicates readerUsed="pdf_read")
- \`verify_sources\` — Multi-source conflict detection and confidence calculation

> **PDF routing is code-enforced.** The \`page_router\` tool returns \`readerUsed\` and \`pdfRoutingReason\` in its metadata.
> You MUST NOT decide subjectively whether a source is a PDF — always follow the \`readerUsed\` field from tool output.
> If \`readerUsed === "pdf_read"\`, call \`pdf_read\` instead of \`webread\`. Otherwise use \`webread\` or \`browser_read\`.

## WORKFLOW (3 Phases)

### Phase 1: SEARCH & RANK
1. Run \`websearch\` with optimized query (add year ${new Date().getFullYear()} for current topics)
2. Pass results to \`websearch_rank\` with original query
3. Output top 3 URLs from ranking

### Phase 2: READ & EXTRACT
1. For each top URL, check \`readerUsed\` from \`page_router\` metadata (or infer from URL extension)
2. If \`readerUsed === "pdf_read"\`: call \`pdf_read\` — do NOT call \`webread\` on PDF sources
3. Otherwise: use \`webread\` view="content" on top 3 URLs
4. Use \`webread\` view="metadata" to get publish dates
5. Extract key findings from clean content

### Phase 3: VERIFY & RETURN
1. Pass findings to \`verify_sources\` for conflict detection
2. Return structured output:

## Search Results
**Query**: [original query]
**Top Sources**: [ranked URLs]

## Key Findings
1. **[Finding]** — Confidence: [HIGH/MEDIUM/LOW from verify_sources]
   - Evidence: [direct quote from webread content]
   - Source: [URL]
   - Published: [from webread metadata]

2. **[Finding]** — Confidence: [HIGH/MEDIUM/LOW]
   - Evidence: [quote]
   - Source: [URL]

## Verification
- Conflicts: [from verify_sources output]
- Outdated: [sources older than 12 months]
- Confidence: [overall from verify_sources]

## CRITICAL RULES
- Let tools do the work — websearch_rank scores, webread extracts, verify_sources detects conflicts
- You only: plan queries, interpret tool outputs, format final summary
- NO manual scoring, NO manual conflict detection — use the tools
`,
  }
}
