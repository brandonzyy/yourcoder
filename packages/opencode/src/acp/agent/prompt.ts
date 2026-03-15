import type { PromptRequest, Usage } from "@agentclientprotocol/sdk"
import type { AssistantMessage } from "@opencode-ai/sdk/v2"
import { Agent as AgentModule } from "../../agent/agent"
import { CoreAgent } from "./core"
import { log, sendUsageUpdate } from "./shared"
import { model as defaultModel, parseUri } from "./tool"

declare module "./core" {
  interface CoreAgent {
    prompt(params: PromptRequest): Promise<{ stopReason: "end_turn"; usage?: Usage; _meta: Record<string, never> }>
  }
}

function usage(msg: AssistantMessage): Usage {
  return {
    totalTokens:
      msg.tokens.input +
      msg.tokens.output +
      msg.tokens.reasoning +
      (msg.tokens.cache?.read ?? 0) +
      (msg.tokens.cache?.write ?? 0),
    inputTokens: msg.tokens.input,
    outputTokens: msg.tokens.output,
    thoughtTokens: msg.tokens.reasoning || undefined,
    cachedReadTokens: msg.tokens.cache?.read || undefined,
    cachedWriteTokens: msg.tokens.cache?.write || undefined,
  }
}

CoreAgent.prototype.prompt = async function (params: PromptRequest) {
  const sessionId = params.sessionId
  const session = this.sessionManager.get(sessionId)
  const cwd = session.cwd
  const current = session.model
  const model = current ?? (await defaultModel(this.config, cwd))
  if (!current) {
    this.sessionManager.setModel(session.id, model)
  }

  const agent = session.modeId ?? (await AgentModule.defaultAgent())
  const parts: Array<
    | { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }
    | { type: "file"; url: string; filename: string; mime: string }
  > = []

  for (const part of params.prompt) {
    switch (part.type) {
      case "text": {
        const audience = part.annotations?.audience
        const assistant = audience?.length === 1 && audience[0] === "assistant"
        const user = audience?.length === 1 && audience[0] === "user"
        parts.push({
          type: "text",
          text: part.text,
          ...(assistant && { synthetic: true }),
          ...(user && { ignored: true }),
        })
        break
      }

      case "image": {
        const parsed = parseUri(part.uri ?? "")
        const filename = parsed.type === "file" ? parsed.filename : "image"
        if (part.data) {
          parts.push({
            type: "file",
            url: `data:${part.mimeType};base64,${part.data}`,
            filename,
            mime: part.mimeType,
          })
          break
        }
        if (part.uri && part.uri.startsWith("http:")) {
          parts.push({
            type: "file",
            url: part.uri,
            filename,
            mime: part.mimeType,
          })
        }
        break
      }

      case "resource_link": {
        const parsed = parseUri(part.uri)
        if (part.name && parsed.type === "file") {
          parsed.filename = part.name
        }
        parts.push(parsed)
        break
      }

      case "resource": {
        const resource = part.resource
        if ("text" in resource && resource.text) {
          parts.push({
            type: "text",
            text: resource.text,
          })
          break
        }
        if ("blob" in resource && resource.blob && resource.mimeType) {
          const parsed = parseUri(resource.uri ?? "")
          const filename = parsed.type === "file" ? parsed.filename : "file"
          parts.push({
            type: "file",
            url: `data:${resource.mimeType};base64,${resource.blob}`,
            filename,
            mime: resource.mimeType,
          })
        }
        break
      }

      default:
        break
    }
  }

  log.info("parts", { parts })
  const cmd = (() => {
    const text = parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim()

    if (!text.startsWith("/")) return
    const [name, ...rest] = text.slice(1).split(/\s+/)
    return { name, args: rest.join(" ").trim() }
  })()

  if (!cmd) {
    const response = await this.sdk.session.prompt({
      sessionID: sessionId,
      model: {
        providerID: model.providerID,
        modelID: model.modelID,
      },
      variant: this.sessionManager.getVariant(sessionId),
      parts,
      agent,
      directory: cwd,
    })
    await sendUsageUpdate(this.connection, this.sdk, sessionId, cwd)
    return {
      stopReason: "end_turn" as const,
      usage: response.data?.info ? usage(response.data.info) : undefined,
      _meta: {},
    }
  }

  const command = await this.config.sdk.command
    .list({ directory: cwd }, { throwOnError: true })
    .then((x) => x.data!.find((entry) => entry.name === cmd.name))

  if (command) {
    const response = await this.sdk.session.command({
      sessionID: sessionId,
      command: command.name,
      arguments: cmd.args,
      model: model.providerID + "/" + model.modelID,
      agent,
      directory: cwd,
    })
    await sendUsageUpdate(this.connection, this.sdk, sessionId, cwd)
    return {
      stopReason: "end_turn" as const,
      usage: response.data?.info ? usage(response.data.info) : undefined,
      _meta: {},
    }
  }

  if (cmd.name === "compact") {
    await this.config.sdk.session.summarize(
      {
        sessionID: sessionId,
        directory: cwd,
        providerID: model.providerID,
        modelID: model.modelID,
      },
      { throwOnError: true },
    )
  }

  await sendUsageUpdate(this.connection, this.sdk, sessionId, cwd)
  return {
    stopReason: "end_turn" as const,
    _meta: {},
  }
}
