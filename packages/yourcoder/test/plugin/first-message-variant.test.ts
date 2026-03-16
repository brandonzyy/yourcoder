import { describe, expect, test } from "bun:test"
import { createFirstMessageVariantGate } from "../../src/plugin/first-message-variant"

describe("createFirstMessageVariantGate", () => {
  test("marks new sessions and clears after apply", () => {
    const gate = createFirstMessageVariantGate()

    gate.markSessionCreated({ id: "session-1" })

    expect(gate.shouldOverride("session-1")).toBe(true)

    gate.markApplied("session-1")

    expect(gate.shouldOverride("session-1")).toBe(false)
  })

  test("ignores forked sessions", () => {
    const gate = createFirstMessageVariantGate()

    gate.markSessionCreated({ id: "session-2", parentID: "session-parent" })

    expect(gate.shouldOverride("session-2")).toBe(false)
  })
})
