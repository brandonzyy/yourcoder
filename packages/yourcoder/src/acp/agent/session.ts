import type {
  AuthenticateRequest,
  AuthMethod,
  ForkSessionRequest,
  ForkSessionResponse,
  InitializeRequest,
  InitializeResponse,
  ListSessionsRequest,
  ListSessionsResponse,
  LoadSessionRequest,
  NewSessionRequest,
  ResumeSessionRequest,
  ResumeSessionResponse,
  SessionInfo,
  SetSessionModelRequest,
  SetSessionModeRequest,
  SetSessionModeResponse,
} from "@agentclientprotocol/sdk"
import { Agent as AgentModule } from "../../agent/agent"
import { Config } from "../../config/config"
import { Installation } from "../../project/installation"
import { CoreAgent } from "./core"
import { sendUsageUpdate, type ModeOption } from "./shared"
import { format, guard, meta, model, models, select, sort, variants } from "./tool"

declare module "./core" {
  interface CoreAgent {
    initialize(params: InitializeRequest): Promise<InitializeResponse>
    authenticate(params: AuthenticateRequest): Promise<void>
    newSession(params: NewSessionRequest): Promise<any>
    loadSession(params: LoadSessionRequest): Promise<any>
    unstable_listSessions(params: ListSessionsRequest): Promise<ListSessionsResponse>
    unstable_forkSession(params: ForkSessionRequest): Promise<ForkSessionResponse>
    unstable_resumeSession(params: ResumeSessionRequest): Promise<ResumeSessionResponse>
    loadAvailableModes(directory: string): Promise<ModeOption[]>
    resolveModeState(
      directory: string,
      sessionId: string,
    ): Promise<{ availableModes: ModeOption[]; currentModeId?: string }>
    loadSessionMode(params: LoadSessionRequest): Promise<any>
    unstable_setSessionModel(params: SetSessionModelRequest): Promise<{ _meta: ReturnType<typeof meta> }>
    setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse | void>
    cancel(params: { sessionId: string }): Promise<void>
  }
}

async function replay(agent: CoreAgent, sessionId: string, directory: string) {
  const messages = await agent.sdk.session
    .messages(
      {
        sessionID: sessionId,
        directory,
      },
      { throwOnError: true },
    )
    .then((x) => x.data)
    .catch(() => undefined)

  for (const msg of messages ?? []) {
    await agent.processMessage(msg)
  }

  return messages
}

CoreAgent.prototype.initialize = async function (params: InitializeRequest) {
  const authMethod: AuthMethod = {
    description: "Run `yc auth login` in the terminal",
    name: "Login with yourcoder",
    id: "yourcoder-login",
  }

  if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
    authMethod._meta = {
      "terminal-auth": {
        command: "yc",
        args: ["auth", "login"],
        label: "OpenCode Login",
      },
    }
  }

  return {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      mcpCapabilities: {
        http: true,
        sse: true,
      },
      promptCapabilities: {
        embeddedContext: true,
        image: true,
      },
      sessionCapabilities: {
        fork: {},
        list: {},
        resume: {},
      },
    },
    authMethods: [authMethod],
    agentInfo: {
      name: "OpenCode",
      version: Installation.VERSION,
    },
  }
}

CoreAgent.prototype.authenticate = async function (_params: AuthenticateRequest) {
  throw new Error("Authentication not implemented")
}

CoreAgent.prototype.newSession = async function (params: NewSessionRequest) {
  return guard(this.config, async () => {
    const cwd = params.cwd
    const current = await model(this.config, cwd)
    const state = await this.sessionManager.create(cwd, params.mcpServers, current)
    const sessionId = state.id
    const result = await this.loadSessionMode({
      cwd,
      mcpServers: params.mcpServers,
      sessionId,
    })

    return {
      sessionId,
      models: result.models,
      modes: result.modes,
      _meta: result._meta,
    }
  })
}

