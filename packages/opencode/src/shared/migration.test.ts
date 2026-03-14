import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import {
  AGENT_NAME_MAP,
  HOOK_NAME_MAP,
  migrateAgentNames,
  migrateConfigFile,
  migrateHookNames,
} from "./migration"

describe("migrateAgentNames", () => {
  test("normalizes current legacy aliases", () => {
    const agents = {
      omo: { model: "test" },
      Sisyphus: { prompt: "override" },
      explore: { mode: "subagent" },
      "Sisyphus-Junior": { steps: 10 },
    }

    const { migrated, changed } = migrateAgentNames(agents)

    expect(changed).toBe(true)
    expect(migrated.sisyphus).toEqual({ prompt: "override" })
    expect(migrated["manon-explorer"]).toEqual({ mode: "subagent" })
    expect(migrated["sisyphus-junior"]).toEqual({ steps: 10 })
  })

  test("keeps already normalized keys unchanged", () => {
    const agents = {
      sisyphus: { model: "test" },
      librarian: { model: "test" },
      "manon-explorer": { model: "test" },
      build: { model: "test" },
    }

    const { migrated, changed } = migrateAgentNames(agents)

    expect(changed).toBe(false)
    expect(migrated).toEqual(agents)
  })
})

describe("migrateHookNames", () => {
  test("migrates renamed hooks and drops removed hooks", () => {
    const hooks = [
      "anthropic-auto-compact",
      "sisyphus-gpt-hephaestus-reminder",
      "empty-message-sanitizer",
      "comment-checker",
    ]

    const result = migrateHookNames(hooks)

    expect(result.changed).toBe(true)
    expect(result.migrated).toEqual([
      "anthropic-context-window-limit-recovery",
      "no-sisyphus-gpt",
      "comment-checker",
    ])
    expect(result.removed).toEqual(["empty-message-sanitizer"])
  })
})

describe("migration maps", () => {
  test("expose the current legacy mappings", () => {
    expect(AGENT_NAME_MAP.explore).toBe("manon-explorer")
    expect(AGENT_NAME_MAP.omo).toBe("sisyphus")
    expect(HOOK_NAME_MAP["anthropic-auto-compact"]).toBe("anthropic-context-window-limit-recovery")
    expect(HOOK_NAME_MAP["empty-message-sanitizer"]).toBeNull()
  })
})

describe("migrateConfigFile", () => {
  const tmp = path.join(process.cwd(), "migration-test.json")

  afterEach(() => {
    try {
      fs.unlinkSync(tmp)
    } catch {}
  })

  test("updates config objects in memory using current migrations", () => {
    fs.writeFileSync(tmp, "{}\n", "utf8")
    const raw = {
      agents: {
        Sisyphus: { model: "test" },
        explore: { prompt: "search" },
      },
      disabled_hooks: ["anthropic-auto-compact", "empty-message-sanitizer"],
    }

    const changed = migrateConfigFile(tmp, raw)

    expect(changed).toBe(true)
    expect(raw.agents).toEqual({
      sisyphus: { model: "test" },
      "manon-explorer": { prompt: "search" },
    })
    expect(raw.disabled_hooks).toEqual(["anthropic-context-window-limit-recovery"])
  })
})
