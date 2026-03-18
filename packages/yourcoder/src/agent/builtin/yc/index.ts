import type { AgentConfig } from "@yourcoder/sdk";
import type { AgentMode, AgentPromptMetadata } from "../../plugin-agent-types";
import { isGptModel } from "../../plugin-agent-types";
import { buildTaskManagementSection } from "./prompts/default";

const MODE: AgentMode = "all";
export const YC_PROMPT_METADATA: AgentPromptMetadata = {
  category: "utility",
  cost: "EXPENSIVE",
  triggers: [],
};
import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "./prompt-builder";
import {
  buildManonSection,
  buildDelegationTable,
  buildCategorySkillsDelegationGuide,
  categorizeTools,
} from "./prompt-builder";

function buildDynamicYcPrompt(
  _model: string,
  availableAgents: AvailableAgent[],
  availableTools: AvailableTool[] = [],
  availableSkills: AvailableSkill[] = [],
  availableCategories: AvailableCategory[] = [],
  useTaskSystem = false,
): string {
  const manonSection = buildManonSection();
  const categorySkillsGuide = buildCategorySkillsDelegationGuide(
    availableCategories,
    availableSkills,
  );
  const delegationTable = buildDelegationTable(availableAgents);
  const taskManagement = buildTaskManagementSection(useTaskSystem);

  // Tool cost ladder
  const toolLines: string[] = [];
  if (availableTools.length > 0) {
    const searchTools = availableTools.filter((t) => t.category === "search").map((t) => `\`${t.name}\``);
    const lspTools = availableTools.filter((t) => t.category === "lsp");
    const astTools = availableTools.filter((t) => t.category === "ast");
    const parts = [...searchTools];
    if (lspTools.length > 0) parts.push("`lsp_*`");
    if (astTools.length > 0) parts.push("`ast_grep`");
    if (parts.length > 0) toolLines.push(`- ${parts.join(", ")} — **FREE**`);
  }
  for (const agent of availableAgents.filter((a) => a.metadata.category !== "utility")) {
    toolLines.push(`- \`${agent.name}\` — **${agent.metadata.cost}** — ${agent.description.split(".")[0]}`);
  }

  return `You are Yc — AI orchestrator from YourCoder. Delegate to specialists, parallelize everything, verify obsessively. Never implement unless explicitly asked.

## Search

${manonSection}

### Tool & Agent Cost Ladder
${toolLines.join("\n")}

**Default**: manon_search/manon_graph (direct) + codersearch (background, \`run_in_background=true\`) → task() if implementation needed.
Fire 2-3 Manon calls in parallel for any non-trivial question. Fall back to grep/glob only when graph has no coverage. Stop when: enough context | repeating | 2 iterations no data | answer found.

## Delegation

${taskManagement}

${categorySkillsGuide}

${delegationTable}

Delegation prompt MUST include: TASK (atomic goal) | OUTCOME (success criteria) | TOOLS (whitelist) | MUST DO | MUST NOT | CONTEXT (file paths, patterns). Reuse \`session_id\` for follow-ups — never start a fresh session for the same work.

## Execution

1. Classify: Trivial → tools only. Explicit → execute. Exploratory → manon 2-3 parallel. Open-ended → assess first. Ambiguous → ask ONE question.
2. Before acting: check for specialized category+skills match. Default bias: DELEGATE.
3. Verify ALL changes: \`lsp_diagnostics\` on changed files. Run tests if they exist. Read every file subagents touched — never trust self-reports.
4. Failure recovery: fix root causes. 3 failures → STOP → REVERT → DOCUMENT → ASK.

## Constraints

- Type error suppression (\`as any\`, \`@ts-ignore\`) — **Never**
- Commit without explicit request — **Never**
- Speculate about unread code — **Never**
- Leave code in broken state — **Never**
- \`background_cancel(all=true)\` — **Never.** Cancel individually by taskId.

Anti-patterns: empty catch blocks, deleting failing tests, shotgun debugging, polling \`background_output\` on running tasks.

## Style

Start immediately. No acknowledgments, preamble, or trailing summaries. Match user's style. User wrong → state concern + alternative, ask to proceed. Prefer existing libs, small changes. Uncertain → ask.`;
}

export function createYcAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  useTaskSystem = false,
): AgentConfig {
  const tools = availableToolNames ? categorizeTools(availableToolNames) : [];
  const skills = availableSkills ?? [];
  const categories = availableCategories ?? [];
  const agents = availableAgents ?? [];

  const prompt = buildDynamicYcPrompt(
    model,
    agents,
    tools,
    skills,
    categories,
    useTaskSystem,
  );

  const permission = {
    question: "allow",
    call_omo_agent: "deny",
  } as AgentConfig["permission"];
  const base = {
    description:
      "Powerful AI orchestrator. Plans obsessively with todos, assesses search complexity before exploration, delegates strategically via category+skills combinations. Uses Manon MCP directly for internal code search, codersearch for external docs. (Yc - YourCoder)",
    mode: MODE,
    model,
    maxTokens: 64000,
    prompt,
    color: "#00CED1",
    permission,
    capabilities: {
      include: ["core", "search", "delegation", "skill", "lsp", "session", "meta", "mcp", "interactive", "media"],
      deny: ["call_omo_agent", "ast"],
    },
  };

  if (isGptModel(model)) {
    return { ...base, reasoningEffort: "medium" };
  }

  return { ...base, thinking: { type: "enabled", budgetTokens: 32000 } };
}
createYcAgent.mode = MODE;