CoreAgent.prototype.loadSession = async function (params: LoadSessionRequest) {
  return guard(this.config, async () => {
    const cwd = params.cwd
    const sessionId = params.sessionId
    const current = await model(this.config, cwd)
    await this.sessionManager.load(sessionId, cwd, params.mcpServers, current)
    const result = await this.loadSessionMode({
      cwd,
      mcpServers: params.mcpServers,
      sessionId,
    })

    const messages = await replay(this, sessionId, cwd)
    const last = messages?.findLast((m) => m.info.role === "user")?.info
    if (last?.role === "user") {
      result.models.currentModelId = `${last.model.providerID}/${last.model.modelID}`
      this.sessionManager.setModel(sessionId, {
        providerID: last.model.providerID,
        modelID: last.model.modelID,
      })
      if (result.modes?.availableModes.some((entry: ModeOption) => entry.id === last.agent)) {
        result.modes.currentModeId = last.agent
        this.sessionManager.setMode(sessionId, last.agent)
      }
    }

    await sendUsageUpdate(this.connection, this.sdk, sessionId, cwd)
    return result
  })
}

CoreAgent.prototype.unstable_listSessions = async function (params: ListSessionsRequest) {
  return guard(this.config, async () => {
    const cursor = params.cursor ? Number(params.cursor) : undefined
    const limit = 100
    const sessions = await this.sdk.session
      .list(
        {
          directory: params.cwd ?? undefined,
          roots: true,
        },
        { throwOnError: true },
      )
      .then((x) => x.data ?? [])

    const sorted = sessions.toSorted((a, b) => b.time.updated - a.time.updated)
    const filtered = cursor ? sorted.filter((s) => s.time.updated < cursor) : sorted
    const page = filtered.slice(0, limit)
    const items: SessionInfo[] = page.map((session) => ({
      sessionId: session.id,
      cwd: session.directory,
      title: session.title,
      updatedAt: new Date(session.time.updated).toISOString(),
    }))
    const last = page[page.length - 1]
    const next = filtered.length > limit && last ? String(last.time.updated) : undefined
    return next ? { sessions: items, nextCursor: next } : { sessions: items }
  })
}

