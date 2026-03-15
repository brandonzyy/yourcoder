import { describe, expect, it } from "bun:test"
import { replace, trimDiff } from "./edit"

describe("edit replace helpers", () => {
  it("replaces exact matches and all matches when requested", () => {
    expect(replace("alpha beta", "beta", "gamma")).toBe("alpha gamma")
    expect(replace("a a a", "a", "b", true)).toBe("b b b")
  })

  it("matches with trimmed lines and normalized escapes", () => {
    expect(
      replace("if (x) {\n  return 1\n}\n", "if (x) {\nreturn 1\n}", "if (x) {\n  return 2\n}\n"),
    ).toContain("return 2")

    expect(
      replace("const msg = `hello\nworld`", "const msg = `hello\\nworld`", "const msg = `ok`"),
    ).toBe("const msg = `ok`")
  })

  it("uses boundary and context fallbacks for multiline replacements", () => {
    const out = replace(
      "before\nold 1\nold 2\nafter",
      "before\nold 1\nold 2\nafter",
      "before\nnew 1\nnew 2\nafter",
    )

    expect(out).toBe("before\nnew 1\nnew 2\nafter")
  })

  it("throws when the replacement is ambiguous or unchanged", () => {
    expect(() => replace("dup dup", "dup", "next")).toThrow(/multiple matches/i)
    expect(() => replace("same", "same", "same")).toThrow(/No changes to apply/i)
  })

  it("trims shared indentation from diff hunks", () => {
    const out = trimDiff([
      "--- a.ts",
      "+++ a.ts",
      "@@",
      "-    old",
      "+    new",
      "     same",
    ].join("\n"))

    expect(out).toContain("-old")
    expect(out).toContain("+new")
    expect(out).toContain(" same")
  })
})
