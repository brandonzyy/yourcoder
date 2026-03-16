import { describe, expect, it } from "bun:test"
import {
  buildAntiPatternsSection,
  buildCategorySkillsDelegationGuide,
  buildDelegationTable,
  buildHardBlocksSection,
  buildKeyTriggersSection,
  buildCodersearchSection,
  buildCodereyeSection,
  buildNonClaudePlannerSection,
  buildParallelDelegationSection,
  buildToolSelectionTable,
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
    name: "codereye",
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
    name: "codersearch",
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
  it("builds key triggers only when present", () => {
    const out = buildKeyTriggersSection(agents)
    expect(out).toContain("Key Triggers")
    expect(out).toContain("Need graph search")
    expect(buildKeyTriggersSection([])).toBe("")
  })

  it("builds the tool selection table in cost order and excludes utility agents", () => {
    const out = buildToolSelectionTable(agents, categorizeTools(["grep", "lsp_symbol", "ast_grep"]))
    expect(out).toContain("`grep`, `lsp_*`, `ast_grep`")
    expect(out.indexOf("`codersearch`")).toBeLessThan(out.indexOf("`codereye`"))
    expect(out.indexOf("`codereye`")).toBeLessThan(out.indexOf("`builder`"))
    expect(out).not.toContain("utility-bot")
  })

  it("renders agent specific sections and delegation guidance", () => {
    const manon = buildCodereyeSection(agents)
    const lib = buildCodersearchSection(agents)
    const table = buildDelegationTable(agents)
    const guide = buildCategorySkillsDelegationGuide(cats, skills)
    expect(manon).toContain("MANDATORY for ALL code search tasks")
    expect(lib).toContain("External library mentioned")
    expect(table).toContain("Implementation")
    expect(guide).toContain("repo-skill (project)")
    expect(guide).toContain("builtin-skill")
  })

  it("renders policy sections and model-specific gates", () => {
    expect(buildHardBlocksSection()).toContain("Hard Blocks")
    expect(buildAntiPatternsSection()).toContain("Anti-Patterns")
    expect(buildNonClaudePlannerSection("openai/gpt-5.4")).toContain("Plan Agent Dependency")
    expect(buildNonClaudePlannerSection("anthropic/claude-sonnet-4-6")).toBe("")
    expect(buildParallelDelegationSection("openai/gpt-5.4", cats)).toContain("DECOMPOSE AND DELEGATE")
    expect(buildParallelDelegationSection("openai/gpt-5.4", [{ name: "quick", description: "small" }])).toBe("")
  })

  it("builds the ultrawork section with category, skill, and agent summaries", () => {
    const out = buildUltraworkSection(agents, cats, skills)
    expect(out).toContain("**Categories**")
    expect(out).toContain("**Built-in Skills**")
    expect(out).toContain("**User-Installed Skills**")
    expect(out).toContain("`codereye (multiple)`")
    expect(out).toContain("`codersearch (multiple)`")
  })
})
