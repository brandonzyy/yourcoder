const { describe, expect, test, beforeEach, afterEach, spyOn } = require("bun:test")

import { createSessionNotification } from "./index"
import { setMainSession, subagentSessions, _resetForTesting } from "../../session/state"
import * as notification from "./notification"

describe("session-notification input-needed events", () => {
  let notificationCalls: string[]

  function createMockPluginInput() {
    return {
      $: async (cmd: TemplateStringsArray | string, ...values: unknown[]) => {
        const cmdStr = typeof cmd === "string"
          ? cmd
          : cmd.reduce((acc, part, i) => acc + part + (values[i] ?? ""), "")

        return { stdout: "", stderr: "", exitCode: 0 }
      },
      client: {
        session: {
          todo: async () => ({ data: [] }),
        },
      },
      directory: "/tmp/test",
    } as any
  }

  beforeEach(() => {
    _resetForTesting()
    notificationCalls = []

    spyOn(notification, "startBackgroundCheck").mockImplementation(() => {})
    spyOn(notification, "detectPlatform").mockReturnValue("darwin")
    spyOn(notification, "sendSessionNotification").mockImplementation(async (_ctx: unknown, _platform: unknown, _title: unknown, message: string) => {
      notificationCalls.push(message)
    })
  })

  afterEach(() => {
    subagentSessions.clear()
  })

  test("sends question notification when question tool asks for input", async () => {
    const sessionID = "main-question"
    setMainSession(sessionID)
    const hook = createSessionNotification(createMockPluginInput(), { enforceMainSessionFilter: false })

    await hook({
      event: {
        type: "tool.execute.before",
        properties: {
          sessionID,
          tool: "question",
          args: {
            questions: [
              {
                question: "Which branch should we use?",
                options: [{ label: "main" }, { label: "dev" }],
              },
            ],
          },
        },
      },
    })

    expect(notificationCalls).toHaveLength(1)
    expect(notificationCalls[0]).toContain("Agent is asking a question")
  })

  test("sends permission notification for permission events", async () => {
    const sessionID = "main-permission"
    setMainSession(sessionID)
    const hook = createSessionNotification(createMockPluginInput(), { enforceMainSessionFilter: false })

    await hook({
      event: {
        type: "permission.asked",
        properties: {
          sessionID,
        },
      },
    })

    expect(notificationCalls).toHaveLength(1)
    expect(notificationCalls[0]).toContain("Agent needs permission to continue")
  })
})

export {}
