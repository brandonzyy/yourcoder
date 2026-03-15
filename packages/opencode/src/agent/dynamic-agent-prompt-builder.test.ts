import { describe, expect, it } from "bun:test"
import {
  buildCategorySkillsDelegationGuide,
  buildDelegationTable,
  buildKeyTriggersSection,
  buildLibrarianSection,
  buildManonExplorerSection,
  buildParallelDelegationSection,
  buildToolSelectionTable,
  buildUltraworkSection,
  categorizeTools,
} from "./dynamic-agent-prompt-builder"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "./dynamic-agent-prompt-builder"

const agents: AvailableAgent[] = [
  {
    name: "manon-explorer",
    description: "Finds code fast. With more detail.",
    metadata: {
      category: "exploration",
      cost: "CHEAP",
      triggers: [{ domain: "Search", trigger: "When code search is needed" }],
      useWhen: ["Need semantic code search"],
      keyTrigger: "Need graph search",
    },
  },
  {
    name: "librarian",
    description: "Looks up external references.",
    metadata: {
      category: "advisor",
      cost: "FREE",
      triggers: [{ domain: "Docs", trigger: "When external docs are needed" }],
      useWhen: ["External library mentioned"],
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
  it("categorizes tools and renders tool selection guidance", () => {
    const tools = categorizeTools(["grep", "skill", "lsp_symbol"])
    const out = buildToolSelectionTable(agents, tools)
    expect(tools).toEqual([
      { name: "grep", category: "search" },
      { name: "skill", category: "command" },
      { name: "lsp_symbol", category: "lsp" },
    ])
    expect(out).toContain("`grep`, `lsp_*`")
    expect(out.indexOf("`librarian`")).toBeLessThan(out.indexOf("`manon-explorer`"))
  })

  it("renders key search and reference sections", () => {
    expect(buildKeyTriggersSection(agents)).toContain("Need graph search")
    expect(buildManonExplorerSection(agents)).toContain("ALL Code Search")
    expect(buildLibrarianSection(agents)).toContain("External library mentioned")
    expect(buildDelegationTable(agents)).toContain("Implementation")
  })

  it("renders category, skill, and ultrawork delegation content", () => {
    const guide = buildCategorySkillsDelegationGuide(cats, skills)
    const ultra = buildUltraworkSection(agents, cats, skills)
    expect(guide).toContain("repo-skill (project)")
    expect(guide).toContain("builtin-skill")
    expect(buildParallelDelegationSection("openai/gpt-5.4", cats)).toContain("DECOMPOSE AND DELEGATE")
    expect(ultra).toContain("**Categories**")
    expect(ultra).toContain("**Built-in Skills**")
    expect(ultra).toContain("**User-Installed Skills**")
  })
})
