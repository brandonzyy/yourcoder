import { describe, expect, it } from "bun:test"
import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_PROMPT_APPENDS,
  DEFAULT_CATEGORIES,
  PLAN_AGENT_NAMES,
  PLAN_FAMILY_NAMES,
  buildPlanAgentSkillsSection,
  buildPlanAgentSystemPrepend,
  isPlanAgent,
  isPlanFamily,
} from "./constants"

describe("delegate task constants", () => {
  it("keeps category metadata aligned across prompt appends, descriptions, and defaults", () => {
    const keys = Object.keys(DEFAULT_CATEGORIES).sort()
    expect(Object.keys(CATEGORY_PROMPT_APPENDS).sort()).toEqual(keys)
    expect(Object.keys(CATEGORY_DESCRIPTIONS).sort()).toEqual(keys)
    expect(DEFAULT_CATEGORIES.quick.model).toContain("claude-haiku")
    expect(CATEGORY_PROMPT_APPENDS["visual-engineering"]).toContain("DESIGN_SYSTEM_WORKFLOW_MANDATE")
  })

  it("renders plan agent skill tables with sorted categories and skills", () => {
    const out = buildPlanAgentSkillsSection(
      [
        { name: "deep", description: "Deep work", model: "openai/gpt-5.3-codex" },
        { name: "quick", description: "Small work", model: "anthropic/claude-haiku-4-5" },
      ],
      [
        { name: "repo-skill", description: "Project specific knowledge", location: "project" },
        { name: "builtin-skill", description: "Bundled knowledge", location: "plugin" },
      ],
    )

    expect(out).toContain("AVAILABLE CATEGORIES")
    expect(out).toContain("`deep`")
    expect(out).toContain("`quick`")
    expect(out).toContain("`builtin-skill`")
    expect(out).toContain("`repo-skill`")
  })

  it("builds the plan system prompt and detects plan-family agents", () => {
    const out = buildPlanAgentSystemPrepend(
      [{ name: "deep", description: "Deep work", model: "openai/gpt-5.3-codex" }],
      [{ name: "repo-skill", description: "Project specific knowledge", location: "project" }],
    )

    expect(PLAN_AGENT_NAMES).toContain("plan")
    expect(PLAN_FAMILY_NAMES).toContain("plan")
    expect(out).toContain("MANDATORY CONTEXT GATHERING PROTOCOL")
    expect(out).toContain("TODO List (ADD THESE)")
    expect(isPlanAgent("Plan Agent")).toBe(true)
    expect(isPlanAgent("builder")).toBe(false)
    expect(isPlanFamily("plan")).toBe(true)
    expect(isPlanFamily("secondary-plan-worker")).toBe(true)
    expect(isPlanFamily(undefined)).toBe(false)
  })
})
