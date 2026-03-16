import z from "zod"
import { type Tool as AITool, asSchema, jsonSchema, type ToolCallOptions, tool } from "ai"
import { Identifier } from "../../util/id"
import { MessageV2 } from "../message-v2"
import { ProviderTransform } from "../../provider/transform"
import { Session } from ".."
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { ToolRegistry } from "../../tool/registry"
import { Plugin } from "../../plugin"
import { MCP } from "../../mcp"
import { Tool } from "../../tool/tool"
import { PermissionNext } from "../../capability/permission/next"
import { Truncate } from "../../tool/truncation"
import { Log } from "../../util/log"
import { SessionProcessor } from "../processor"

const log = Log.create({ service: "session.prompt" })

export async function resolveTools(input: {
  agent: Agent.Info
  model: Provider.Model
  session: Session.Info
  tools?: Record<string, boolean>
  processor: SessionProcessor.Info
  bypassAgentCheck: boolean
  messages: MessageV2.WithParts[]
}) {
  using _ = log.time("resolveTools")
  const tools: Record<string, AITool> = {}

  let allowed: Set<string> | undefined
  if (input.agent.capabilities) {
    const resolved = await import("../../capability").then((m) =>
      m.CapabilityRegistry.resolveForAgent(input.agent.capabilities),
    )
    allowed = new Set(resolved.map((item: { id: string }) => item.id))
  }

  const context = (args: any, options: ToolCallOptions): Tool.Context => ({
    sessionID: input.session.id,
    abort: options.abortSignal!,
    messageID: input.processor.message.id,
    callID: options.toolCallId,
    extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck },
    agent: input.agent.name,
    messages: input.messages,
    metadata: async (val: { title?: string; metadata?: any }) => {
      const match = input.processor.partFromToolCall(options.toolCallId)
      if (match && match.state.status === "running") {
        await Session.updatePart({
          ...match,
          state: {
            title: val.title,
            metadata: val.metadata,
            status: "running",
            input: args,
            time: {
              start: Date.now(),
            },
          },
        })
      }
    },
    async ask(req) {
      await PermissionNext.ask({
        ...req,
        sessionID: input.session.id,
        tool: { messageID: input.processor.message.id, callID: options.toolCallId },
        ruleset: PermissionNext.merge(input.agent.permission, input.session.permission ?? []),
      })
    },
  })

  for (const item of await ToolRegistry.tools(
    { modelID: input.model.api.id, providerID: input.model.providerID },
    input.agent,
  )) {
    if (allowed && !allowed.has(item.id)) continue

    const schema = ProviderTransform.schema(input.model, z.toJSONSchema(item.parameters))
    tools[item.id] = tool({
      id: item.id as any,
      description: item.description,
      inputSchema: jsonSchema(schema as any),
      async execute(args, options) {
        const ctx = context(args, options)
        await Plugin.trigger(
          "tool.execute.before",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
          },
          { args },
        )
        const result = await item.execute(args, ctx)
        const output = {
          ...result,
          attachments: result.attachments?.map((attachment) => ({
            ...attachment,
            id: Identifier.ascending("part"),
            sessionID: ctx.sessionID,
            messageID: input.processor.message.id,
          })),
        }
        await Plugin.trigger(
          "tool.execute.after",
          {
            tool: item.id,
            sessionID: ctx.sessionID,
            callID: ctx.callID,
            args,
          },
          output,
        )
        return output
      },
    })
  }

  for (const [key, item] of Object.entries(await MCP.tools())) {
    if (allowed && !allowed.has(key)) continue

    const execute = item.execute
    if (!execute) continue

    const transformed = ProviderTransform.schema(input.model, asSchema(item.inputSchema).jsonSchema)
    item.inputSchema = jsonSchema(transformed)
    item.execute = async (args, opts) => {
      const ctx = context(args, opts)

      await Plugin.trigger(
        "tool.execute.before",
        {
          tool: key,
          sessionID: ctx.sessionID,
          callID: opts.toolCallId,
        },
        { args },
      )

      await ctx.ask({
        permission: key,
        metadata: {},
        patterns: ["*"],
        always: ["*"],
      })

      const result = await execute(args, opts)

      await Plugin.trigger(
        "tool.execute.after",
        {
          tool: key,
          sessionID: ctx.sessionID,
          callID: opts.toolCallId,
          args,
        },
        result,
      )

      const text: string[] = []
      const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []

      for (const item of result.content) {
        if (item.type === "text") {
          text.push(item.text)
        } else if (item.type === "image") {
          attachments.push({
            type: "file",
            mime: item.mimeType,
            url: `data:${item.mimeType};base64,${item.data}`,
          })
        } else if (item.type === "resource") {
          const { resource } = item
          if (resource.text) text.push(resource.text)
          if (resource.blob) {
            attachments.push({
              type: "file",
              mime: resource.mimeType ?? "application/octet-stream",
              url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
              filename: resource.uri,
            })
          }
        }
      }

      const truncated = await Truncate.output(text.join("\n\n"), {}, input.agent)
      const metadata = {
        ...(result.metadata ?? {}),
        truncated: truncated.truncated,
        ...(truncated.truncated && { outputPath: truncated.outputPath }),
      }

      return {
        title: "",
        metadata,
        output: truncated.content,
        attachments: attachments.map((item) => ({
          ...item,
          id: Identifier.ascending("part"),
          sessionID: ctx.sessionID,
          messageID: input.processor.message.id,
        })),
        content: result.content,
      }
    }
    tools[key] = item
  }

  return tools
}
