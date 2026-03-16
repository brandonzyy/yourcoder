import { describe, expect, test } from "bun:test"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type FallbackEntry,
  type ModelRequirement,
} from "./model-requirements"

describe("AGENT_MODEL_REQUIREMENTS", () => {
  test("matches the current builtin agent set", () => {
    expect(Object.keys(AGENT_MODEL_REQUIREMENTS).sort()).toEqual([
      "codersearch",
      "codereye",
      "yc",
    ])
  })

  test("yac prefers opus then kimi", () => {
    const req = AGENT_MODEL_REQUIREMENTS.yac
    expect(req.fallbackChain).toEqual([
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["opencode"], model: "kimi-k2.5" },
    ])
  })

  test("codersearch and codereye share the lightweight search chain", () => {
    expect(AGENT_MODEL_REQUIREMENTS.codersearch.fallbackChain).toEqual([
      { providers: ["opencode"], model: "claude-haiku-4-5" },
      { providers: ["opencode"], model: "glm-4.7-fp8" },
    ])
    expect(AGENT_MODEL_REQUIREMENTS["codereye"].fallbackChain).toEqual(
      AGENT_MODEL_REQUIREMENTS.codersearch.fallbackChain,
    )
  })
})

describe("CATEGORY_MODEL_REQUIREMENTS", () => {
  test("matches the current category set", () => {
    expect(Object.keys(CATEGORY_MODEL_REQUIREMENTS).sort()).toEqual([
      "artistry",
      "deep",
      "quick",
      "ultrabrain",
      "unspecified-high",
      "unspecified-low",
      "visual-engineering",
      "writing",
    ])
  })

  test("keeps visual and artistry categories on opus-first chains", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["visual-engineering"].fallbackChain[0]).toEqual({
      providers: ["opencode"],
      model: "claude-opus-4-6",
      variant: "max",
    })
    expect(CATEGORY_MODEL_REQUIREMENTS.artistry.fallbackChain[0]).toEqual({
      providers: ["opencode"],
      model: "claude-opus-4-6",
      variant: "max",
    })
  })

  test("uses lighter chains for quick, writing, and unspecified-low", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS.quick.fallbackChain[0]).toEqual({
      providers: ["opencode"],
      model: "claude-haiku-4-5",
    })
    expect(CATEGORY_MODEL_REQUIREMENTS.writing.fallbackChain[0]).toEqual({
      providers: ["opencode"],
      model: "claude-sonnet-4-6",
    })
    expect(CATEGORY_MODEL_REQUIREMENTS["unspecified-low"].fallbackChain[0]).toEqual({
      providers: ["opencode"],
      model: "claude-sonnet-4-6",
    })
  })

  test("uses current deep and ultrabrain ordering", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS.deep.fallbackChain).toEqual([
      { providers: ["opencode"], model: "kimi-k2.5" },
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
    ])
    expect(CATEGORY_MODEL_REQUIREMENTS.ultrabrain.fallbackChain).toEqual([
      { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
      { providers: ["opencode"], model: "kimi-k2.5" },
    ])
  })
})

describe("Requirement Shapes", () => {
  test("FallbackEntry allows optional variant", () => {
    const entry: FallbackEntry = {
      providers: ["opencode"],
      model: "claude-opus-4-6",
    }
    expect(entry.variant).toBeUndefined()
  })

  test("ModelRequirement stores fallback chains", () => {
    const req: ModelRequirement = {
      fallbackChain: [
        { providers: ["opencode"], model: "claude-opus-4-6", variant: "max" },
        { providers: ["opencode"], model: "kimi-k2.5" },
      ],
    }
    expect(req.fallbackChain).toHaveLength(2)
  })

  test("all models omit provider prefixes and all provider lists are non-empty", () => {
    const all = [...Object.values(AGENT_MODEL_REQUIREMENTS), ...Object.values(CATEGORY_MODEL_REQUIREMENTS)]
    for (const req of all) {
      for (const entry of req.fallbackChain) {
        expect(entry.model).not.toContain("/")
        expect(entry.providers.length).toBeGreaterThan(0)
      }
    }
  })
})
