import { describe, expect, test } from "bun:test"
import { AGENT_MODEL_REQUIREMENTS } from "../../src/model/model-requirements"
import { getAgentDisplayName } from "../../src/util/agent-display-names"

describe("Agent Config Integration", () => {
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
