import { describe, expect, it } from "bun:test"
import { createNonInteractiveEnvHook } from "./non-interactive-env-hook"

describe("createNonInteractiveEnvHook", () => {
  it("prepends non-interactive env vars to git commands", async () => {
    const out: { args: Record<string, unknown>; message?: string } = {
      args: { command: "git commit -m 'msg'" },
    }

    await createNonInteractiveEnvHook({} as never)["tool.execute.before"](
      { tool: "bash", sessionID: "ses-1", callID: "call-1" },
      out,
    )

    expect(out.args.command).toBeString()
    expect(out.args.command as string).toStartWith("export ")
    expect(out.args.command as string).toContain("GIT_EDITOR=:")
    expect(out.args.command as string).toContain("; git commit -m 'msg'")
  })

  it("warns on banned interactive commands", async () => {
    const out: { args: Record<string, unknown>; message?: string } = {
      args: { command: "vim notes.txt" },
    }

    await createNonInteractiveEnvHook({} as never)["tool.execute.before"](
      { tool: "bash", sessionID: "ses-2", callID: "call-2" },
      out,
    )

    expect(out.message).toContain("vim")
    expect(out.message).toContain("interactive")
  })
})
