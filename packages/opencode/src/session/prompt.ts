// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

import { fn } from "@/util/fn"
import { SessionRevert } from "./revert"
import { Session } from "."
import { PermissionNext } from "@/permission/next"
import { createUserMessage } from "./prompt/user-message"
import { lastModel } from "./prompt/last-model"
import { assertNotBusy as assertNotBusyImpl, cancel as cancelImpl } from "./prompt/state"
import {
  CommandInput as CommandInputImpl,
  LoopInput as LoopInputImpl,
  PromptInput as PromptInputImpl,
  ShellInput as ShellInputImpl,
} from "./prompt/schema"
import { resolvePromptParts as resolvePromptPartsImpl } from "./prompt/resolve-prompt-parts"
import { createStructuredOutputTool as createStructuredOutputToolImpl } from "./prompt/structured-output"
import { loop as loopImpl } from "./prompt/loop"
import { shell as shellImpl } from "./prompt/shell"
import { command as commandImpl } from "./prompt/command"

export namespace SessionPrompt {
  export const PromptInput = PromptInputImpl
  export type PromptInput = typeof PromptInput._output

  export const LoopInput = LoopInputImpl
  export type LoopInput = typeof LoopInput._output

  export const ShellInput = ShellInputImpl
  export type ShellInput = typeof ShellInput._output

  export const CommandInput = CommandInputImpl
  export type CommandInput = typeof CommandInput._output

  export const assertNotBusy = assertNotBusyImpl
  export const cancel = cancelImpl
  export const resolvePromptParts = resolvePromptPartsImpl
  export const createStructuredOutputTool = createStructuredOutputToolImpl

  export const prompt = fn(PromptInput, async (input) => {
    const session = await Session.get(input.sessionID)
    await SessionRevert.cleanup(session)

    const message = await createUserMessage(input, lastModel)
    await Session.touch(input.sessionID)

    const permissions: PermissionNext.Ruleset = []
    for (const [tool, enabled] of Object.entries(input.tools ?? {})) {
      permissions.push({
        permission: tool,
        action: enabled ? "allow" : "deny",
        pattern: "*",
      })
    }
    if (permissions.length > 0) {
      session.permission = permissions
      await Session.setPermission({ sessionID: session.id, permission: permissions })
    }

    if (input.noReply === true) {
      return message
    }

    return loop({ sessionID: input.sessionID })
  })

  export const loop = fn(LoopInput, loopImpl)
  export async function shell(input: ShellInput) {
    return shellImpl(input, loop)
  }

  export async function command(input: CommandInput) {
    return commandImpl(input, prompt)
  }
}
