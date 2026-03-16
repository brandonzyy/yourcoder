import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { AssistantMessage, YcClient, SessionMessageResponse } from "@yourcoder/sdk/v2"
import { Log } from "../../util/log"

export type ModeOption = { id: string; name: string; description?: string }
export type ModelOption = { modelId: string; name: string }

export const DEFAULT_VARIANT_VALUE = "default"
export const log = Log.create({ service: "acp-agent" })

async function getContextLimit(sdk: YcClient, providerID: string, modelID: string, directory: string) {
  const providers = await sdk.config
    .providers({ directory })
    .then((x) => x.data?.providers ?? [])
    .catch((err) => {
      log.error("failed to get providers for context limit", { error: err })
      return []
    })

  const provider = providers.find((p) => p.id === providerID)
  const model = provider?.models[modelID]
  return model?.limit.context ?? null
}

export async function sendUsageUpdate(
  connection: AgentSideConnection,
  sdk: YcClient,
  sessionID: string,
  directory: string,
) {
  const messages = await sdk.session
    .messages({ sessionID, directory }, { throwOnError: true })
    .then((x) => x.data)
    .catch((err) => {
      log.error("failed to fetch messages for usage update", { error: err })
      return undefined
    })

  if (!messages) return

  const items = messages.filter(
    (m): m is { info: AssistantMessage; parts: SessionMessageResponse["parts"] } => m.info.role === "assistant",
  )
  const last = items[items.length - 1]
  if (!last) return

  const size = await getContextLimit(sdk, last.info.providerID, last.info.modelID, directory)
  if (!size) return

  const used = last.info.tokens.input + (last.info.tokens.cache?.read ?? 0)
  const total = items.reduce((sum, m) => sum + m.info.cost, 0)

  await connection
    .sessionUpdate({
      sessionId: sessionID,
      update: {
        sessionUpdate: "usage_update",
        used,
        size,
        cost: { amount: total, currency: "USD" },
      },
    })
    .catch((err) => {
      log.error("failed to send usage update", { error: err })
    })
}
