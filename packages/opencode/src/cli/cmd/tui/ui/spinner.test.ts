import { describe, expect, it } from "bun:test"
import { RGBA } from "@opentui/core"
import {
  createColors,
  createFrames,
  deriveInactiveColor,
  deriveTrailColors,
} from "./spinner"

describe("spinner helpers", () => {
  it("derives a fading trail from a single bright color", () => {
    const out = deriveTrailColors("#ff0000", 4)
    expect(out).toHaveLength(4)
    expect(out[0]).toBeInstanceOf(RGBA)
    expect(out[0].a).toBe(1)
    expect(out[1].a).toBeLessThanOrEqual(1)
    expect(out[3].a).toBeLessThan(out[2].a)
  })

  it("derives an inactive color by lowering alpha only", () => {
    const out = deriveInactiveColor("#00ff00", 0.25)
    expect(out.g).toBeGreaterThan(0)
    expect(out.r).toBe(0)
    expect(out.a).toBe(0.25)
  })

  it("creates the expected number of animation frames for a bidirectional scanner", () => {
    const out = createFrames({ width: 5, holdStart: 2, holdEnd: 1 })
    expect(out).toHaveLength(5 + 1 + 4 + 2)
    expect(out.every((item) => item.length === 5)).toBe(true)
  })

  it("creates a color generator that brightens the active position", () => {
    const gen = createColors({ width: 4, color: "#ff0000", holdStart: 0, holdEnd: 0 })
    const lead = gen(0, 0, 7, 4)
    const tail = gen(0, 3, 7, 4)
    expect(lead).toBeInstanceOf(RGBA)
    expect(tail).toBeInstanceOf(RGBA)
    expect(lead.a).toBeGreaterThan(tail.a)
  })
})
