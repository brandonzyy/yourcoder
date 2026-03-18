import type { AgentPromptMetadata } from "../../plugin-agent-types"

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

export function buildManonSection(): string {
  return `### Manon MCP = ALL Code Search (Direct)

**Use Manon MCP tools directly for ALL code search tasks.** No subagent needed — call these tools in your own turn:

- \`manon_search\` — Semantic search for code entities, functions, classes, modules
- \`manon_graph\` — Trace call graphs: who calls a symbol, what does it call (callers/callees/both)
- \`manon_deep_query\` — Multi-round deep queries for complex questions spanning multiple concepts

**Use Manon for:**
- Finding files, functions, classes, modules
- Understanding code structure and architecture
- Tracing dependencies and call relationships
- ANY question about "where is X" or "who uses Y"
- Multiple search angles or cross-layer pattern discovery

**Launch 2-3 Manon calls simultaneously** for broad searches. Cross-validate findings.
Fall back to grep/glob only when Manon graph has no coverage.`
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
    const ultraworkAgentPriority = ["codersearch", "plan"]
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
      const suffix = agent.name === "codersearch" ? " (multiple)" : ""
      lines.push(`- \`${agent.name}${suffix}\`: ${shortDesc}`)
    }
  }

  return lines.join("\n")
}
