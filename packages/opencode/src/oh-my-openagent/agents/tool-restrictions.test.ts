import { describe, test, expect } from "bun:test"
import { createOracleAgent } from "./oracle"
import { createLibrarianAgent } from "./librarian"
import { createExploreAgent } from "./explore"
import { createMomusAgent } from "./momus"
import { createMetisAgent } from "./metis"
import { createAtlasAgent } from "./atlas"

const TEST_MODEL = "anthropic/claude-sonnet-4-5"

describe("read-only agent tool restrictions", () => {
  const FILE_WRITE_TOOLS = ["write", "edit", "apply_patch"]

  describe("Oracle", () => {
    test("excludes edit tag via capabilities", () => {
      const agent = createOracleAgent(TEST_MODEL)
      expect(agent.capabilities?.exclude).toContain("edit")
    })

    test("includes only read-only tools", () => {
      const agent = createOracleAgent(TEST_MODEL)
      expect(agent.capabilities?.include).toEqual(["core", "search", "lsp", "ast"])
    })
  })

  describe("Librarian", () => {
    test("excludes edit tag via capabilities", () => {
      const agent = createLibrarianAgent(TEST_MODEL)
      expect(agent.capabilities?.exclude).toContain("edit")
    })
  })

  describe("Explore", () => {
    test("excludes edit tag via capabilities", () => {
      const agent = createExploreAgent(TEST_MODEL)
      expect(agent.capabilities?.exclude).toContain("edit")
    })
  })

  describe("Momus", () => {
    test("excludes edit tag via capabilities", () => {
      const agent = createMomusAgent(TEST_MODEL)
      expect(agent.capabilities?.exclude).toContain("edit")
    })
  })

  describe("Metis", () => {
    test("excludes edit tag via capabilities", () => {
      const agent = createMetisAgent(TEST_MODEL)
      expect(agent.capabilities?.exclude).toContain("edit")
    })
  })

  describe("Atlas", () => {
    test("allows delegation tools for orchestration", () => {
      const agent = createAtlasAgent({ model: TEST_MODEL })
      expect(agent.capabilities?.include).toContain("delegation")
    })
  })
})
