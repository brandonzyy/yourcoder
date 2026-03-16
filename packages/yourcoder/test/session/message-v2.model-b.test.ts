import { describe, expect, test } from "bun:test"
import { MessageV2 } from "../../src/session/message-v2"
import { assistantInfo, basePart, model, userInfo } from "./message-v2.helpers"

describe("session.message-v2.toModelMessage", () => {
  test("converts assistant tool error into error-text tool result", () => {
    const userID = "m-user"
    const assistantID = "m-assistant"

    const input: MessageV2.WithParts[] = [
      {
        info: userInfo(userID),
        parts: [
          {
            ...basePart(userID, "u1"),
            type: "text",
            text: "run tool",
          },
        ] as MessageV2.Part[],
      },
      {
        info: assistantInfo(assistantID, userID),
        parts: [
          {
            ...basePart(assistantID, "a1"),
            type: "tool",
            callID: "call-1",
            tool: "bash",
            state: {
              status: "error",
              input: { cmd: "ls" },
              error: "nope",
              time: { start: 0, end: 1 },
              metadata: {},
            },
            metadata: { openai: { tool: "meta" } },
          },
        ] as MessageV2.Part[],
      },
    ]

    expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
      {
        role: "user",
        content: [{ type: "text", text: "run tool" }],
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "bash",
            input: { cmd: "ls" },
            providerExecuted: undefined,
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "bash",
            output: { type: "error-text", value: "nope" },
            providerOptions: { openai: { tool: "meta" } },
          },
        ],
      },
    ])
  })
})

test("filters assistant messages with non-abort errors", () => {
  const assistantID = "m-assistant"

  const input: MessageV2.WithParts[] = [
    {
      info: assistantInfo(
        assistantID,
        "m-parent",
        new MessageV2.APIError({ message: "boom", isRetryable: true }).toObject() as MessageV2.APIError,
      ),
      parts: [
        {
          ...basePart(assistantID, "a1"),
          type: "text",
          text: "should not render",
        },
      ] as MessageV2.Part[],
    },
  ]

  expect(MessageV2.toModelMessages(input, model)).toStrictEqual([])
})

test("includes aborted assistant messages only when they have non-step-start/reasoning content", () => {
  const assistantID1 = "m-assistant-1"
  const assistantID2 = "m-assistant-2"

  const aborted = new MessageV2.AbortedError({ message: "aborted" }).toObject() as MessageV2.Assistant["error"]

  const input: MessageV2.WithParts[] = [
    {
      info: assistantInfo(assistantID1, "m-parent", aborted),
      parts: [
        {
          ...basePart(assistantID1, "a1"),
          type: "reasoning",
          text: "thinking",
          time: { start: 0 },
        },
        {
          ...basePart(assistantID1, "a2"),
          type: "text",
          text: "partial answer",
        },
      ] as MessageV2.Part[],
    },
    {
      info: assistantInfo(assistantID2, "m-parent", aborted),
      parts: [
        {
          ...basePart(assistantID2, "b1"),
          type: "step-start",
        },
        {
          ...basePart(assistantID2, "b2"),
          type: "reasoning",
          text: "thinking",
          time: { start: 0 },
        },
      ] as MessageV2.Part[],
    },
  ]

  expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "thinking", providerOptions: undefined },
        { type: "text", text: "partial answer" },
      ],
    },
  ])
})

test("splits assistant messages on step-start boundaries", () => {
  const assistantID = "m-assistant"

  const input: MessageV2.WithParts[] = [
    {
      info: assistantInfo(assistantID, "m-parent"),
      parts: [
        {
          ...basePart(assistantID, "p1"),
          type: "text",
          text: "first",
        },
        {
          ...basePart(assistantID, "p2"),
          type: "step-start",
        },
        {
          ...basePart(assistantID, "p3"),
          type: "text",
          text: "second",
        },
      ] as MessageV2.Part[],
    },
  ]

  expect(MessageV2.toModelMessages(input, model)).toStrictEqual([
    {
      role: "assistant",
      content: [{ type: "text", text: "first" }],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "second" }],
    },
  ])
})

test("drops messages that only contain step-start parts", () => {
  const assistantID = "m-assistant"

  const input: MessageV2.WithParts[] = [
    {
      info: assistantInfo(assistantID, "m-parent"),
      parts: [
        {
          ...basePart(assistantID, "p1"),
          type: "step-start",
        },
      ] as MessageV2.Part[],
    },
  ]

  expect(MessageV2.toModelMessages(input, model)).toStrictEqual([])
})

test("converts pending/running tool calls to error results to prevent dangling tool_use", () => {
  const userID = "m-user"
  const assistantID = "m-assistant"

  const input: MessageV2.WithParts[] = [
    {
      info: userInfo(userID),
      parts: [
        {
          ...basePart(userID, "u1"),
          type: "text",
          text: "run tool",
        },
      ] as MessageV2.Part[],
    },
    {
      info: assistantInfo(assistantID, userID),
      parts: [
        {
          ...basePart(assistantID, "a1"),
          type: "tool",
          callID: "call-pending",
          tool: "bash",
          state: {
            status: "pending",
            input: { cmd: "ls" },
            raw: "",
          },
        },
        {
          ...basePart(assistantID, "a2"),
          type: "tool",
          callID: "call-running",
          tool: "read",
          state: {
            status: "running",
            input: { path: "/tmp" },
            time: { start: 0 },
          },
        },
      ] as MessageV2.Part[],
    },
  ]

  const result = MessageV2.toModelMessages(input, model)

  expect(result).toStrictEqual([
    {
      role: "user",
      content: [{ type: "text", text: "run tool" }],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "call-pending",
          toolName: "bash",
          input: { cmd: "ls" },
          providerExecuted: undefined,
        },
        {
          type: "tool-call",
          toolCallId: "call-running",
          toolName: "read",
          input: { path: "/tmp" },
          providerExecuted: undefined,
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-pending",
          toolName: "bash",
          output: { type: "error-text", value: "[Tool execution was interrupted]" },
        },
        {
          type: "tool-result",
          toolCallId: "call-running",
          toolName: "read",
          output: { type: "error-text", value: "[Tool execution was interrupted]" },
        },
      ],
    },
  ])
})
