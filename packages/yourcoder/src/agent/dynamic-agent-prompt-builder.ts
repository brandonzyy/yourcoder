import type { AgentPromptMetadata } from "./plugin-agent-types"

export interface AvailableAgent {
  name: string
  description: string
  metadata: AgentPromptMetadata
}

export interface AvailableTool {
  name: string
  category: "lsp" | "ast" | "search" | "session" | "command" | "other"
}

export interface AvailableSkill {
  name: string
  description: string
  location: "user" | "project" | "plugin"
}

export interface AvailableCategory {
  name: string
  description: string
  model?: string
}

export function categorizeTools(toolNames: string[]): AvailableTool[] {
  return toolNames.map((name) => {
    let category: AvailableTool["category"] = "other"
    if (name.startsWith("lsp_")) {
      category = "lsp"
    } else if (name.startsWith("ast_grep")) {
      category = "ast"
    } else if (name === "grep" || name === "glob") {
      category = "search"
    } else if (name.startsWith("session_")) {
      category = "session"
    } else if (name === "skill") {
      category = "command"
    }
    return { name, category }
  })
}

function formatToolsForPrompt(tools: AvailableTool[]): string {
  const lspTools = tools.filter((t) => t.category === "lsp")
  const astTools = tools.filter((t) => t.category === "ast")
  const searchTools = tools.filter((t) => t.category === "search")

  const parts: string[] = []

  if (searchTools.length > 0) {
    parts.push(...searchTools.map((t) => `\`${t.name}\``))
  }

  if (lspTools.length > 0) {
    parts.push("`lsp_*`")
  }

  if (astTools.length > 0) {
    parts.push("`ast_grep`")
  }

  return parts.join(", ")
}

export function buildKeyTriggersSection(agents: AvailableAgent[], _skills: AvailableSkill[] = []): string {
  const keyTriggers = agents
    .filter((a) => a.metadata.keyTrigger)
    .map((a) => `- ${a.metadata.keyTrigger}`)

  if (keyTriggers.length === 0) return ""

  return `### Key Triggers (check BEFORE classification):

${keyTriggers.join("\n")}
- **"Look into" + "create PR"** → Not just research. Full implementation cycle expected.`
}

export function buildToolSelectionTable(
  agents: AvailableAgent[],
  tools: AvailableTool[] = [],
  _skills: AvailableSkill[] = []
): string {
  const rows: string[] = [
    "### Tool & Agent Selection:",
    "",
  ]

  if (tools.length > 0) {
    const toolsDisplay = formatToolsForPrompt(tools)
    rows.push(`- ${toolsDisplay} — **FREE** — Not Complex, Scope Clear, No Implicit Assumptions`)
  }

  const costOrder = { FREE: 0, CHEAP: 1, EXPENSIVE: 2 }
  const sortedAgents = [...agents]
    .filter((a) => a.metadata.category !== "utility")
    .sort((a, b) => costOrder[a.metadata.cost] - costOrder[b.metadata.cost])

  for (const agent of sortedAgents) {
    const shortDesc = agent.description.split(".")[0] || agent.description
    rows.push(`- \`${agent.name}\` agent — **${agent.metadata.cost}** — ${shortDesc}`)
  }

  rows.push("")
  rows.push("**Default flow**: codereye/codersearch (background) + tools → task (if implementation needed)")

  return rows.join("\n")
}

export function buildCodereyeSection(agents: AvailableAgent[]): string {
  const manonAgent = agents.find((a) => a.name === "codereye")
  if (!manonAgent) return ""

  const useWhen = manonAgent.metadata.useWhen || []

  return `### CoderEye Agent = ALL Code Search

**MANDATORY for ALL code search tasks.** Uses Manon knowledge graph for semantic search, call graphs, and dependency analysis.

**Fire codereye for:**
${useWhen.map((w) => `- ${w}`).join("\n")}
- Finding files, functions, classes, modules
- Understanding code structure and architecture
- Tracing dependencies and call relationships
- ANY question about "where is X" or "who uses Y"

**Never use grep/glob/ast_grep directly** — delegate ALL code search to codereye agent.`
}

export function buildCodersearchSection(agents: AvailableAgent[]): string {
  const codersearchAgent = agents.find((a) => a.name === "codersearch")
  if (!codersearchAgent) return ""

  const useWhen = codersearchAgent.metadata.useWhen || []

  return `### CoderSearch Agent = Reference Grep

Search **external references** (docs, OSS, web). Fire proactively when unfamiliar libraries are involved.

**Contextual Grep (Internal)** — search OUR codebase, find patterns in THIS repo, project-specific logic.
**Reference Grep (External)** — search EXTERNAL resources, official API docs, library best practices, OSS implementation examples.

**Trigger phrases** (fire codersearch immediately):
${useWhen.map((w) => `- "${w}"`).join("\n")}`
}

