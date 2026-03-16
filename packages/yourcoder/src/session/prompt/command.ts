import { $, type pathToFileURL } from "bun"
import { Log } from "../../util/log"
import { Command } from "../command"
import { Agent } from "../../agent/agent"
import { Provider } from "../../provider/provider"
import { Bus } from "../../util/bus"
import { NamedError } from "@yourcoder/util/error"
import { Plugin } from "../../plugin"
import { MessageV2 } from "../message-v2"
import { ConfigMarkdown } from "../../config/markdown"
import { Session } from ".."
import type { CommandInput, PromptInput } from "./schema"
import { resolvePromptParts } from "./resolve-prompt-parts"
import { lastModel } from "./last-model"

const log = Log.create({ service: "session.prompt" })
const bashRegex = /!`([^`]+)`/g
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export async function command(input: CommandInput, prompt: (input: PromptInput) => Promise<MessageV2.WithParts>) {
  log.info("command", input)
  const command = await Command.get(input.command)
  const agentName = command.agent ?? input.agent ?? (await Agent.defaultAgent())

  const raw = input.arguments.match(argsRegex) ?? []
  const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
  const templateCommand = await command.template

  const placeholders = templateCommand.match(placeholderRegex) ?? []
  let last = 0
  for (const item of placeholders) {
    const value = Number(item.slice(1))
    if (value > last) last = value
  }

  const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    return args[argIndex]
  })
  const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
  let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

  if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
    template = template + "\n\n" + input.arguments
  }

  const shell = ConfigMarkdown.shell(template)
  if (shell.length > 0) {
    const results = await Promise.all(
      shell.map(async ([, cmd]) => {
        try {
          return await $`${{ raw: cmd }}`.quiet().nothrow().text()
        } catch (error) {
          return `Error executing command: ${error instanceof Error ? error.message : String(error)}`
        }
      }),
    )
    let index = 0
    template = template.replace(bashRegex, () => results[index++])
  }
  template = template.trim()

  const taskModel = await (async () => {
    if (command.model) return Provider.parseModel(command.model)
    if (command.agent) {
      const cmdAgent = await Agent.get(command.agent)
      if (cmdAgent?.model) return cmdAgent.model
    }
    if (input.model) return Provider.parseModel(input.model)
    return await lastModel(input.sessionID)
  })()

  try {
    await Provider.getModel(taskModel.providerID, taskModel.modelID)
  } catch (e) {
    if (Provider.ModelNotFoundError.isInstance(e)) {
      const { providerID, modelID, suggestions } = e.data
      const hint = suggestions?.length ? ` Did you mean: ${suggestions.join(", ")}?` : ""
      Bus.publish(Session.Event.Error, {
        sessionID: input.sessionID,
        error: new NamedError.Unknown({ message: `Model not found: ${providerID}/${modelID}.${hint}` }).toObject(),
      })
    }
    throw e
  }
  const agent = await Agent.get(agentName)
  if (!agent) {
    const available = await Agent.list().then((agents) => agents.filter((a) => !a.hidden).map((a) => a.name))
    const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
    const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
    Bus.publish(Session.Event.Error, {
      sessionID: input.sessionID,
      error: error.toObject(),
    })
    throw error
  }

  const templateParts = await resolvePromptParts(template)
  const isSubtask = (agent.mode === "subagent" && command.subtask !== false) || command.subtask === true
  const parts = isSubtask
    ? [
        {
          type: "subtask" as const,
          agent: agent.name,
          description: command.description ?? "",
          command: input.command,
          model: {
            providerID: taskModel.providerID,
            modelID: taskModel.modelID,
          },
          prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
        },
      ]
    : [...templateParts, ...(input.parts ?? [])]

  const userAgent = isSubtask ? (input.agent ?? (await Agent.defaultAgent())) : agentName
  const userModel = isSubtask
    ? input.model
      ? Provider.parseModel(input.model)
      : await lastModel(input.sessionID)
    : taskModel

  await Plugin.trigger(
    "command.execute.before",
    {
      command: input.command,
      sessionID: input.sessionID,
      arguments: input.arguments,
    },
    { parts },
  )

  const result = await prompt({
    sessionID: input.sessionID,
    messageID: input.messageID,
    model: userModel,
    agent: userAgent,
    parts,
    variant: input.variant,
  })

  Bus.publish(Command.Event.Executed, {
    name: input.command,
    sessionID: input.sessionID,
    arguments: input.arguments,
    messageID: result.info.id,
  })

  return result
}
