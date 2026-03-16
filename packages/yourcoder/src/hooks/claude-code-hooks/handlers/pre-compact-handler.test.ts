import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { createPreCompactHandler } from "./pre-compact-handler"
import * as cfg from "../config"
import * as ext from "../config-loader"
import * as compact from "../pre-compact"
import * as disabled from "../../shared/hook-disabled"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("createPreCompactHandler", () => {
  it("appends returned context from pre-compact hooks", async () => {
    add(spyOn(disabled, "isHookDisabled").mockReturnValue(false))
    add(spyOn(cfg, "loadClaudeHooksConfig").mockResolvedValue({} as never))
    add(spyOn(ext, "loadPluginExtendedConfig").mockResolvedValue({} as never))
    add(spyOn(compact, "executePreCompactHooks").mockResolvedValue({
      context: ["a", "b"],
      hookName: "hook",
      elapsedMs: 5,
    } as never))

    const out = { context: ["base"] }
    await createPreCompactHandler({ directory: "/tmp/project" } as never, {})(
      { sessionID: "ses_1" },
      out,
    )

    expect(out.context).toEqual(["base", "a", "b"])
  })
})
