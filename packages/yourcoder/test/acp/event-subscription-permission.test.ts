import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { createFakeAgent, type RequestPermissionParams } from "./event-subscription.helpers"

describe("acp.agent event subscription permissions", () => {
  test("permission.asked events are handled and replied", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const replies: string[] = []
        const { agent, controller, stop, sdk } = createFakeAgent()
        sdk.permission.reply = async (params: any) => {
          replies.push(params.requestID)
          return { data: true }
        }
        const cwd = "/tmp/opencode-acp-test"
        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "permission.asked",
            properties: {
              id: "perm_1",
              sessionID: sessionA,
              permission: "bash",
              patterns: ["*"],
              metadata: {},
              always: [],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))
        expect(replies).toContain("perm_1")
        stop()
      },
    })
  })

  test("permission prompt on session A does not block message updates for session B", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const replies: string[] = []
        let resolveA: (() => void) | undefined
        const wait = new Promise<void>((r) => {
          resolveA = r
        })

        const { agent, controller, chunks, stop, sdk, connection } = createFakeAgent()
        const original = connection.requestPermission.bind(connection)

        connection.requestPermission = async (params: RequestPermissionParams) => {
          if (params.sessionId.endsWith("1")) {
            await wait
          }
          return original(params)
        }

        sdk.permission.reply = async (params: any) => {
          replies.push(params.requestID)
          return { data: true }
        }

        const cwd = "/tmp/opencode-acp-test"
        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "permission.asked",
            properties: {
              id: "perm_a",
              sessionID: sessionA,
              permission: "bash",
              patterns: ["*"],
              metadata: {},
              always: [],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 10))

        controller.push({
          directory: cwd,
          payload: {
            type: "message.part.delta",
            properties: {
              sessionID: sessionB,
              messageID: "msg_b",
              partID: "msg_b_part",
              field: "text",
              delta: "session_b_message",
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))
        expect(chunks.get(sessionB) ?? "").toContain("session_b_message")
        expect(replies).not.toContain("perm_a")

        resolveA!()
        await new Promise((r) => setTimeout(r, 20))
        expect(replies).toContain("perm_a")
        stop()
      },
    })
  })
})
