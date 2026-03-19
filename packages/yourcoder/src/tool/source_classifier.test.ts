import { describe, expect, it } from "bun:test"
import { SourceClassifierTool } from "./source_classifier"

function ctx() {
  return {
    sessionID: "ses_test",
    messageID: "msg_test",
    agent: "test-agent",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => {},
    ask: async () => {},
  } as never
}

describe("source_classifier", () => {
  it("classifies official docs as high trust primary static", async () => {
    const tool = await SourceClassifierTool.init()
    const res = await tool.execute(
      {
        sources: [
          {
            url: "https://docs.python.org/3/library/asyncio.html",
            title: "asyncio — Asynchronous I/O",
            snippet: "Official Python documentation for asyncio.",
            publishedDate: new Date().toISOString(),
          },
        ],
      },
      ctx(),
    )

    const c = (res.metadata as any).classified[0]
    expect(c.officiality).toBe("official")
    expect(c.contentType).toBe("docs")
    expect(c.origin).toBe("primary")
    expect(c.discussionMode).toBe("static")
    expect(c.trust).toBe("high")
  })

  it("classifies forum discussion as dynamic secondary lower trust", async () => {
    const tool = await SourceClassifierTool.init()
    const res = await tool.execute(
      {
        sources: [
          {
            url: "https://www.reddit.com/r/typescript/comments/abc123/help_with_generics/",
            title: "Help with TypeScript generics",
            snippet: "Discussion thread with replies and comments.",
            publishedDate: "2021-05-01",
          },
        ],
      },
      ctx(),
    )

    const c = (res.metadata as any).classified[0]
    expect(c.contentType).toBe("forum")
    expect(c.discussionMode).toBe("dynamic")
    expect(c.origin).toBe("secondary")
    expect(["low", "medium"]).toContain(c.trust)
  })

  it("detects issue pages and does not overrate them", async () => {
    const tool = await SourceClassifierTool.init()
    const res = await tool.execute(
      {
        sources: [
          {
            url: "https://github.com/facebook/react/issues/12345",
            title: "Bug: state update regression",
            snippet: "Issue discussion with maintainers and users.",
            publishedDate: "2022-01-10",
          },
        ],
      },
      ctx(),
    )

    const c = (res.metadata as any).classified[0]
    expect(c.contentType).toBe("issue")
    expect(c.discussionMode).toBe("dynamic")
    expect(c.reasons).toContain("issue-thread")
    expect(c.score).toBeLessThan(80)
  })

  it("returns summary counts aligned with classified items", async () => {
    const tool = await SourceClassifierTool.init()
    const res = await tool.execute(
      {
        sources: [
          { url: "https://docs.go.dev/ref/spec", title: "Go Spec" },
          { url: "https://dev.to/x/post", title: "Blog post" },
          { url: "https://news.ycombinator.com/item?id=1", title: "Discussion" },
        ],
      },
      ctx(),
    )

    const meta = res.metadata as any
    const classified = meta.classified as Array<any>
    const summary = meta.summary

    expect(summary.highTrust + summary.mediumTrust + summary.lowTrust).toBe(classified.length)
    expect(summary.official).toBe(classified.filter((c) => c.officiality === "official").length)
    expect(summary.primary).toBe(classified.filter((c) => c.origin === "primary").length)
  })
})
