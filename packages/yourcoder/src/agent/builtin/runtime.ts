import type { ToolDefinition } from "../../plugin/sdk"
import type { PluginInput } from "../../plugin/sdk"
import { BackgroundManager } from "../../agent/background"
import { createDelegateTask } from "../../tool/delegate-task"

export function loadBuiltinRuntime(input: Pick<PluginInput, "client" | "directory">): {
  manager: BackgroundManager
  tools: Record<string, ToolDefinition>
} {
  const manager = new BackgroundManager(input as PluginInput, { defaultConcurrency: 5 })
  return {
    manager,
    tools: {
      task: createDelegateTask({
        manager,
        client: input.client,
        directory: input.directory,
      }),
    },
  }
}
