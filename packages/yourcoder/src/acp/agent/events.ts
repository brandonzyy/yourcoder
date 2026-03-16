import type { PlanEntry, ToolCallContent } from "@agentclientprotocol/sdk"
import { Filesystem } from "../../util/filesystem"
import { Hash } from "../../util/hash"
import { Todo } from "../../session/todo"
import type { Event, ToolPart } from "@yourcoder/sdk/v2"
import { z } from "zod"
import { CoreAgent } from "./core"
import { log } from "./shared"
import { getNewContent, toLocations, toToolKind } from "./tool"

declare module "./core" {
  interface CoreAgent {
    startEventSubscription(): void
    runEventSubscription(): Promise<void>
    handleEvent(event: Event): Promise<void>
    bashOutput(part: ToolPart): string | undefined
    toolStart(sessionId: string, part: ToolPart): Promise<void>
  }
}

CoreAgent.prototype.startEventSubscription = function () {
  if (this.eventStarted) return
  this.eventStarted = true
  this.runEventSubscription().catch((err) => {
    if (this.eventAbort.signal.aborted) return
    log.error("event subscription failed", { error: err })
  })
}

CoreAgent.prototype.runEventSubscription = async function () {
  while (true) {
    if (this.eventAbort.signal.aborted) return
    const events = await this.sdk.global.event({
      signal: this.eventAbort.signal,
    })
    for await (const event of events.stream) {
      if (this.eventAbort.signal.aborted) return
      const payload = (event as any)?.payload
      if (!payload) continue
      await this.handleEvent(payload as Event).catch((err) => {
        log.error("failed to handle event", { error: err, type: payload.type })
      })
    }
  }
}

CoreAgent.prototype.handleEvent = async function (event: Event) {
  switch (event.type) {
    case "permission.asked": {
      const permission = event.properties
      const session = this.sessionManager.tryGet(permission.sessionID)
      if (!session) return

      const prev = this.permissionQueues.get(permission.sessionID) ?? Promise.resolve()
      const next = prev
        .then(async () => {
          const directory = session.cwd
          const res = await this.connection
            .requestPermission({
              sessionId: permission.sessionID,
              toolCall: {
                toolCallId: permission.tool?.callID ?? permission.id,
                status: "pending",
                title: permission.permission,
                rawInput: permission.metadata,
                kind: toToolKind(permission.permission),
                locations: toLocations(permission.permission, permission.metadata),
              },
              options: this.permissionOptions,
            })
            .catch(async (err) => {
              log.error("failed to request permission from ACP", {
                error: err,
                permissionID: permission.id,
                sessionID: permission.sessionID,
              })
              await this.sdk.permission.reply({
                requestID: permission.id,
                reply: "reject",
                directory,
              })
              return undefined
            })

          if (!res) return
          if (res.outcome.outcome !== "selected") {
            await this.sdk.permission.reply({
              requestID: permission.id,
              reply: "reject",
              directory,
            })
            return
          }

          if (res.outcome.optionId !== "reject" && permission.permission === "edit") {
            const meta = permission.metadata || {}
            const path = typeof meta["filepath"] === "string" ? meta["filepath"] : ""
            const diff = typeof meta["diff"] === "string" ? meta["diff"] : ""
            const text = (await Filesystem.exists(path)) ? await Filesystem.readText(path) : ""
            const next = getNewContent(text, diff)
            if (next) {
              this.connection.writeTextFile({
                sessionId: session.id,
                path,
                content: next,
              })
            }
          }

          await this.sdk.permission.reply({
            requestID: permission.id,
            reply: res.outcome.optionId as "once" | "always" | "reject",
            directory,
          })
        })
        .catch((err) => {
          log.error("failed to handle permission", { error: err, permissionID: permission.id })
        })
        .finally(() => {
          if (this.permissionQueues.get(permission.sessionID) === next) {
            this.permissionQueues.delete(permission.sessionID)
          }
        })

      this.permissionQueues.set(permission.sessionID, next)
      return
    }

    case "message.part.updated": {
      log.info("message part updated", { event: event.properties })
      const part = event.properties.part
      const session = this.sessionManager.tryGet(part.sessionID)
      if (!session) return
      const sessionId = session.id

      if (part.type !== "tool") return
      await this.toolStart(sessionId, part)

      switch (part.state.status) {
        case "pending":
          this.bashSnapshots.delete(part.callID)
          return

        case "running": {
          const output = this.bashOutput(part)
          const content: ToolCallContent[] = []
          if (output) {
            const hash = Hash.fast(output)
            if (part.tool === "bash") {
              if (this.bashSnapshots.get(part.callID) === hash) {
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
                    },
                  })
                  .catch((err) => {
                    log.error("failed to send tool in_progress to ACP", { error: err })
                  })
                return
              }
              this.bashSnapshots.set(part.callID, hash)
            }
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
          return
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
          return
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
          return
      }
    }

    case "message.part.delta": {
      const props = event.properties
      const session = this.sessionManager.tryGet(props.sessionID)
      if (!session) return

      const message = await this.sdk.session
        .message(
          {
            sessionID: props.sessionID,
            messageID: props.messageID,
            directory: session.cwd,
          },
          { throwOnError: true },
        )
        .then((x) => x.data)
        .catch((err) => {
          log.error("unexpected error when fetching message", { error: err })
          return undefined
        })

      if (!message || message.info.role !== "assistant") return
      const part = message.parts.find((p) => p.id === props.partID)
      if (!part) return

      if (part.type === "text" && props.field === "text" && part.ignored !== true) {
        await this.connection
          .sessionUpdate({
            sessionId: session.id,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: props.delta,
              },
            },
          })
          .catch((err) => {
            log.error("failed to send text delta to ACP", { error: err })
          })
        return
      }

      if (part.type === "reasoning" && props.field === "text") {
        await this.connection
          .sessionUpdate({
            sessionId: session.id,
            update: {
              sessionUpdate: "agent_thought_chunk",
              content: {
                type: "text",
                text: props.delta,
              },
            },
          })
          .catch((err) => {
            log.error("failed to send reasoning delta to ACP", { error: err })
          })
      }
      return
    }
  }
}

CoreAgent.prototype.bashOutput = function (part: ToolPart) {
  if (part.tool !== "bash") return
  if (!("metadata" in part.state) || !part.state.metadata || typeof part.state.metadata !== "object") return
  const output = part.state.metadata["output"]
  if (typeof output !== "string") return
  return output
}

CoreAgent.prototype.toolStart = async function (sessionId: string, part: ToolPart) {
  if (this.toolStarts.has(part.callID)) return
  this.toolStarts.add(part.callID)
  await this.connection
    .sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: part.callID,
        title: part.tool,
        kind: toToolKind(part.tool),
        status: "pending",
        locations: [],
        rawInput: {},
      },
    })
    .catch((err) => {
      log.error("failed to send tool pending to ACP", { error: err })
    })
}
