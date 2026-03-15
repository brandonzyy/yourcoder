import { describe, expect, it } from "bun:test"
import {
  extractSessionNameFromTokens,
  findFlagValue,
  findSubcommand,
  normalizeSessionName,
  tokenizeCommand,
} from "./parser"

describe("interactive bash session parser", () => {
  it("tokenizes quoted and escaped command arguments", () => {
    expect(tokenizeCommand(`tmux new-session -s "my name" -c foo\\ bar`)).toEqual([
      "tmux",
      "new-session",
      "-s",
      "my name",
      "-c",
      "foo bar",
    ])
  })

  it("normalizes session names and finds flag values", () => {
    expect(normalizeSessionName("omo-x:1.2")).toBe("omo-x")
    expect(findFlagValue(["tmux", "-L", "sock", "new-session", "-s", "demo"], "-s")).toBe("demo")
    expect(findFlagValue(["tmux", "attach-session"], "-t")).toBe(null)
  })

  it("extracts the correct session name for new and existing sessions", () => {
    expect(extractSessionNameFromTokens(["tmux", "new-session", "-s", "demo:1"], "new-session")).toBe("demo")
    expect(extractSessionNameFromTokens(["tmux", "attach-session", "-t", "demo.3"], "attach-session")).toBe("demo")
    expect(extractSessionNameFromTokens(["tmux", "new-session"], "new-session")).toBe(null)
  })

  it("skips global tmux options to find the real subcommand", () => {
    expect(findSubcommand(["tmux", "-L", "sock", "-C", "new-session", "-s", "demo"])).toBe("tmux")
    expect(findSubcommand(["-L", "sock", "-C", "new-session", "-s", "demo"])).toBe("new-session")
    expect(findSubcommand(["-L", "sock", "--", "split-window"])).toBe("split-window")
  })
})
