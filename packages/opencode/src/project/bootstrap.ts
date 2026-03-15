import { Plugin } from "../plugin"
import { Format } from "../file/format"
import { LSP } from "../lsp"
import { FileWatcher } from "../file/watcher"
import { File } from "../file"
import { Project } from "./project"
import { Bus } from "../util/bus"
import { Command } from "../session/command"
import { Instance } from "./instance"
import { Vcs } from "./vcs"
import { Log } from "@/util/log"
import { ShareNext } from "@/session/share/share-next"
import { Snapshot } from "./snapshot"
import { Truncate } from "../tool/truncation"
import { ToolRegistry } from "../tool/registry"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { Server } from "../server/server"

export async function InstanceBootstrap() {
  Log.Default.info("bootstrapping", { directory: Instance.directory })
  await Plugin.init()
  ShareNext.init()
  Format.init()
  await LSP.init()
  FileWatcher.init()
  File.init()
  Vcs.init()
  Snapshot.init()
  Truncate.init()

  // Register native builtin tools (delegate-task, etc.)
  try {
    const { BuiltinAgentRegistry } = await import("../agent/builtin")
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
      directory: Instance.directory,
      // @ts-ignore - fetch type incompatibility
      fetch: async (...args) => Server.App().fetch(...args),
    })
    const { tools } = await BuiltinAgentRegistry.load({} as any, client, Instance.directory)

    for (const [id, def] of Object.entries(tools)) {
      await ToolRegistry.register({
        id,
        init: async (initCtx) => {
          // Import zod for schema
          const z = await import("zod").then(m => m.default)

          return {
            parameters: (def as any).args ? z.object((def as any).args) : z.object({}),
            description: def.description,
            execute: async (args, ctx) => {
              const result = await def.execute(args as any, ctx as any)
              return {
                title: "",
                output: result,
                metadata: {},
              }
            },
          }
        },
      })
      Log.Default.info("registered builtin tool", { id })
    }
  } catch (error) {
    Log.Default.error("Failed to register builtin tools", { error })
  }

  Bus.subscribe(Command.Event.Executed, async (payload) => {
    if (payload.properties.name === Command.Default.INIT) {
      await Project.setInitialized(Instance.project.id)
    }
  })
}
