import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { LLM } from "../llm"
import { iife } from "@yourcoder/util/iife"
import { MessageV2 } from "../message-v2"
import { Session } from ".."
import { Log } from "../../util/log"

const log = Log.create({ service: "session.prompt" })

export async function ensureTitle(input: {
  session: Session.Info
  history: MessageV2.WithParts[]
  providerID: string
  modelID: string
}) {
  if (input.session.parentID) return
  if (!Session.isDefaultTitle(input.session.title)) return

  const firstRealUserIdx = input.history.findIndex(
    (m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic),
  )
  if (firstRealUserIdx === -1) return

  const isFirst =
    input.history.filter((m) => m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic))
      .length === 1
  if (!isFirst) return

  const ctx = input.history.slice(0, firstRealUserIdx + 1)
  const firstRealUser = ctx[firstRealUserIdx]
  const subtaskParts = firstRealUser.parts.filter((p) => p.type === "subtask") as MessageV2.SubtaskPart[]
  const hasOnlySubtaskParts = subtaskParts.length > 0 && firstRealUser.parts.every((p) => p.type === "subtask")

  const agent = await Agent.get("title")
  if (!agent) return
  const model = await iife(async () => {
    if (agent.model) return await Provider.getModel(agent.model.providerID, agent.model.modelID)
    return (
      (await Provider.getSmallModel(input.providerID)) ?? (await Provider.getModel(input.providerID, input.modelID))
    )
  })
  const result = await LLM.stream({
    agent,
    user: firstRealUser.info as MessageV2.User,
    system: [],
    small: true,
    tools: {},
    model,
    abort: new AbortController().signal,
    sessionID: input.session.id,
    retries: 2,
    messages: [
      {
        role: "user",
        content: "Generate a title for this conversation:\n",
      },
      ...(hasOnlySubtaskParts
        ? [{ role: "user" as const, content: subtaskParts.map((p) => p.prompt).join("\n") }]
        : MessageV2.toModelMessages(ctx, model)),
    ],
  })
  const text = await result.text.catch((err) => log.error("failed to generate title", { error: err }))
  if (!text) return

  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (!cleaned) return

  const title = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
  return Session.setTitle({ sessionID: input.session.id, title })
}
