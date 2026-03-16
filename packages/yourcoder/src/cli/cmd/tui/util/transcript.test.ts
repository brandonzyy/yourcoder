import { describe, expect, it } from "bun:test"
import type { AssistantMessage, Part, UserMessage } from "@yourcoder/sdk/v2"
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

function assistant(
  info: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    id: "msg_assistant",
    sessionID: "ses_1",
    parentID: "msg_user",
    role: "assistant",
    agent: "yc",
    mode: "primary",
    providerID: "openai",
    modelID: "openai/gpt-5.4",
    path: { cwd: "/tmp/project", root: "/tmp/project" },
    time: { created: 1000, completed: 2500 },
    cost: 0,
    tokens: {
      input: 1,
      output: 1,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    ...info,
  }
}

function user(
  info: Partial<UserMessage> = {},
): UserMessage {
  return {
    id: "msg_user",
    sessionID: "ses_1",
    role: "user",
    agent: "yc",
    model: { providerID: "openai", modelID: "gpt-5.4" },
    time: { created: 1000 },
    ...info,
  }
}

function text(text: string): Part {
  return {
    id: `part_text_${text}`,
    sessionID: "ses_1",
    messageID: "msg_assistant",
    type: "text",
    text,
  }
}

function thinking(text: string): Part {
  return {
    id: `part_reasoning_${text}`,
    sessionID: "ses_1",
    messageID: "msg_assistant",
    type: "reasoning",
    text,
    time: { start: 1000, end: 1500 },
  }
}

function tool(): Part {
  return {
    id: "part_tool",
    sessionID: "ses_1",
    messageID: "msg_assistant",
    callID: "call_1",
    type: "tool",
    tool: "read_file",
    state: {
      input: { path: "a.ts" },
      status: "completed",
      title: "read_file",
      output: "done",
      metadata: {},
      time: {
        start: 1000,
        end: 1100,
      },
    },
  }
}

describe("transcript formatting", () => {
  it("formats assistant headers with metadata and duration", () => {
    const out = formatAssistantHeader(assistant(), true)
    expect(out).toContain("Assistant")
    expect(out).toContain("Yc")
    expect(out).toContain("openai/gpt-5.4")
    expect(out).toContain("1.5s")
  })

  it("formats text, reasoning, and tool parts based on options", () => {
    const outText = formatPart(text("hello"), opts)
    const outThinking = formatPart(thinking("chain"), opts)
    const outTool = formatPart(tool(), opts)

    expect(outText).toContain("hello")
    expect(outThinking).toContain("_Thinking:_")
    expect(outTool).toContain("Tool: read_file")
    expect(outTool).toContain("\"path\": \"a.ts\"")
    expect(outTool).toContain("done")
  })

  it("formats complete messages and transcripts", () => {
    const msg = formatMessage(
      assistant(),
      [text("answer"), thinking("reason")],
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
          info: user(),
          parts: [text("question")],
        },
        {
          info: assistant(),
          parts: [text("answer")],
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
