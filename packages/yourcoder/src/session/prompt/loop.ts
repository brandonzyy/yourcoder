import { Log } from "../../util/log"
import { defer } from "../../util/defer"
import { MessageV2 } from "../message-v2"
import { Session } from ".."
import { SessionStatus } from "../status"
import { Provider } from "../../provider/provider"
import { Bus } from "../../util/bus"
import { NamedError } from "@yourcoder/util/error"
import { Identifier } from "../../util/id"
import { TaskTool } from "../../tool/task"
import { Plugin } from "../../plugin"
import { ulid } from "ulid"
import { Tool } from "../../tool/tool"
import { PermissionNext } from "../../capability/permission/next"
import { SessionCompaction } from "../compaction"
import { Agent } from "../../agent/agent"
import { Instance } from "../../project/instance"
import { SessionProcessor } from "../processor"
import { SessionSummary } from "../summary"
import { SystemPrompt } from "../system"
import { InstructionPrompt } from "../instruction"
import MAX_STEPS from "./max-steps.txt"
import { start, resume, wait, cancel, flush } from "./state"
import type { LoopInput } from "./schema"
import { ensureTitle } from "./title"
import { insertReminders } from "./reminders"
import { resolveTools } from "./tools"
import { createStructuredOutputTool, STRUCTURED_OUTPUT_SYSTEM_PROMPT } from "./structured-output"

const log = Log.create({ service: "session.prompt" })

