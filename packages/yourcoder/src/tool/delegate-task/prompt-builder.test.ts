import { describe, expect, it } from "bun:test"
import {
  buildSystemContent,
  buildTaskPrompt,
} from "./prompt-builder"

describe("delegate task prompt builder", () => {
  it("joins agents context, skill content, and category prompt append", () => {
    const out = buildSystemContent({
      agentsContext: "agents",
      skillContents: ["skill one", "skill two"],
      categoryPromptAppend: "category",
    })

    expect(out).toBe("agents\n\nskill one\n\nskill two\n\ncategory")
  })

  it("injects the plan-agent prepend for plan agents", () => {
    const out = buildSystemContent({
      agentName: "plan",
      availableCategories: [{ name: "deep", description: "Deep work", model: "openai/gpt-5.3-codex" }],
      availableSkills: [{ name: "repo-skill", description: "Project specific knowledge", location: "project" }],
      skillContent: "skill body",
      categoryPromptAppend: "category body",
    })

    expect(out).toBeDefined()
    expect(out).toContain("MANDATORY CONTEXT GATHERING PROTOCOL")
    expect(out).toContain("skill body")
    expect(out).toContain("category body")
  })

  it("truncates oversized content when a local model uses a small token budget", () => {
    const long = "x".repeat(1000)
    const out = buildSystemContent({
      agentName: "plan",
      availableCategories: [{ name: "deep", description: "Deep work", model: "openai/gpt-5.3-codex" }],
      availableSkills: [{ name: "repo-skill", description: "Project specific knowledge", location: "project" }],
      skillContent: long,
      categoryPromptAppend: long,
      model: { providerID: "local", modelID: "my-model" },
      maxPromptTokens: 10,
    })

    expect(out).toBeDefined()
    expect(out).toContain("[TRUNCATED]")
  })

  it("only appends planning requirements for plan agents", () => {
    expect(buildTaskPrompt("Solve it", "plan")).toContain("Additional requirements for this planning request")
    expect(buildTaskPrompt("Solve it", "builder")).toBe("Solve it")
  })
})
