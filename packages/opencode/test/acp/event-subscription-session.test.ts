import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { createFakeAgent } from "./event-subscription.helpers"

describe("acp.agent event subscription sessions", () => {
  test("routes message.part.delta by the event sessionID (no cross-session pollution)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, updates, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "message.part.delta",
            properties: {
              sessionID: sessionB,
              messageID: "msg_1",
              partID: "msg_1_part",
              field: "text",
              delta: "hello",
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 10))

        expect((updates.get(sessionA) ?? []).includes("agent_message_chunk")).toBe(false)
        expect((updates.get(sessionB) ?? []).includes("agent_message_chunk")).toBe(true)
        stop()
      },
    })
  })

  test("keeps concurrent sessions isolated when message.part.delta events are interleaved", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, chunks, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const tokenA = ["ALPHA_", "111", "_X"]
        const tokenB = ["BETA_", "222", "_Y"]

        const push = (sessionId: string, messageID: string, delta: string) => {
          controller.push({
            directory: cwd,
            payload: {
              type: "message.part.delta",
              properties: {
                sessionID: sessionId,
                messageID,
                partID: `${messageID}_part`,
                field: "text",
                delta,
              },
            },
          } as any)
        }

        push(sessionA, "msg_a", tokenA[0])
        push(sessionB, "msg_b", tokenB[0])
        push(sessionA, "msg_a", tokenA[1])
        push(sessionB, "msg_b", tokenB[1])
        push(sessionA, "msg_a", tokenA[2])
        push(sessionB, "msg_b", tokenB[2])

        await new Promise((r) => setTimeout(r, 20))

        const a = chunks.get(sessionA) ?? ""
        const b = chunks.get(sessionB) ?? ""

        expect(a).toContain(tokenA.join(""))
        expect(b).toContain(tokenB.join(""))
        for (const part of tokenB) expect(a).not.toContain(part)
        for (const part of tokenA) expect(b).not.toContain(part)
        stop()
      },
    })
  })

  test("does not create additional event subscriptions on repeated loadSession()", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, calls, stop } = createFakeAgent()
        const cwd = "/tmp/opencode-acp-test"
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)

        expect(calls.eventSubscribe).toBe(1)
        stop()
      },
    })
  })
})
