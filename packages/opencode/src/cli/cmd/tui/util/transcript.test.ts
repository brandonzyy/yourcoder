import { describe, expect, it } from "bun:test"
import {
  formatAssistantHeader,
  formatMessage,
  formatPart,
  formatTranscript,
} from "./transcript"

const opts = {
  thinking: true,
  toolDetails: true,
  assistantMetadata: true,
}

describe("transcript formatting", () => {
  it("formats assistant headers with metadata and duration", () => {
    const out = formatAssistantHeader({
      role: "assistant",
      agent: "sisyphus",
      modelID: "openai/gpt-5.4",
      time: { created: 1000, completed: 2500 },
    } as Parameters<typeof formatAssistantHeader>[0], true)
    expect(out).toContain("Assistant")
    expect(out).toContain("Sisyphus")
    expect(out).toContain("openai/gpt-5.4")
    expect(out).toContain("1.5s")
  })

  it("formats text, reasoning, and tool parts based on options", () => {
    const text = formatPart({ type: "text", text: "hello" } as Parameters<typeof formatPart>[0], opts)
    const thinking = formatPart({ type: "reasoning", text: "chain" } as Parameters<typeof formatPart>[0], opts)
    const tool = formatPart({
      type: "tool",
      tool: "read_file",
      state: {
        input: { path: "a.ts" },
        status: "completed",
        output: "done",
      },
    } as Parameters<typeof formatPart>[0], opts)

    expect(text).toContain("hello")
    expect(thinking).toContain("_Thinking:_")
    expect(tool).toContain("Tool: read_file")
    expect(tool).toContain("\"path\": \"a.ts\"")
    expect(tool).toContain("done")
  })

  it("formats complete messages and transcripts", () => {
    const msg = formatMessage(
      {
        role: "assistant",
        agent: "sisyphus",
        modelID: "openai/gpt-5.4",
        time: { created: 1000, completed: 2500 },
      } as Parameters<typeof formatMessage>[0],
      [
        { type: "text", text: "answer" },
        { type: "reasoning", text: "reason" },
      ] as Parameters<typeof formatMessage>[1],
      opts,
    )

    const out = formatTranscript(
      {
        id: "s1",
        title: "Demo",
        time: { created: 1000, updated: 2000 },
      },
      [
        {
          info: {
            role: "user",
            time: { created: 1000, completed: 1000 },
          } as Parameters<typeof formatMessage>[0],
          parts: [{ type: "text", text: "question" }] as Parameters<typeof formatMessage>[1],
        },
        {
          info: {
            role: "assistant",
            agent: "sisyphus",
            modelID: "openai/gpt-5.4",
            time: { created: 1000, completed: 2500 },
          } as Parameters<typeof formatMessage>[0],
          parts: [{ type: "text", text: "answer" }] as Parameters<typeof formatMessage>[1],
        },
      ],
      opts,
    )

    expect(msg).toContain("## Assistant")
    expect(msg).toContain("answer")
    expect(out).toContain("# Demo")
    expect(out).toContain("Session ID:** s1")
    expect(out).toContain("## User")
    expect(out).toContain("question")
    expect(out).toContain("answer")
  })
})
