import { Log } from "../../util/log"
import { Instance } from "../../project/instance"
import { MessageV2 } from "../message-v2"
import { Session } from ".."
import { SessionStatus } from "../status"

const log = Log.create({ service: "session.prompt" })

const state = Instance.state(
  () => {
    const data: Record<
      string,
      {
        abort: AbortController
        callbacks: {
          resolve(input: MessageV2.WithParts): void
          reject(reason?: any): void
        }[]
      }
    > = {}
    return data
  },
  async (cur) => {
    for (const item of Object.values(cur)) {
      item.abort.abort()
    }
  },
)

export function assertNotBusy(sessionID: string) {
  const match = state()[sessionID]
  if (match) throw new Session.BusyError(sessionID)
}

export function start(sessionID: string) {
  const cur = state()
  if (cur[sessionID]) return
  const ctrl = new AbortController()
  cur[sessionID] = {
    abort: ctrl,
    callbacks: [],
  }
  return ctrl.signal
}

export function resume(sessionID: string) {
  const cur = state()
  if (!cur[sessionID]) return
  return cur[sessionID].abort.signal
}

export function wait(sessionID: string) {
  return new Promise<MessageV2.WithParts>((resolve, reject) => {
    state()[sessionID].callbacks.push({ resolve, reject })
  })
}

export function flush(sessionID: string, msg: MessageV2.WithParts) {
  const queued = state()[sessionID]?.callbacks ?? []
  for (const item of queued) {
    item.resolve(msg)
  }
}

export function queued(sessionID: string) {
  return state()[sessionID]?.callbacks ?? []
}

export function cancel(sessionID: string) {
  log.info("cancel", { sessionID })
  const cur = state()
  const match = cur[sessionID]
  if (!match) {
    SessionStatus.set(sessionID, { type: "idle" })
    return
  }
  match.abort.abort()
  delete cur[sessionID]
  SessionStatus.set(sessionID, { type: "idle" })
}
