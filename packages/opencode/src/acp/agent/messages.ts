import type { PlanEntry, Role, ToolCallContent } from "@agentclientprotocol/sdk"
import { pathToFileURL } from "bun"
import type { SessionMessageResponse } from "@opencode-ai/sdk/v2"
import { z } from "zod"
import { Todo } from "../../session/todo"
import { CoreAgent } from "./core"
import { log } from "./shared"
import { toLocations, toToolKind } from "./tool"

declare module "./core" {
  interface CoreAgent {
    processMessage(message: SessionMessageResponse): Promise<void>
  }
}

CoreAgent.prototype.processMessage = async function (message: SessionMessageResponse) {
  log.debug("process message", message)
  if (message.info.role !== "assistant" && message.info.role !== "user") return
  const sessionId = message.info.sessionID

  for (const part of message.parts) {
    if (part.type === "tool") {
      await this.toolStart(sessionId, part)
      switch (part.state.status) {
        case "pending":
          this.bashSnapshots.delete(part.callID)
          break

        case "running": {
          const output = this.bashOutput(part)
          const content: ToolCallContent[] = []
          if (output) {
            content.push({
              type: "content",
              content: {
                type: "text",
                text: output,
              },
            })
          }

          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: part.callID,
                status: "in_progress",
                kind: toToolKind(part.tool),
                title: part.tool,
                locations: toLocations(part.tool, part.state.input),
                rawInput: part.state.input,
                ...(content.length > 0 && { content }),
              },
            })
            .catch((err) => {
              log.error("failed to send tool in_progress to ACP", { error: err })
            })
          break
        }

        case "completed": {
          this.toolStarts.delete(part.callID)
          this.bashSnapshots.delete(part.callID)
          const kind = toToolKind(part.tool)
          const content: ToolCallContent[] = [
            {
              type: "content",
              content: {
                type: "text",
                text: part.state.output,
              },
            },
          ]

          if (kind === "edit") {
            const input = part.state.input
            const path = typeof input["filePath"] === "string" ? input["filePath"] : ""
            const oldText = typeof input["oldString"] === "string" ? input["oldString"] : ""
            const newText =
              typeof input["newString"] === "string"
                ? input["newString"]
                : typeof input["content"] === "string"
                  ? input["content"]
                  : ""
            content.push({
              type: "diff",
              path,
              oldText,
              newText,
            })
          }

          if (part.tool === "todowrite") {
            const parsed = z.array(Todo.Info).safeParse(JSON.parse(part.state.output))
            if (parsed.success) {
              await this.connection
                .sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: "plan",
                    entries: parsed.data.map((todo) => {
                      const status: PlanEntry["status"] =
                        todo.status === "cancelled" ? "completed" : (todo.status as PlanEntry["status"])
                      return {
                        priority: "medium",
                        status,
                        content: todo.content,
                      }
                    }),
                  },
                })
                .catch((err) => {
                  log.error("failed to send session update for todo", { error: err })
                })
            } else {
              log.error("failed to parse todo output", { error: parsed.error })
            }
          }

          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: part.callID,
                status: "completed",
                kind,
                content,
                title: part.state.title,
                rawInput: part.state.input,
                rawOutput: {
                  output: part.state.output,
                  metadata: part.state.metadata,
                },
              },
            })
            .catch((err) => {
              log.error("failed to send tool completed to ACP", { error: err })
            })
          break
        }

        case "error":
          this.toolStarts.delete(part.callID)
          this.bashSnapshots.delete(part.callID)
          await this.connection
            .sessionUpdate({
              sessionId,
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: part.callID,
                status: "failed",
                kind: toToolKind(part.tool),
                title: part.tool,
                rawInput: part.state.input,
                content: [
                  {
                    type: "content",
                    content: {
                      type: "text",
                      text: part.state.error,
                    },
                  },
                ],
                rawOutput: {
                  error: part.state.error,
                  metadata: part.state.metadata,
                },
              },
            })
            .catch((err) => {
              log.error("failed to send tool error to ACP", { error: err })
            })
          break
      }
      continue
    }

    if (part.type === "text") {
      if (!part.text) continue
      const audience: Role[] | undefined = part.synthetic ? ["assistant"] : part.ignored ? ["user"] : undefined
      await this.connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk",
            content: {
              type: "text",
              text: part.text,
              ...(audience && { annotations: { audience } }),
            },
          },
        })
        .catch((err) => {
          log.error("failed to send text to ACP", { error: err })
        })
      continue
    }

    if (part.type === "file") {
      const url = part.url
      const filename = part.filename ?? "file"
      const mime = part.mime || "application/octet-stream"
      const chunk = message.info.role === "user" ? "user_message_chunk" : "agent_message_chunk"

      if (url.startsWith("file://")) {
        await this.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: chunk,
              content: { type: "resource_link", uri: url, name: filename, mimeType: mime },
            },
          })
          .catch((err) => {
            log.error("failed to send resource_link to ACP", { error: err })
          })
        continue
      }

      if (!url.startsWith("data:")) continue
      const match = url.match(/^data:([^;]+);base64,(.*)$/)
      const dataMime = match?.[1]
      const data = match?.[2] ?? ""
      const type = dataMime || mime

      if (type.startsWith("image/")) {
        await this.connection
          .sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: chunk,
              content: {
                type: "image",
                mimeType: type,
                data,
                uri: pathToFileURL(filename).href,
              },
            },
          })
          .catch((err) => {
            log.error("failed to send image to ACP", { error: err })
          })
        continue
      }

      const text = type.startsWith("text/") || type === "application/json"
      const uri = pathToFileURL(filename).href
      const resource = text
        ? {
            uri,
            mimeType: type,
            text: Buffer.from(data, "base64").toString("utf-8"),
          }
        : {
            uri,
            mimeType: type,
            blob: data,
          }

      await this.connection
        .sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: chunk,
            content: { type: "resource", resource },
          },
        })
        .catch((err) => {
          log.error("failed to send resource to ACP", { error: err })
        })
      continue
    }

    if (part.type !== "reasoning" || !part.text) continue
    await this.connection
      .sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: {
            type: "text",
            text: part.text,
          },
        },
      })
      .catch((err) => {
        log.error("failed to send reasoning to ACP", { error: err })
      })
  }
}
