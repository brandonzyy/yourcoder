import { describe, test, expect } from "bun:test"
import { createLibrarianAgent } from "./librarian"
import { createManonExplorerAgent } from "./manon-explorer"

const TEST_MODEL = "anthropic/claude-sonnet-4-5"

describe("read-only agent tool restrictions", () => {
  describe("Librarian", () => {
    test("excludes edit tag via capabilities", () => {
      const agent = createLibrarianAgent(TEST_MODEL)
      expect(agent.capabilities?.exclude).toContain("edit")
    })
  })

  describe("Manon-Explorer", () => {
    test("excludes edit tag via capabilities", () => {
      const agent = createManonExplorerAgent(TEST_MODEL)
      expect(agent.capabilities?.exclude).toContain("edit")
    })

    test("includes mcp tag for Manon MCP tools", () => {
      const agent = createManonExplorerAgent(TEST_MODEL)
      expect(agent.capabilities?.include).toContain("mcp")
    })
  })
})
