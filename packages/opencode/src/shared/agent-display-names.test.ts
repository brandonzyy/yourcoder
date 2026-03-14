import { describe, expect, it } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentConfigKey, getAgentDisplayName } from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns current builtin display names", () => {
    expect(getAgentDisplayName("sisyphus")).toBe("Sisyphus (Ultraworker)")
    expect(getAgentDisplayName("sisyphus-junior")).toBe("Sisyphus-Junior")
    expect(getAgentDisplayName("librarian")).toBe("librarian")
    expect(getAgentDisplayName("manon-explorer")).toBe("manon-explorer")
  })

  it("resolves config keys case-insensitively", () => {
    expect(getAgentDisplayName("Sisyphus")).toBe("Sisyphus (Ultraworker)")
    expect(getAgentDisplayName("LIBRARIAN")).toBe("librarian")
  })

  it("passes unknown names through unchanged", () => {
    expect(getAgentDisplayName("custom-agent")).toBe("custom-agent")
  })
})

describe("getAgentConfigKey", () => {
  it("maps display names back to config keys", () => {
    expect(getAgentConfigKey("Sisyphus (Ultraworker)")).toBe("sisyphus")
    expect(getAgentConfigKey("Sisyphus-Junior")).toBe("sisyphus-junior")
  })

  it("passes through known config keys and lowercases unknown names", () => {
    expect(getAgentConfigKey("manon-explorer")).toBe("manon-explorer")
    expect(getAgentConfigKey("Custom-Agent")).toBe("custom-agent")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("matches the current builtin mapping", () => {
    expect(AGENT_DISPLAY_NAMES).toEqual({
      sisyphus: "Sisyphus (Ultraworker)",
      "sisyphus-junior": "Sisyphus-Junior",
      librarian: "librarian",
      "manon-explorer": "manon-explorer",
    })
  })
})
