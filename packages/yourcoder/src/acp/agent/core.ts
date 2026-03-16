import type { AgentSideConnection, PermissionOption } from "@agentclientprotocol/sdk"
import type { YcClient } from "@yourcoder/sdk/v2"
import { ACPSessionManager } from "../session"
import type { ACPConfig } from "../types"

export class CoreAgent {
  connection: AgentSideConnection
  config: ACPConfig
  sdk: YcClient
  sessionManager: ACPSessionManager
  eventAbort = new AbortController()
  eventStarted = false
  bashSnapshots = new Map<string, string>()
  toolStarts = new Set<string>()
  permissionQueues = new Map<string, Promise<void>>()
  permissionOptions: PermissionOption[] = [
    { optionId: "once", kind: "allow_once", name: "Allow once" },
    { optionId: "always", kind: "allow_always", name: "Always allow" },
    { optionId: "reject", kind: "reject_once", name: "Reject" },
  ]

  constructor(connection: AgentSideConnection, config: ACPConfig) {
    this.connection = connection
    this.config = config
    this.sdk = config.sdk
    this.sessionManager = new ACPSessionManager(this.sdk)
    this.startEventSubscription()
  }
}
