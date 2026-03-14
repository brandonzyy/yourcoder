import { describe, expect, test } from "bun:test"
import { AGENT_MODEL_REQUIREMENTS } from "../model/model-requirements"
import { getAgentDisplayName } from "./agent-display-names"
import { migrateAgentNames } from "./migration"

describe("Agent Config Integration", () => {
  test("migrates legacy sisyphus aliases into current keys", () => {
    const input = {
      Sisyphus: { model: "opencode/claude-opus-4-6" },
      omo: { model: "opencode/kimi-k2.5" },
      explore: { prompt: "search" },
    }

    const result = migrateAgentNames(input)

    expect(result.changed).toBe(true)
    expect(result.migrated.sisyphus).toEqual({ model: "opencode/kimi-k2.5" })
    expect(result.migrated["manon-explorer"]).toEqual({ prompt: "search" })
  })

  test("preserves current lowercase keys", () => {
    const input = {
      sisyphus: { model: "opencode/claude-opus-4-6" },
      librarian: { model: "opencode/claude-haiku-4-5" },
    }

    const result = migrateAgentNames(input)

    expect(result.changed).toBe(false)
    expect(result.migrated).toEqual(input)
  })

  test("display names reflect current builtin agents", () => {
    expect(getAgentDisplayName("sisyphus")).toBe("Sisyphus (Ultraworker)")
    expect(getAgentDisplayName("librarian")).toBe("librarian")
    expect(getAgentDisplayName("manon-explorer")).toBe("manon-explorer")
  })

  test("model requirements use lowercase builtin keys", () => {
    const keys = Object.keys(AGENT_MODEL_REQUIREMENTS)
    expect(keys.every((key) => key === key.toLowerCase())).toBe(true)
    expect(keys.sort()).toEqual(["librarian", "manon-explorer", "sisyphus"])
  })
})
