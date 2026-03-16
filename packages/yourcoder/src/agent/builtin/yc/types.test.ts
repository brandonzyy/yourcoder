import { describe, expect, it } from "bun:test"
import {
  isGeminiModel,
  isGpt5_3CodexModel,
  isGpt5_4Model,
  isGptModel,
} from "../../plugin-agent-types"

describe("builtin yac model helpers", () => {
  it("detects GPT model families from full ids and bare model names", () => {
    expect(isGptModel("openai/gpt-5.4")).toBe(true)
    expect(isGptModel("gpt-4o-mini")).toBe(true)
    expect(isGptModel("google/gemini-2.5-pro")).toBe(false)
  })

  it("detects GPT 5.4 variants", () => {
    expect(isGpt5_4Model("openai/gpt-5.4")).toBe(true)
    expect(isGpt5_4Model("openai/gpt-5-4-high")).toBe(true)
    expect(isGpt5_4Model("openai/gpt-5.3-codex")).toBe(false)
  })

  it("detects GPT 5.3 codex variants", () => {
    expect(isGpt5_3CodexModel("openai/gpt-5.3-codex")).toBe(true)
    expect(isGpt5_3CodexModel("gpt-5-3-codex-fast")).toBe(true)
    expect(isGpt5_3CodexModel("gpt-5.4")).toBe(false)
  })

  it("detects Gemini providers and names", () => {
    expect(isGeminiModel("google/gemini-2.5-pro")).toBe(true)
    expect(isGeminiModel("google-vertex/gemini-2.5-flash")).toBe(true)
    expect(isGeminiModel("github-copilot/gemini-2.0-flash")).toBe(true)
    expect(isGeminiModel("openai/gpt-5.4")).toBe(false)
  })
})
