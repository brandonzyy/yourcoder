import { describe, expect, it } from "bun:test"
import { AGENT_DISPLAY_NAMES, getAgentConfigKey, getAgentDisplayName } from "./agent-display-names"

describe("getAgentDisplayName", () => {
  it("returns current builtin display names", () => {
    expect(getAgentDisplayName("yc")).toBe("Yc")
    expect(getAgentDisplayName("coderhand")).toBe("CoderHand")
    expect(getAgentDisplayName("codersearch")).toBe("codersearch")
    expect(getAgentDisplayName("codereye")).toBe("codereye")
  })

  it("resolves config keys case-insensitively", () => {
    expect(getAgentDisplayName("Yc")).toBe("Yc")
    expect(getAgentDisplayName("LIBRARIAN")).toBe("codersearch")
  })

  it("passes unknown names through unchanged", () => {
    expect(getAgentDisplayName("custom-agent")).toBe("custom-agent")
  })
})

describe("getAgentConfigKey", () => {
  it("maps display names back to config keys", () => {
    expect(getAgentConfigKey("Yc")).toBe("yc")
    expect(getAgentConfigKey("CoderHand")).toBe("coderhand")
  })

  it("passes through known config keys and lowercases unknown names", () => {
    expect(getAgentConfigKey("codereye")).toBe("codereye")
    expect(getAgentConfigKey("Custom-Agent")).toBe("custom-agent")
  })
})

describe("AGENT_DISPLAY_NAMES", () => {
  it("matches the current builtin mapping", () => {
    expect(AGENT_DISPLAY_NAMES).toEqual({
      yac: "Yc",
      "coderhand": "CoderHand",
      codersearch: "codersearch",
      "codereye": "codereye",
    })
  })
})
