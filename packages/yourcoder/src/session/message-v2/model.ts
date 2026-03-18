import { convertToModelMessages, type ModelMessage, type UIMessage } from "ai"
import type { Provider } from "@/provider/provider"
import { Identifier } from "../../util/id"
import { iife } from "@yourcoder/util/iife"
import { MessageV2 } from "../message-v2"

export function toModelMessages(
  input: MessageV2.WithParts[],
  model: Provider.Model,
  options?: { stripMedia?: boolean },
): ModelMessage[] {
  const result: UIMessage[] = []
  const toolNames = new Set<string>()
  const supportsMediaInToolResults = (() => {
    if (model.api.npm === "@ai-sdk/anthropic") return true
    if (model.api.npm === "@ai-sdk/openai") return true
    if (model.api.npm === "@ai-sdk/amazon-bedrock") return true
    if (model.api.npm === "@ai-sdk/google-vertex/anthropic") return true
    if (model.api.npm === "@ai-sdk/google") {
      const id = model.api.id.toLowerCase()
      return id.includes("gemini-3") && !id.includes("gemini-2")
    }
    return false
  })()

  const toModelOutput = (output: unknown) => {
    if (typeof output === "string") {
      return { type: "text", value: output }
    }

    if (typeof output === "object") {
      const item = output as {
        text: string
        attachments?: Array<{ mime: string; url: string }>
      }
      const attachments = (item.attachments ?? []).filter((attachment) => {
        return attachment.url.startsWith("data:") && attachment.url.includes(",")
      })

      return {
        type: "content",
        value: [
          { type: "text", text: item.text },
          ...attachments.map((attachment) => ({
            type: "media",
            mediaType: attachment.mime,
            data: iife(() => {
              const index = attachment.url.indexOf(",")
              return index === -1 ? attachment.url : attachment.url.slice(index + 1)
            }),
          })),
        ],
      }
    }

    return { type: "json", value: output as never }
  }

  for (const msg of input) {
    if (msg.parts.length === 0) continue

    if (msg.info.role === "user") {
      const userMessage: UIMessage = {
        id: msg.info.id,
        role: "user",
        parts: [],
      }
      result.push(userMessage)
      for (const part of msg.parts) {
        if (part.type === "text" && !part.ignored) {
          userMessage.parts.push({
            type: "text",
            text: part.text,
          })
        }
        if (part.type === "file" && part.mime !== "text/plain" && part.mime !== "application/x-directory") {
          if (options?.stripMedia && MessageV2.isMedia(part.mime)) {
            userMessage.parts.push({
              type: "text",
              text: `[Attached ${part.mime}: ${part.filename ?? "file"}]`,
            })
          } else {
            userMessage.parts.push({
              type: "file",
              url: part.url,
              mediaType: part.mime,
              filename: part.filename,
            })
          }
        }

        if (part.type === "compaction") {
          userMessage.parts.push({
            type: "text",
            text: "What did we do so far?",
          })
        }
        if (part.type === "subtask") {
          userMessage.parts.push({
            type: "text",
            text: "The following tool was executed by the user",
          })
        }
      }
      continue
    }

    const differentModel = `${model.providerID}/${model.id}` !== `${msg.info.providerID}/${msg.info.modelID}`
    const media: Array<{ mime: string; url: string }> = []

    if (
      msg.info.error &&
      !(
        MessageV2.AbortedError.isInstance(msg.info.error) &&
        msg.parts.some((part) => part.type !== "step-start" && part.type !== "reasoning")
      )
    ) {
      continue
    }

    const assistantMessage: UIMessage = {
      id: msg.info.id,
      role: "assistant",
      parts: [],
    }

    for (const part of msg.parts) {
      if (part.type === "text") {
        assistantMessage.parts.push({
          type: "text",
          text: part.text,
          ...(differentModel ? {} : { providerMetadata: part.metadata }),
        })
      }
      if (part.type === "step-start") {
        assistantMessage.parts.push({
          type: "step-start",
        })
      }
      if (part.type === "tool") {
        toolNames.add(part.tool)
        if (part.state.status === "completed") {
          const outputText = part.state.time.compacted ? "[Old tool result content cleared]" : part.state.output
          const attachments = part.state.time.compacted || options?.stripMedia ? [] : (part.state.attachments ?? [])
          const mediaAttachments = attachments.filter((attachment) => MessageV2.isMedia(attachment.mime))
          const nonMediaAttachments = attachments.filter((attachment) => !MessageV2.isMedia(attachment.mime))
          if (!supportsMediaInToolResults && mediaAttachments.length > 0) {
            media.push(...mediaAttachments)
          }
          const finalAttachments = supportsMediaInToolResults ? attachments : nonMediaAttachments
          const output =
            finalAttachments.length > 0
              ? {
                  text: outputText,
                  attachments: finalAttachments,
                }
              : outputText

          assistantMessage.parts.push({
            type: ("tool-" + part.tool) as `tool-${string}`,
            state: "output-available",
            toolCallId: part.callID,
            input: part.state.input,
            output,
            ...(differentModel ? {} : { callProviderMetadata: part.metadata }),
          })
        }
        if (part.state.status === "error") {
          assistantMessage.parts.push({
            type: ("tool-" + part.tool) as `tool-${string}`,
            state: "output-error",
            toolCallId: part.callID,
            input: part.state.input,
            errorText: part.state.error,
            ...(differentModel ? {} : { callProviderMetadata: part.metadata }),
          })
        }
        if (part.state.status === "pending" || part.state.status === "running") {
          assistantMessage.parts.push({
            type: ("tool-" + part.tool) as `tool-${string}`,
            state: "output-error",
            toolCallId: part.callID,
            input: part.state.input,
            errorText: "[Tool execution was interrupted]",
            ...(differentModel ? {} : { callProviderMetadata: part.metadata }),
          })
        }
      }
      if (part.type === "reasoning") {
        assistantMessage.parts.push({
          type: "reasoning",
          text: part.text,
          ...(differentModel ? {} : { providerMetadata: part.metadata }),
        })
      }
    }

    if (assistantMessage.parts.length === 0) continue
    result.push(assistantMessage)
    if (media.length > 0) {
      result.push({
        id: Identifier.ascending("message"),
        role: "user",
        parts: [
          {
            type: "text" as const,
            text: "Attached image(s) from tool result:",
          },
          ...media.map((attachment) => ({
            type: "file" as const,
            url: attachment.url,
            mediaType: attachment.mime,
          })),
        ],
      })
    }
  }

  const tools = Object.fromEntries(Array.from(toolNames).map((toolName) => [toolName, { toModelOutput }]))

  return convertToModelMessages(
    result.filter((msg) => msg.parts.some((part) => part.type !== "step-start")),
    {
      //@ts-expect-error convertToModelMessages only needs tools[name]?.toModelOutput
      tools,
    },
  )
}
