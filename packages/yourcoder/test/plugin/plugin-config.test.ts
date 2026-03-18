import { describe, expect, test } from "bun:test"
import { mergeConfigs } from "../../src/plugin/plugin-config"

describe("mergeConfigs", () => {
  test("merges enabled hooks without duplicates", () => {
    const res = mergeConfigs(
      {
        enabled_hooks: ["auto-update-checker", "session-notification"],
      },
      {
        enabled_hooks: ["session-notification", "start-work"],
      },
    )

    expect(res.enabled_hooks).toEqual([
      "auto-update-checker",
      "session-notification",
      "start-work",
    ])
  })
})
