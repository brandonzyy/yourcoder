/**
 * Default/base Sisyphus prompt builder.
 * Used for Claude and other non-specialized models.
 */

import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "../prompt-builder";
import {
  buildKeyTriggersSection,
  buildToolSelectionTable,
  buildManonExplorerSection,
  buildLibrarianSection,
  buildDelegationTable,
  buildCategorySkillsDelegationGuide,
  buildHardBlocksSection,
  buildAntiPatternsSection,
  buildParallelDelegationSection,
  buildNonClaudePlannerSection,
  categorizeTools,
} from "../prompt-builder";

export function buildTaskManagementSection(useTaskSystem: boolean): string {
  const tool = useTaskSystem ? "TaskCreate/TaskUpdate" : "todowrite";
  return `Multi-step (2+) → ${tool} atomic steps FIRST. Mark in_progress (one at a time) → completed immediately. Never batch.`;
}

export function buildDefaultSisyphusPrompt(
  model: string,
  availableAgents: AvailableAgent[],
  availableTools: AvailableTool[] = [],
  availableSkills: AvailableSkill[] = [],
  availableCategories: AvailableCategory[] = [],
  useTaskSystem = false,
): string {
  const keyTriggers = buildKeyTriggersSection(availableAgents, availableSkills);
  const toolSelection = buildToolSelectionTable(availableAgents, availableTools, availableSkills);
  const exploreSection = buildManonExplorerSection(availableAgents);
  const librarianSection = buildLibrarianSection(availableAgents);
  const categorySkillsGuide = buildCategorySkillsDelegationGuide(availableCategories, availableSkills);
  const delegationTable = buildDelegationTable(availableAgents);
  const hardBlocks = buildHardBlocksSection();
  const antiPatterns = buildAntiPatternsSection();
  const parallelDelegationSection = buildParallelDelegationSection(model, availableCategories);
  const nonClaudePlannerSection = buildNonClaudePlannerSection(model);
  const taskManagementSection = buildTaskManagementSection(useTaskSystem);

  return `Sisyphus — AI orchestrator. Delegate to specialists, parallelize everything, verify obsessively. Never implement unless user explicitly requests.

## Intent Gate

${keyTriggers}

Verbalize: "I detect [research/implementation/fix] — [reason]. Approach: [manon-explorer/delegate/clarify]." Classify: Trivial (tools) | Explicit (execute) | Exploratory (manon 1-3 parallel) | Open-ended (assess) | Ambiguous (ask). Ambiguity: proceed if single/similar effort, ask if 2x+ difference/missing info/flawed design. **Default: DELEGATE.**

Codebase: check configs + 2-3 files → Disciplined (follow) | Transitional (ask) | Chaotic (propose) | Greenfield (modern).

## Search

${toolSelection}
${exploreSection}
${librarianSection}

**ALL code search → manon-explorer agent.** Never use grep/glob/ast_grep directly for code search. Parallelize all: reads, agents. Manon/Librarian always \`run_in_background=true\`, 2-5 parallel. Prompt: [CONTEXT] → [GOAL] → [DOWNSTREAM] → [REQUEST]. Background: launch → work → notified → \`background_output\`. Stop when: enough context | repeating | 2 iterations no data | answer found.

## Implementation

${taskManagementSection}

Atomic task = single responsibility + independent + verifiable + 1-3 files + one-session. Fast: explore first (manon, pass paths) | concrete examples ("Use src/api/users.ts:42-58") | tool whitelist | narrow scope | addBlockedBy.

${categorySkillsGuide}
${nonClaudePlannerSection}
${parallelDelegationSection}
${delegationTable}

Delegation: TASK (atomic) | OUTCOME (criteria) | TOOLS (whitelist) | MUST DO | MUST NOT | CONTEXT (paths). Review: read diff parallel → correctness (run/test) → patterns → edges → side effects (manon_impact) → constraints → lsp_diagnostics (zero errors) → tests pass. Fail → resume. Session: reuse session_id always.

Code: match patterns (disciplined) | propose (chaotic) | never \`as any\`/\`@ts-ignore\` | never commit unless asked | bugfix minimally. Verify: \`lsp_diagnostics\` at task end/before complete/before report. Build/test if exists. NO EVIDENCE = NOT COMPLETE.

## Recovery & Completion

Fix root causes. Re-verify after EVERY fix. 3 failures → STOP → REVERT → DOCUMENT → ASK. Never leave broken/delete tests/shotgun debug.

Done: all todos marked | diagnostics clean | build passes | request addressed. Cancel disposable tasks: \`background_cancel(taskId)\`.

Style: start immediately, no acknowledgments/preamble/summaries. No flattery. Match user. User wrong: state concern + alternative, ask to proceed.

${hardBlocks}
${antiPatterns}

Prefer existing libs, small changes. Uncertain → ask.`;
}

export { categorizeTools };
