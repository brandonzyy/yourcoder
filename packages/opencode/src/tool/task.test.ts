import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { TaskTool } from "./task"
import { Agent } from "../agent/agent"
import { PermissionNext } from "../capability/permission/next"
import { Session } from "../session"
import { MessageV2 } from "../session/message-v2"
import { Identifier } from "../util/id"
import { SessionPrompt } from "../session/prompt"
import { Config } from "../config/config"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("TaskTool", () => {
  it("filters inaccessible agents from the tool description", async () => {
    add(spyOn(Agent, "list").mockResolvedValue([
      { name: "explore", description: "Explore", mode: "subagent" },
      { name: "blocked", description: "Blocked", mode: "subagent" },
      { name: "primary", description: "Primary", mode: "primary" },
    ] as never))
    add(spyOn(PermissionNext, "evaluate").mockImplementation((_perm, pattern) => ({
      action: pattern === "blocked" ? "deny" : "allow",
    }) as never))

    const tool = await TaskTool.init({ agent: { permission: [] } as never })

    expect(tool.description).toContain("- explore: Explore")
    expect(tool.description).not.toContain("blocked")
    expect(tool.description).not.toContain("primary")
  })

  it("creates a task session and prompts the selected subagent", async () => {
    const ask = mock(async () => {})
    const metadata = mock(() => {})
    const cancel = mock(() => {})

    add(spyOn(Agent, "list").mockResolvedValue([{ name: "explore", description: "Explore", mode: "subagent" }] as never))
    add(spyOn(PermissionNext, "evaluate").mockReturnValue({ action: "allow" } as never))
    add(spyOn(Config, "get").mockResolvedValue({ experimental: { primary_tools: ["bash"] } } as never))
    add(spyOn(Agent, "get").mockResolvedValue({
      name: "explore",
      permission: [],
    } as never))
    add(spyOn(Session, "get").mockResolvedValue(undefined as never))
    add(spyOn(Session, "create").mockResolvedValue({ id: "ses_task" } as never))
    add(spyOn(MessageV2, "get").mockResolvedValue({
      info: { role: "assistant", modelID: "gpt-5.4", providerID: "openai" },
    } as never))
    add(spyOn(Identifier, "ascending").mockReturnValue("msg_1"))
    add(spyOn(SessionPrompt, "cancel").mockImplementation(cancel as never))
    add(spyOn(SessionPrompt, "resolvePromptParts").mockResolvedValue([{ type: "text", text: "Do it" }] as never))
    add(spyOn(SessionPrompt, "prompt").mockResolvedValue({
      parts: [{ type: "text", text: "done" }],
    } as never))

    const tool = await TaskTool.init()
    const ctrl = new AbortController()

    const res = await tool.execute(
      {
        description: "Fix issue",
        prompt: "Do it",
        subagent_type: "explore",
      },
      {
        sessionID: "ses_main",
        messageID: "msg_main",
        agent: "coder",
        abort: ctrl.signal,
        messages: [],
        ask,
        metadata,
        extra: {},
      } as never,
    )

    expect(ask).toHaveBeenCalledWith({
      permission: "task",
      patterns: ["explore"],
      always: ["*"],
      metadata: {
        description: "Fix issue",
        subagent_type: "explore",
      },
    })
    expect(metadata).toHaveBeenCalledWith({
      title: "Fix issue",
      metadata: {
        sessionId: "ses_task",
        model: {
          modelID: "gpt-5.4",
          providerID: "openai",
        },
      },
    })
    expect(SessionPrompt.prompt).toHaveBeenCalledWith({
      messageID: "msg_1",
      sessionID: "ses_task",
      model: {
        modelID: "gpt-5.4",
        providerID: "openai",
      },
      agent: "explore",
      tools: {
        todowrite: false,
        todoread: false,
        task: false,
        bash: false,
      },
      parts: [{ type: "text", text: "Do it" }],
    })
    expect(res.output).toContain("task_id: ses_task")
    expect(res.output).toContain("done")
  })
})
