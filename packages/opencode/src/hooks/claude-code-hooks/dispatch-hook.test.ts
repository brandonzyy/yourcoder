import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { dispatchHook, getHookIdentifier } from "./dispatch-hook"
import * as shared from "../../shared"
import * as http from "./execute-http-hook"
import { DEFAULT_CONFIG } from "./plugin-config"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("dispatch-hook", () => {
  it("builds hook identifiers for command and http hooks", () => {
    expect(getHookIdentifier({ type: "http", url: "https://hook.test/pre" })).toBe("https://hook.test/pre")
    expect(getHookIdentifier({ type: "command", command: "/tmp/bin/pre-tool.sh" })).toBe("pre-tool.sh")
  })

  it("dispatches http hooks through executeHttpHook", async () => {
    const exec = mock(async () => ({ exitCode: 0, stdout: "ok" }))
    add(spyOn(http, "executeHttpHook").mockImplementation(exec as never))

    const res = await dispatchHook(
      { type: "http", url: "https://hook.test/pre" },
      "{\"a\":1}",
      "/tmp/project",
    )

    expect(res).toEqual({ exitCode: 0, stdout: "ok" })
    expect(exec).toHaveBeenCalledWith({ type: "http", url: "https://hook.test/pre" }, "{\"a\":1}")
  })

  it("dispatches command hooks through executeHookCommand with plugin defaults", async () => {
    const exec = mock(async () => ({ exitCode: 0, stdout: "ok" }))
    add(spyOn(shared, "executeHookCommand").mockImplementation(exec as never))

    const res = await dispatchHook(
      { type: "command", command: "echo hi" },
      "{\"a\":1}",
      "/tmp/project",
    )

    expect(res).toEqual({ exitCode: 0, stdout: "ok" })
    expect(exec).toHaveBeenCalledWith(
      "echo hi",
      "{\"a\":1}",
      "/tmp/project",
      { forceZsh: DEFAULT_CONFIG.forceZsh, zshPath: DEFAULT_CONFIG.zshPath },
    )
  })
})