export async function loop(input: LoopInput) {
  const { sessionID, resume_existing } = input

  const abort = resume_existing ? resume(sessionID) : start(sessionID)
  if (!abort) {
    return wait(sessionID)
  }

  using _ = defer(() => cancel(sessionID))

  let structured: unknown | undefined
  let step = 0
  const session = await Session.get(sessionID)
  while (true) {
    SessionStatus.set(sessionID, { type: "busy" })
    log.info("loop", { step, sessionID })
    if (abort.aborted) break
    let msgs = await MessageV2.filterCompacted(MessageV2.stream(sessionID))

    let lastUser: MessageV2.User | undefined
    let lastAssistant: MessageV2.Assistant | undefined
    let lastFinished: MessageV2.Assistant | undefined
    let tasks: (MessageV2.CompactionPart | MessageV2.SubtaskPart)[] = []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]
      if (!lastUser && msg.info.role === "user") lastUser = msg.info as MessageV2.User
      if (!lastAssistant && msg.info.role === "assistant") lastAssistant = msg.info as MessageV2.Assistant
      if (!lastFinished && msg.info.role === "assistant" && msg.info.finish)
        lastFinished = msg.info as MessageV2.Assistant
      if (lastUser && lastFinished) break
      const task = msg.parts.filter((part) => part.type === "compaction" || part.type === "subtask")
      if (task && !lastFinished) tasks.push(...task)
    }

    if (!lastUser) throw new Error("No user message found in stream. This should never happen.")
    if (
      lastAssistant?.finish &&
      !["tool-calls", "unknown"].includes(lastAssistant.finish) &&
      lastUser.id < lastAssistant.id
    ) {
      log.info("exiting loop", { sessionID })
      break
    }

    step++
    if (step === 1) {
      ensureTitle({
        session,
        modelID: lastUser.model.modelID,
        providerID: lastUser.model.providerID,
        history: msgs,
      })
    }

    const model = await Provider.getModel(lastUser.model.providerID, lastUser.model.modelID).catch((e) => {
      if (Provider.ModelNotFoundError.isInstance(e)) {
        const hint = e.data.suggestions?.length ? ` Did you mean: ${e.data.suggestions.join(", ")}?` : ""
        Bus.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${e.data.providerID}/${e.data.modelID}.${hint}`,
          }).toObject(),
        })
      }
      throw e
    })
    const task = tasks.pop()

    if (task?.type === "subtask") {
      const taskTool = await TaskTool.init()
      const taskModel = task.model ? await Provider.getModel(task.model.providerID, task.model.modelID) : model
      const assistantMessage = (await Session.updateMessage({
        id: Identifier.ascending("message"),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.variant,
        path: {
          cwd: Instance.directory,
          root: Instance.worktree,
        },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: {
          created: Date.now(),
        },
      })) as MessageV2.Assistant
      let part = (await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: {
            start: Date.now(),
          },
        },
      })) as MessageV2.ToolPart
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      await Plugin.trigger(
        "tool.execute.before",
        {
          tool: "task",
          sessionID,
          callID: part.id,
        },
        { args: taskArgs },
      )
      let err: Error | undefined
      const taskAgent = await Agent.get(task.agent)
      const taskCtx: Tool.Context = {
        agent: task.agent,
        messageID: assistantMessage.id,
        sessionID,
        abort,
        callID: part.callID,
        extra: { bypassAgentCheck: true },
        messages: msgs,
        async metadata(input) {
          await Session.updatePart({
            ...part,
            type: "tool",
            state: {
              ...part.state,
              ...input,
            },
          } satisfies MessageV2.ToolPart)
        },
        async ask(req) {
          await PermissionNext.ask({
            ...req,
            sessionID,
            ruleset: PermissionNext.merge(taskAgent.permission, session.permission ?? []),
          })
        },
      }
      const result = await taskTool.execute(taskArgs, taskCtx).catch((error) => {
        err = error
        log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
        return undefined
      })
      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: Identifier.ascending("part"),
        sessionID,
        messageID: assistantMessage.id,
      }))
      await Plugin.trigger(
        "tool.execute.after",
        {
          tool: "task",
          sessionID,
          callID: part.id,
          args: taskArgs,
        },
        result,
      )
      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      await Session.updateMessage(assistantMessage)
      if (result && part.state.status === "running") {
        await Session.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: {
              ...part.state.time,
              end: Date.now(),
            },
          },
        } satisfies MessageV2.ToolPart)
      }
      if (!result) {
        await Session.updatePart({
          ...part,
          state: {
            status: "error",
            error: err ? `Tool execution failed: ${err.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.metadata,
            input: part.state.input,
          },
        } satisfies MessageV2.ToolPart)
      }

      if (task.command) {
        const summaryUserMsg: MessageV2.User = {
          id: Identifier.ascending("message"),
          sessionID,
          role: "user",
          time: {
            created: Date.now(),
          },
          agent: lastUser.agent,
          model: lastUser.model,
        }
        await Session.updateMessage(summaryUserMsg)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: summaryUserMsg.id,
          sessionID,
          type: "text",
          text: "Summarize the task tool output above and continue with your task.",
          synthetic: true,
        } satisfies MessageV2.TextPart)
      }

      continue
    }

    if (task?.type === "compaction") {
      const result = await SessionCompaction.process({
        messages: msgs,
        parentID: lastUser.id,
        abort,
        sessionID,
        auto: task.auto,
        overflow: task.overflow,
      })
      if (result === "stop") break
      continue
    }

    if (
      lastFinished &&
      lastFinished.summary !== true &&
      (await SessionCompaction.isOverflow({ tokens: lastFinished.tokens, model }))
    ) {
      await SessionCompaction.create({
        sessionID,
        agent: lastUser.agent,
        model: lastUser.model,
        auto: true,
      })
      continue
    }

    const agent = await Agent.get(lastUser.agent)
    const maxSteps = agent.steps ?? Infinity
    const isLastStep = step >= maxSteps
    msgs = await insertReminders({
      messages: msgs,
      agent,
      session,
    })

    const processor = SessionProcessor.create({
      assistantMessage: (await Session.updateMessage({
        id: Identifier.ascending("message"),
        parentID: lastUser.id,
        role: "assistant",
        mode: agent.name,
        agent: agent.name,
        variant: lastUser.variant,
        path: {
          cwd: Instance.directory,
          root: Instance.worktree,
        },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: { read: 0, write: 0 },
        },
        modelID: model.id,
        providerID: model.providerID,
        time: {
          created: Date.now(),
        },
        sessionID,
      })) as MessageV2.Assistant,
      sessionID,
      model,
      abort,
    })
    using __ = defer(() => InstructionPrompt.clear(processor.message.id))

    const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
    const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

    const tools = await resolveTools({
      agent,
      session,
      model,
      tools: lastUser.tools,
      processor,
      bypassAgentCheck,
      messages: msgs,
    })

    if (lastUser.format?.type === "json_schema") {
      tools.StructuredOutput = createStructuredOutputTool({
        schema: lastUser.format.schema,
        onSuccess(output) {
          structured = output
        },
      })
    }

    if (step === 1) {
      SessionSummary.summarize({
        sessionID,
        messageID: lastUser.id,
      })
    }

    if (step > 1 && lastFinished) {
      for (const msg of msgs) {
        if (msg.info.role !== "user" || msg.info.id <= lastFinished.id) continue
        for (const part of msg.parts) {
          if (part.type !== "text" || part.ignored || part.synthetic) continue
          if (!part.text.trim()) continue
          part.text = [
            "<system-reminder>",
            "The user sent the following message:",
            part.text,
            "",
            "Please address this message and continue with your tasks.",
            "</system-reminder>",
          ].join("\n")
        }
      }
    }

    await Plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

    const system = [...(await SystemPrompt.environment(model)), ...(await InstructionPrompt.system())]
    const format = lastUser.format ?? { type: "text" }
    if (format.type === "json_schema") {
      system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
    }

    const result = await processor.process({
      user: lastUser,
      agent,
      abort,
      sessionID,
      system,
      messages: [
        ...MessageV2.toModelMessages(msgs, model),
        ...(isLastStep
          ? [
              {
                role: "assistant" as const,
                content: MAX_STEPS,
              },
            ]
          : []),
      ],
      tools,
      model,
      toolChoice: format.type === "json_schema" ? "required" : undefined,
    })

    if (structured !== undefined) {
      processor.message.structured = structured
      processor.message.finish = processor.message.finish ?? "stop"
      await Session.updateMessage(processor.message)
      break
    }

    const modelFinished = processor.message.finish && !["tool-calls", "unknown"].includes(processor.message.finish)
    if (modelFinished && !processor.message.error && format.type === "json_schema") {
      processor.message.error = new MessageV2.StructuredOutputError({
        message: "Model did not produce structured output",
        retries: 0,
      }).toObject()
      await Session.updateMessage(processor.message)
      break
    }

    if (result === "stop") break
    if (result === "compact") {
      await SessionCompaction.create({
        sessionID,
        agent: lastUser.agent,
        model: lastUser.model,
        auto: true,
        overflow: !processor.message.finish,
      })
    }
  }

  SessionCompaction.prune({ sessionID })
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user") continue
    flush(sessionID, item)
    return item
  }
  throw new Error("Impossible")
}
