import path from "path"
import { spawn } from "child_process"
import { ulid } from "ulid"
import { defer } from "../../util/defer"
import { Identifier } from "../../util/id"
import { MessageV2 } from "../message-v2"
import { Session } from ".."
import { SessionRevert } from "../revert"
import { Agent } from "../../agent/agent"
import { Instance } from "../../project/instance"
import { Shell } from "../../util/shell"
import { Plugin } from "../../plugin"
import { Log } from "../../util/log"
import type { LoopInput, ShellInput } from "./schema"
import { start, cancel, queued } from "./state"
import { lastModel } from "./last-model"

const log = Log.create({ service: "session.prompt" })

export async function shell(input: ShellInput, loop: (input: LoopInput) => Promise<MessageV2.WithParts>) {
  const abort = start(input.sessionID)
  if (!abort) {
    throw new Session.BusyError(input.sessionID)
  }

  using _ = defer(() => {
    if (queued(input.sessionID).length === 0) {
      cancel(input.sessionID)
      return
    }
    loop({ sessionID: input.sessionID, resume_existing: true }).catch((error) => {
      log.error("session loop failed to resume after shell command", { sessionID: input.sessionID, error })
    })
  })

  const session = await Session.get(input.sessionID)
  if (session.revert) {
    await SessionRevert.cleanup(session)
  }
  const agent = await Agent.get(input.agent)
  const model = input.model ?? agent.model ?? (await lastModel(input.sessionID))
  const userMsg: MessageV2.User = {
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    time: {
      created: Date.now(),
    },
    role: "user",
    agent: input.agent,
    model: {
      providerID: model.providerID,
      modelID: model.modelID,
    },
  }
  await Session.updateMessage(userMsg)
  const userPart: MessageV2.Part = {
    type: "text",
    id: Identifier.ascending("part"),
    messageID: userMsg.id,
    sessionID: input.sessionID,
    text: "The following tool was executed by the user",
    synthetic: true,
  }
  await Session.updatePart(userPart)

  const msg: MessageV2.Assistant = {
    id: Identifier.ascending("message"),
    sessionID: input.sessionID,
    parentID: userMsg.id,
    mode: input.agent,
    agent: input.agent,
    cost: 0,
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    time: {
      created: Date.now(),
    },
    role: "assistant",
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: model.modelID,
    providerID: model.providerID,
  }
  await Session.updateMessage(msg)
  const part: MessageV2.Part = {
    type: "tool",
    id: Identifier.ascending("part"),
    messageID: msg.id,
    sessionID: input.sessionID,
    tool: "bash",
    callID: ulid(),
    state: {
      status: "running",
      time: {
        start: Date.now(),
      },
      input: {
        command: input.command,
      },
    },
  }
  await Session.updatePart(part)
  const shell = Shell.preferred()
  const shellName = (
    process.platform === "win32" ? path.win32.basename(shell, ".exe") : path.basename(shell)
  ).toLowerCase()

  const invocations: Record<string, { args: string[] }> = {
    nu: { args: ["-c", input.command] },
    fish: { args: ["-c", input.command] },
    zsh: {
      args: [
        "-c",
        "-l",
        `
            [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
            [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
      ],
    },
    bash: {
      args: [
        "-c",
        "-l",
        `
            shopt -s expand_aliases
            [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
            eval ${JSON.stringify(input.command)}
          `,
      ],
    },
    cmd: { args: ["/c", input.command] },
    powershell: { args: ["-NoProfile", "-Command", input.command] },
    pwsh: { args: ["-NoProfile", "-Command", input.command] },
    "": { args: ["-c", `${input.command}`] },
  }

  const args = (invocations[shellName] ?? invocations[""]).args
  const cwd = Instance.directory
  const shellEnv = await Plugin.trigger(
    "shell.env",
    { cwd, sessionID: input.sessionID, callID: part.callID },
    { env: {} },
  )
  const proc = spawn(shell, args, {
    cwd,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...shellEnv.env,
      TERM: "dumb",
    },
  })

  let output = ""
  proc.stdout?.on("data", (chunk) => {
    output += chunk.toString()
    if (part.state.status === "running") {
      part.state.metadata = { output, description: "" }
      Session.updatePart(part)
    }
  })
  proc.stderr?.on("data", (chunk) => {
    output += chunk.toString()
    if (part.state.status === "running") {
      part.state.metadata = { output, description: "" }
      Session.updatePart(part)
    }
  })

  let aborted = false
  let exited = false
  const kill = () => Shell.killTree(proc, { exited: () => exited })

  if (abort.aborted) {
    aborted = true
    await kill()
  }

  const abortHandler = () => {
    aborted = true
    void kill()
  }

  abort.addEventListener("abort", abortHandler, { once: true })
  await new Promise<void>((resolve) => {
    proc.on("close", () => {
      exited = true
      abort.removeEventListener("abort", abortHandler)
      resolve()
    })
  })

  if (aborted) {
    output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
  }
  msg.time.completed = Date.now()
  await Session.updateMessage(msg)
  if (part.state.status === "running") {
    part.state = {
      status: "completed",
      time: {
        ...part.state.time,
        end: Date.now(),
      },
      input: part.state.input,
      title: "",
      metadata: {
        output,
        description: "",
      },
      output,
    }
    await Session.updatePart(part)
  }
  return { info: msg, parts: [part] }
}
