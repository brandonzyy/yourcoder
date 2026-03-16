import { describe, expect, it } from "bun:test"
import {
  restoreLeadingIndent,
  stripInsertAnchorEcho,
  stripInsertBeforeEcho,
  stripInsertBoundaryEcho,
  stripLinePrefixes,
  stripRangeBoundaryEcho,
  toNewLines,
} from "./edit-text-normalization"

describe("edit text normalization", () => {
  it("strips copied hashline and diff prefixes when they dominate the payload", () => {
    expect(stripLinePrefixes(["1#VK|alpha", "2#NP|beta"])).toEqual(["alpha", "beta"])
    expect(stripLinePrefixes(["+alpha", "+beta"])).toEqual(["alpha", "beta"])
    expect(toNewLines("1#VK|alpha\n2#NP|beta")).toEqual(["alpha", "beta"])
  })

  it("restores indentation only when the replacement is otherwise unindented", () => {
    expect(restoreLeadingIndent("  return 1", "return 2")).toBe("  return 2")
    expect(restoreLeadingIndent("  return 1", "    return 2")).toBe("    return 2")
    expect(restoreLeadingIndent("  return 1", "return 1")).toBe("return 1")
  })

  it("removes echoed anchor lines around inserts", () => {
    expect(stripInsertAnchorEcho("line 1", ["line 1", "next"])).toEqual(["next"])
    expect(stripInsertBeforeEcho("line 2", ["prev", "line 2"])).toEqual(["prev"])
    expect(stripInsertBoundaryEcho("after", "before", ["after", "mid", "before"])).toEqual(["mid"])
  })

  it("removes surrounding range boundary echoes without touching the real payload", () => {
    const out = stripRangeBoundaryEcho(
      ["top", "old 1", "old 2", "bottom"],
      2,
      3,
      ["top", "new 1", "new 2", "bottom"],
    )
    expect(out).toEqual(["new 1", "new 2"])
  })
})