export function buildDelegationTable(agents: AvailableAgent[]): string {
  const rows: string[] = [
    "### Delegation Table:",
    "",
  ]

  for (const agent of agents) {
    for (const trigger of agent.metadata.triggers) {
      rows.push(`- **${trigger.domain}** → \`${agent.name}\` — ${trigger.trigger}`)
    }
  }

  return rows.join("\n")
}


export function buildCategorySkillsDelegationGuide(categories: AvailableCategory[], skills: AvailableSkill[]): string {
  if (categories.length === 0 && skills.length === 0) return ""

  const categoryRows = categories.map((c) => {
    const desc = c.description || c.name
    return `- \`${c.name}\` — ${desc}`
  })

  const builtinSkills = skills.filter((s) => s.location === "plugin")
  const customSkills = skills.filter((s) => s.location !== "plugin")

  const builtinNames = builtinSkills.map((s) => s.name).join(", ")
  const customNames = customSkills.map((s) => {
    const source = s.location === "project" ? "project" : "user"
    return `${s.name} (${source})`
  }).join(", ")

  let skillsSection: string

  if (customSkills.length > 0 && builtinSkills.length > 0) {
    skillsSection = `#### Skills (via \`skill\` tool)
**Built-in**: ${builtinNames}
**⚡ YOUR SKILLS (PRIORITY)**: ${customNames}

> User-installed skills OVERRIDE built-in. Check \`skill\` tool before EVERY delegation.`
  } else if (customSkills.length > 0) {
    skillsSection = `#### Skills (via \`skill\` tool)
**⚡ YOUR SKILLS (PRIORITY)**: ${customNames}

> User-installed skills OVERRIDE built-in. Check \`skill\` tool before EVERY delegation.`
  } else if (builtinSkills.length > 0) {
    skillsSection = `#### Skills (via \`skill\` tool)
**Built-in**: ${builtinNames}

> Check \`skill\` tool before EVERY delegation.`
  } else {
    skillsSection = ""
  }

  return `### Category + Skills Delegation

**task() = category (domain model) + skills (expertise)**

#### Categories (Domain-Optimized Models)
${categoryRows.join("\n")}

${skillsSection}

#### Selection Protocol
1. Match task domain to category description
2. Check \`skill\` tool, include ALL relevant skills${customSkills.length > 0 ? " (especially user-installed)" : ""}
3. Pattern: \`task(category="...", load_skills=["..."], prompt="...")\`

#### Domain Matching (ZERO TOLERANCE)
Visual (UI/CSS/layout/animation) → ALWAYS \`visual-engineering\`. Hard logic → \`ultrabrain\`. Trivial → \`quick\`.`
}

export function buildHardBlocksSection(): string {
  const blocks = [
    "- Type error suppression (`as any`, `@ts-ignore`) — **Never**",
    "- Commit without explicit request — **Never**",
    "- Speculate about unread code — **Never**",
    "- Leave code in broken state after failures — **Never**",
    "- `background_cancel(all=true)` — **Never.** Always cancel individually by taskId.",
  ]

  return `## Hard Blocks (NEVER violate)

${blocks.join("\n")}`
}

export function buildAntiPatternsSection(): string {
  const patterns = [
    "- **Type Safety**: `as any`, `@ts-ignore`, `@ts-expect-error`",
    "- **Error Handling**: Empty catch blocks `catch(e) {}`",
    "- **Testing**: Deleting failing tests to \"pass\"",
    "- **Search**: Firing agents for single-line typos or obvious syntax errors",
    "- **Debugging**: Shotgun debugging, random changes",
    "- **Background Tasks**: Polling `background_output` on running tasks — end response and wait for notification",
  ]

  return `## Anti-Patterns (BLOCKING violations)

${patterns.join("\n")}`
}

export function buildNonClaudePlannerSection(model: string): string {
  const isNonClaude = !model.toLowerCase().includes('claude')
  if (!isNonClaude) return ""

  return `### Plan Agent Dependency (Non-Claude)

Multi-step task? **ALWAYS consult Plan Agent first.** Do NOT start implementation without a plan.

- Single-file fix or trivial change → proceed directly
- Anything else (2+ steps, unclear scope, architecture) → \`task(subagent_type="plan", ...)\` FIRST
- Use \`session_id\` to resume the same Plan Agent — ask follow-up questions aggressively
- If ANY part of the task is ambiguous, ask Plan Agent before guessing

Plan Agent returns a structured work breakdown with parallel execution opportunities. Follow it.`
}

