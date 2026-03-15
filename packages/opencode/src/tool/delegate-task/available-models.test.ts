import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { getAvailableModelsForDelegateTask } from "./available-models"
import * as cache from "../../shared/connected-providers-cache"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("getAvailableModelsForDelegateTask", () => {
  it("uses provider model cache when present", async () => {
    add(spyOn(cache, "readProviderModelsCache").mockReturnValue({
      connected: ["openai"],
      models: {
        openai: ["gpt-5.4", { id: "gpt-5-mini" }],
        anthropic: ["claude-sonnet-4"],
      },
    } as never))

    const res = await getAvailableModelsForDelegateTask({} as never)

    expect([...res].sort()).toEqual(["openai/gpt-5-mini", "openai/gpt-5.4"])
  })

  it("falls back to client.model.list filtered by connected providers", async () => {
    add(spyOn(cache, "readProviderModelsCache").mockReturnValue(null))
    add(spyOn(cache, "readConnectedProvidersCache").mockReturnValue(["anthropic"]))

    const res = await getAvailableModelsForDelegateTask({
      model: {
        list: mock(async () => ({
          data: [
            { provider: "anthropic", id: "claude-sonnet-4" },
            { provider: "openai", id: "gpt-5.4" },
          ],
        })),
      },
    } as never)

    expect([...res]).toEqual(["anthropic/claude-sonnet-4"])
  })
})
