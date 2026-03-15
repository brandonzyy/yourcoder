import { describe, expect, test } from "bun:test"
import { parseConfigPartially } from "../../src/plugin/plugin-config"

describe("parseConfigPartially", () => {
  test("keeps valid hook lists and drops invalid ones", () => {
    const cfg = parseConfigPartially({
      disabled_hooks: ["session-recovery", "runtime-fallback"],
      enabled_hooks: ["auto-update-checker"],
      bad_section: { nope: true },
    })

    expect(cfg).toEqual({
      disabled_hooks: ["session-recovery", "runtime-fallback"],
      enabled_hooks: ["auto-update-checker"],
    })
  })

  test("drops disabled_hooks when unknown hook names remain after parsing", () => {
    const cfg = parseConfigPartially({
      disabled_hooks: ["unknown-hook", "session-recovery"],
      enabled_hooks: ["auto-update-checker"],
    })

    expect(cfg).toEqual({
      enabled_hooks: ["auto-update-checker"],
    })
  })

  test("does not translate legacy hook names anymore", () => {
    const cfg = parseConfigPartially({
      disabled_hooks: ["anthropic-auto-compact"],
      enabled_hooks: ["sisyphus-gpt-hephaestus-reminder"],
    })

    expect(cfg).toEqual({})
  })

  test("does not accept legacy agent keys anymore", () => {
    const cfg = parseConfigPartially({
      agents: {
        explore: { prompt: "search" },
      },
    })

    expect(cfg).toEqual({
      agents: {},
    })
  })

  test("does not auto-upgrade legacy model versions anymore", () => {
    const cfg = parseConfigPartially({
      agents: {
        sisyphus: { model: "anthropic/claude-opus-4-5" },
      },
    })

    expect(cfg).toEqual({
      agents: {
        sisyphus: { model: "anthropic/claude-opus-4-5" },
      },
    })
  })
})
