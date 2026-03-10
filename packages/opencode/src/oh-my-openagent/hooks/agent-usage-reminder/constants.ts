import { join } from "node:path";
import { OPENCODE_STORAGE } from "../../shared";
export const AGENT_USAGE_REMINDER_STORAGE = join(
  OPENCODE_STORAGE,
  "agent-usage-reminder",
);

// All tool names normalized to lowercase for case-insensitive matching
export const TARGET_TOOLS = new Set([
  "grep",
  "safe_grep",
  "glob",
  "safe_glob",
  "webfetch",
  "context7_resolve-library-id",
  "context7_query-docs",
  "websearch_web_search_exa",
  "context7_get-library-docs",
  "grep_app_searchgithub",
]);

export const EXECUTION_TOOLS = new Set([
  "edit",
  "write",
  "apply_patch",
  "hashline_edit",
  "bash",
]);

export const AGENT_TOOLS = new Set([
  "task",
  "call_omo_agent",
  "task",
]);

export const REMINDER_MESSAGE = `
[Agent Usage Reminder]

You called a search/fetch tool directly without leveraging specialized agents.

RECOMMENDED: Use task with explore/librarian agents for better results:

\`\`\`
// Parallel exploration - fire multiple agents simultaneously
task(agent="explore", prompt="Find all files matching pattern X")
task(agent="explore", prompt="Search for implementation of Y") 
task(agent="librarian", prompt="Lookup documentation for Z")

// Then continue your work while they run in background
// System will notify you when each completes
\`\`\`

WHY:
- Agents can perform deeper, more thorough searches
- Background tasks run in parallel, saving time
- Specialized agents have domain expertise
- Reduces context window usage in main session

ALWAYS prefer: Multiple parallel task calls > Direct tool calls
`;

export const EXECUTION_REMINDER_MESSAGE = `
[Orchestrator Enforcement Reminder]

You called an execution tool (edit/write/bash) directly. As an orchestrator, you MUST delegate implementation to subagents.

REQUIRED: Decompose and delegate via task():

\`\`\`
// Delegate implementation to specialized agents
task(category="deep", load_skills=["relevant-skill"], prompt="TASK: ... EXPECTED OUTCOME: ... MUST DO: ... MUST NOT DO: ...")
\`\`\`

WHY:
- Subagents have domain-specific configurations and loaded skills
- Direct implementation by orchestrators produces measurably worse results
- Your value is orchestration, decomposition, and quality control

NEVER implement directly when delegation is possible. You write prompts, not code.
`;