CoreAgent.prototype.unstable_forkSession = async function (params: ForkSessionRequest) {
  return guard(this.config, async () => {
    const cwd = params.cwd
    const items = params.mcpServers ?? []
    const current = await model(this.config, cwd)
    const forked = await this.sdk.session
      .fork(
        {
          sessionID: params.sessionId,
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((x) => x.data)

    if (!forked) {
      throw new Error("Fork session returned no data")
    }

    const sessionId = forked.id
    await this.sessionManager.load(sessionId, cwd, items, current)
    const result = await this.loadSessionMode({
      cwd,
      mcpServers: items,
      sessionId,
    })
    await replay(this, sessionId, cwd)
    await sendUsageUpdate(this.connection, this.sdk, sessionId, cwd)
    return result
  })
}

CoreAgent.prototype.unstable_resumeSession = async function (params: ResumeSessionRequest) {
  return guard(this.config, async () => {
    const cwd = params.cwd
    const sessionId = params.sessionId
    const items = params.mcpServers ?? []
    const current = await model(this.config, cwd)
    await this.sessionManager.load(sessionId, cwd, items, current)
    const result = await this.loadSessionMode({
      cwd,
      mcpServers: items,
      sessionId,
    })
    await sendUsageUpdate(this.connection, this.sdk, sessionId, cwd)
    return result
  })
}

CoreAgent.prototype.loadAvailableModes = async function (directory: string) {
  const agents = await this.config.sdk.app
    .agents(
      {
        directory,
      },
      { throwOnError: true },
    )
    .then((resp) => resp.data!)

  return agents
    .filter((agent) => agent.mode !== "subagent" && !agent.hidden)
    .map((agent) => ({
      id: agent.name,
      name: agent.name,
      description: agent.description,
    }))
}

CoreAgent.prototype.resolveModeState = async function (directory: string, sessionId: string) {
  const availableModes = await this.loadAvailableModes(directory)
  const current =
    this.sessionManager.get(sessionId).modeId ||
    (await (async () => {
      if (!availableModes.length) return undefined
      const name = await AgentModule.defaultAgent()
      const id = availableModes.find((mode) => mode.name === name)?.id ?? availableModes[0].id
      this.sessionManager.setMode(sessionId, id)
      return id
    })())

  return { availableModes, currentModeId: current }
}

CoreAgent.prototype.loadSessionMode = async function (params: LoadSessionRequest) {
  const cwd = params.cwd
  const current = await model(this.config, cwd)
  const sessionId = params.sessionId
  const providers = await this.sdk.config.providers({ directory: cwd }).then((x) => x.data!.providers)
  const entries = sort(providers)
  const available = variants(entries, current)
  const currentVariant = this.sessionManager.getVariant(sessionId)

  if (currentVariant && !available.includes(currentVariant)) {
    this.sessionManager.setVariant(sessionId, undefined)
  }

  const availableModels = models(entries, { includeVariants: true })
  const state = await this.resolveModeState(cwd, sessionId)
  const modes = state.currentModeId
    ? {
        availableModes: state.availableModes,
        currentModeId: state.currentModeId,
      }
    : undefined

  const commands = await this.config.sdk.command
    .list(
      {
        directory: cwd,
      },
      { throwOnError: true },
    )
    .then((resp) => resp.data!)

  const availableCommands = commands.map((command) => ({
    name: command.name,
    description: command.description ?? "",
  }))
  if (!new Set(availableCommands.map((command) => command.name)).has("compact")) {
    availableCommands.push({
      name: "compact",
      description: "compact the session",
    })
  }

  const mcpServers: Record<string, Config.Mcp> = {}
  for (const server of params.mcpServers) {
    if ("type" in server) {
      mcpServers[server.name] = {
        url: server.url,
        headers: server.headers.reduce<Record<string, string>>((acc, { name, value }) => {
          acc[name] = value
          return acc
        }, {}),
        type: "remote",
      }
      continue
    }

    mcpServers[server.name] = {
      type: "local",
      command: [server.command, ...server.args],
      environment: server.env.reduce<Record<string, string>>((acc, { name, value }) => {
        acc[name] = value
        return acc
      }, {}),
    }
  }

  await Promise.all(
    Object.entries(mcpServers).map(async ([name, config]) => {
      await this.sdk.mcp
        .add(
          {
            directory: cwd,
            name,
            config,
          },
          { throwOnError: true },
        )
        .catch(() => undefined)
    }),
  )

  setTimeout(() => {
    this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands,
      },
    })
  }, 0)

  return {
    sessionId,
    models: {
      currentModelId: format(current, currentVariant, available, true),
      availableModels,
    },
    modes,
    _meta: meta({
      model: current,
      variant: this.sessionManager.getVariant(sessionId),
      available,
    }),
  }
}

CoreAgent.prototype.unstable_setSessionModel = async function (params: SetSessionModelRequest) {
  const session = this.sessionManager.get(params.sessionId)
  const providers = await this.sdk.config
    .providers({ directory: session.cwd }, { throwOnError: true })
    .then((x) => x.data!.providers)

  const next = select(params.modelId, providers)
  this.sessionManager.setModel(session.id, next.model)
  this.sessionManager.setVariant(session.id, next.variant)
  const entries = sort(providers)
  const available = variants(entries, next.model)

  return {
    _meta: meta({
      model: next.model,
      variant: next.variant,
      available,
    }),
  }
}

CoreAgent.prototype.setSessionMode = async function (params: SetSessionModeRequest) {
  const session = this.sessionManager.get(params.sessionId)
  const availableModes = await this.loadAvailableModes(session.cwd)
  if (!availableModes.some((mode) => mode.id === params.modeId)) {
    throw new Error(`Agent not found: ${params.modeId}`)
  }
  this.sessionManager.setMode(params.sessionId, params.modeId)
}

CoreAgent.prototype.cancel = async function (params: { sessionId: string }) {
  const session = this.sessionManager.get(params.sessionId)
  await this.config.sdk.session.abort(
    {
      sessionID: params.sessionId,
      directory: session.cwd,
    },
    { throwOnError: true },
  )
}
