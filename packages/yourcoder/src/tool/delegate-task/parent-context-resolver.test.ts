import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { resolveParentContext } from "./util"
import * as injector from "../../hooks/context-injection/message-injector"
import * as state from "../../session/state"
import * as dir from "../../util/opencode-message-dir"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("resolveParentContext", () => {
  it("prefers ctx agent, then returns previous model info", async () => {
    add(spyOn(dir, "getMessageDir").mockReturnValue("/tmp/messages"))
    add(spyOn(injector, "resolveMessageContext").mockResolvedValue({
      prevMessage: {
        agent: "prev-agent",
        model: {
          providerID: "openai",
          modelID: "gpt-5.4",
          variant: "fast",
        },
      },
      firstMessageAgent: "first-agent",
    } as never))
    add(spyOn(state, "getSessionAgent").mockReturnValue("session-agent"))

    const res = await resolveParentContext(
      {
        sessionID: "ses_1",
        messageID: "msg_1",
        agent: "ctx-agent",
      } as never,
      {} as never,
    )

    expect(res).toEqual({
      sessionID: "ses_1",
      messageID: "msg_1",
      agent: "ctx-agent",
      model: {
        providerID: "openai",
        modelID: "gpt-5.4",
        variant: "fast",
      },
    })
  })

  it("falls back through session, first message, and previous agent sources", async () => {
    add(spyOn(dir, "getMessageDir").mockReturnValue(null))
    add(spyOn(injector, "resolveMessageContext").mockResolvedValue({
      prevMessage: {
        agent: "prev-agent",
      },
      firstMessageAgent: "first-agent",
    } as never))
    add(spyOn(state, "getSessionAgent").mockReturnValue(undefined))

    const res = await resolveParentContext(
      {
        sessionID: "ses_1",
        messageID: "msg_1",
      } as never,
      {} as never,
    )

    expect(res).toEqual({
      sessionID: "ses_1",
      messageID: "msg_1",
      agent: "first-agent",
      model: undefined,
    })
  })
})
