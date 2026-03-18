import { describe, expect, it } from "bun:test"
import {
  buildDelegationTable,
  buildManonSection,
  buildCategorySkillsDelegationGuide,
  buildUltraworkSection,
  categorizeTools,
} from "./dynamic-agent-prompt-builder"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-builder"

const agents: AvailableAgent[] = [
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

describe("dynamic agent prompt builder", () => {
  it("categorizes tools correctly", () => {
    const tools = categorizeTools(["grep", "skill", "lsp_symbol"])
    expect(tools).toEqual([
      { name: "grep", category: "search" },
      { name: "skill", category: "command" },
      { name: "lsp_symbol", category: "lsp" },
    ])
  })

  it("renders search and delegation sections", () => {
    const manon = buildManonSection()
    expect(manon).toContain("Manon MCP")
    expect(manon).toContain("manon_search")
    expect(buildDelegationTable(agents)).toContain("Implementation")
  })

  it("renders category, skill, and ultrawork delegation content", () => {
    const guide = buildCategorySkillsDelegationGuide(cats, skills)
    const ultra = buildUltraworkSection(agents, cats, skills)
    expect(guide).toContain("repo-skill (project)")
    expect(guide).toContain("builtin-skill")
    expect(ultra).toContain("**Categories**")
    expect(ultra).toContain("**Built-in Skills**")
    expect(ultra).toContain("**User-Installed Skills**")
  })
})
