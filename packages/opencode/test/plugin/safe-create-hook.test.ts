import { describe, test, expect, spyOn, afterEach } from "bun:test"
import * as shared from "../../src/util/logger"
import { safeCreateHook } from "../../src/plugin/safe-create-hook"

afterEach(() => {
  ;(shared.log as any)?.mockRestore?.()
})

describe("safeCreateHook", () => {
  test("returns hook object when factory succeeds", () => {
    const hook = { handler: () => {} }
    const factory = () => hook

    const result = safeCreateHook("test-hook", factory)

    expect(result).toBe(hook)
  })

  test("returns null when factory throws", () => {
    spyOn(shared, "log").mockImplementation(() => {})
    const factory = () => {
      throw new Error("boom")
    }

    const result = safeCreateHook("test-hook", factory)

    expect(result).toBeNull()
  })

  test("logs error when factory throws", () => {
    const logSpy = spyOn(shared, "log").mockImplementation(() => {})
    const factory = () => {
      throw new Error("boom")
    }

    safeCreateHook("my-hook", factory)

    expect(logSpy).toHaveBeenCalled()
    const callArgs = logSpy.mock.calls[0]
    expect(callArgs[0]).toContain("my-hook")
    expect(callArgs[0]).toContain("Hook creation failed")
  })

  test("propagates error when enabled is false", () => {
    const factory = () => {
      throw new Error("boom")
    }

    expect(() => safeCreateHook("test-hook", factory, { enabled: false })).toThrow("boom")
  })

  test("returns null for factory returning undefined", () => {
    const factory = () => undefined as any

    const result = safeCreateHook("test-hook", factory)

    expect(result).toBeNull()
  })
})
