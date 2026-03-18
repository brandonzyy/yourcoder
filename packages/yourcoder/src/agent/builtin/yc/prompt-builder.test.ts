import { describe, expect, it } from "bun:test"
import {
  buildCategorySkillsDelegationGuide,
  buildDelegationTable,
  buildManonSection,
  buildUltraworkSection,
  categorizeTools,
} from "./prompt-builder"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./prompt-builder"

const agents: AvailableAgent[] = [
  {
    name: "utility-bot",
    description: "Utility only.",
    metadata: {
      category: "utility",
      cost: "FREE",
      triggers: [],
    },
  },
  {
    name: "codersearch",
    description: "Looks up external references.",
    metadata: {
      category: "advisor",
      cost: "FREE",
      triggers: [{ domain: "Docs", trigger: "When external docs are needed" }],
    },
  },
  {
    name: "builder",
    description: "Builds features. Carefully.",
    metadata: {
      category: "specialist",
      cost: "EXPENSIVE",
      triggers: [{ domain: "Implementation", trigger: "When code needs changes" }],
    },
  },
]

const cats: AvailableCategory[] = [
  { name: "quick", description: "Small tasks" },
  { name: "deep", description: "Deep work" },
]

const skills: AvailableSkill[] = [
  { name: "repo-skill", description: "Project specific knowledge.", location: "project" },
  { name: "builtin-skill", description: "Bundled expertise.", location: "plugin" },
]

describe("categorizeTools", () => {
  it("assigns each tool to the expected category", () => {
    expect(categorizeTools(["lsp_symbol", "ast_grep", "grep", "session_list", "skill", "bash"])).toEqual([
      { name: "lsp_symbol", category: "lsp" },
      { name: "ast_grep", category: "ast" },
      { name: "grep", category: "search" },
      { name: "session_list", category: "session" },
      { name: "skill", category: "command" },
      { name: "bash", category: "other" },
    ])
  })
})

describe("prompt sections", () => {
  it("renders agent specific sections and delegation guidance", () => {
    const manon = buildManonSection()
    const table = buildDelegationTable(agents)
    const guide = buildCategorySkillsDelegationGuide(cats, skills)
    expect(manon).toContain("Manon MCP")
    expect(manon).toContain("manon_search")
    expect(manon).toContain("manon_graph")
    expect(manon).toContain("manon_deep_query")
    expect(table).toContain("Implementation")
    expect(guide).toContain("repo-skill (project)")
    expect(guide).toContain("builtin-skill")
  })

  it("builds the ultrawork section with category, skill, and agent summaries", () => {
    const out = buildUltraworkSection(agents, cats, skills)
    expect(out).toContain("**Categories**")
    expect(out).toContain("**Built-in Skills**")
    expect(out).toContain("**User-Installed Skills**")
    expect(out).toContain("`codersearch (multiple)`")
  })
})
