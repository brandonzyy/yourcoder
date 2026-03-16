import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { YcClient } from "@yourcoder/sdk/v2"
import { CoreAgent } from "./agent/core"
import type { ACPConfig } from "./types"
import "./agent/events"
import "./agent/messages"
import "./agent/prompt"
import "./agent/session"

export namespace ACP {
  export async function init(_: { sdk: YcClient }) {
    return {
      create: (connection: AgentSideConnection, config: ACPConfig) => {
        return new Agent(connection, config)
      },
    }
  }

  export class Agent extends CoreAgent {}
}
