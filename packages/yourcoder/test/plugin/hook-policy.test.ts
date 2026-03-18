import { describe, expect, test } from "bun:test"
import { createHookPolicy, optionalHooks } from "../../src/plugin/hook-policy"

describe("createHookPolicy", () => {
  test("keeps core hooks enabled by default", () => {
    const enabled = createHookPolicy({})

    expect(enabled("session-recovery")).toBe(true)
    expect(enabled("runtime-fallback")).toBe(true)
  })

  test("turns optional hooks off unless explicitly enabled", () => {
    const enabled = createHookPolicy({})

    expect(enabled("auto-update-checker")).toBe(false)
    expect(enabled("session-notification")).toBe(false)
  })

  test("allows opting optional hooks back in", () => {
    const enabled = createHookPolicy({
      enabled_hooks: ["auto-update-checker", "session-notification"],
    })

    expect(enabled("auto-update-checker")).toBe(true)
    expect(enabled("session-notification")).toBe(true)
  })

  test("disabled hooks still win over enabled hooks", () => {
    const enabled = createHookPolicy({
      enabled_hooks: ["auto-update-checker"],
      disabled_hooks: ["auto-update-checker"],
    })

    expect(enabled("auto-update-checker")).toBe(false)
  })
})

describe("optionalHooks", () => {
  test("lists patch hooks handled as opt-in", () => {
    expect(optionalHooks()).toContain("auto-update-checker")
    expect(optionalHooks()).toContain("session-notification")
  })
})