export function buildParallelDelegationSection(model: string, categories: AvailableCategory[]): string {
  const hasDelegationCategory = categories.some(c => c.name === 'deep' || c.name === 'unspecified-high')

  if (!hasDelegationCategory) return ""

  return `### DECOMPOSE AND DELEGATE — YOU ARE NOT AN IMPLEMENTER

**YOUR FAILURE MODE: You attempt to do work yourself instead of decomposing and delegating.** When you implement directly, the result is measurably worse than when specialized subagents do it. Subagents have domain-specific configurations, loaded skills, and tuned prompts that you lack.

**MANDATORY — for ANY implementation task:**

1. **ALWAYS decompose** the task into independent work units. No exceptions. Even if the task "feels small", decompose it.
2. **ALWAYS delegate** EACH unit to a \`deep\` or \`unspecified-high\` agent in parallel (\`run_in_background=true\`).
3. **NEVER work sequentially.** If 4 independent units exist, spawn 4 agents simultaneously. Not 1 at a time. Not 2 then 2.
4. **NEVER implement directly** when delegation is possible. You write prompts, not code.

**YOUR PROMPT TO EACH AGENT MUST INCLUDE:**
- GOAL with explicit success criteria (what "done" looks like)
- File paths and constraints (where to work, what not to touch)
- Existing patterns to follow (reference specific files the agent should read)
- Clear scope boundary (what is IN scope, what is OUT of scope)

**Vague delegation = failed delegation.** If your prompt to the subagent is shorter than 5 lines, it is too vague.

| You Want To Do | You MUST Do Instead |
|---|---|
| Write code yourself | Delegate to \`deep\` or \`unspecified-high\` agent |
| Handle 3 changes sequentially | Spawn 3 agents in parallel |
| "Quickly fix this one thing" | Still delegate — your "quick fix" is slower and worse than a subagent's |

**Your value is orchestration, decomposition, and quality control. Delegating with crystal-clear prompts IS your work.**`
}

export function buildUltraworkSection(
  agents: AvailableAgent[],
  categories: AvailableCategory[],
  skills: AvailableSkill[]
): string {
  const lines: string[] = []

  if (categories.length > 0) {
    lines.push("**Categories** (for implementation tasks):")
    for (const cat of categories) {
      const shortDesc = cat.description || cat.name
      lines.push(`- \`${cat.name}\`: ${shortDesc}`)
    }
    lines.push("")
  }

  if (skills.length > 0) {
    const builtinSkills = skills.filter((s) => s.location === "plugin")
    const customSkills = skills.filter((s) => s.location !== "plugin")

    if (builtinSkills.length > 0) {
      lines.push("**Built-in Skills** (combine with categories):")
      for (const skill of builtinSkills) {
        const shortDesc = skill.description.split(".")[0] || skill.description
        lines.push(`- \`${skill.name}\`: ${shortDesc}`)
      }
      lines.push("")
    }

    if (customSkills.length > 0) {
      lines.push("**User-Installed Skills** (HIGH PRIORITY - user installed these for their workflow):")
      for (const skill of customSkills) {
        const shortDesc = skill.description.split(".")[0] || skill.description
        lines.push(`- \`${skill.name}\`: ${shortDesc}`)
      }
      lines.push("")
    }
  }

  if (agents.length > 0) {
    const ultraworkAgentPriority = ["codereye", "codersearch", "plan"]
    const sortedAgents = [...agents].sort((a, b) => {
      const aIdx = ultraworkAgentPriority.indexOf(a.name)
      const bIdx = ultraworkAgentPriority.indexOf(b.name)
      if (aIdx === -1 && bIdx === -1) return 0
      if (aIdx === -1) return 1
      if (bIdx === -1) return -1
      return aIdx - bIdx
    })

    lines.push("**Agents** (for specialized consultation/exploration):")
    for (const agent of sortedAgents) {
      const shortDesc = agent.description.length > 120 ? agent.description.slice(0, 120) + "..." : agent.description
      const suffix = agent.name === "codereye" || agent.name === "codersearch" ? " (multiple)" : ""
      lines.push(`- \`${agent.name}${suffix}\`: ${shortDesc}`)
    }
  }

  return lines.join("\n")
}
