import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { createSessionRecoveryHook } from "./hook"
import * as detect from "./types"
import * as toolResult from "./recover-tool-result-missing"
import * as unavailable from "./recover-unavailable-tool"
import * as thinkingOrder from "./recover-thinking-block-order"
import * as thinkingDisabled from "./recover-thinking-disabled-violation"
import * as resume from "./resume"
import * as logger from "../../../util/logger"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

function mk(messages: unknown[]) {
  const abort = mock(async () => ({}))
  const showToast = mock(async () => ({}))
  const ctx = {
    directory: "/tmp/project",
    client: {
      session: {
        abort: abort as never,
        messages: mock(async () => ({ data: messages })) as never,
      } as unknown as Parameters<typeof createSessionRecoveryHook>[0]["client"]["session"],
      tui: {
        showToast: showToast as never,
      } as unknown as Parameters<typeof createSessionRecoveryHook>[0]["client"]["tui"],
    } as unknown as Parameters<typeof createSessionRecoveryHook>[0]["client"],
  } as unknown as Parameters<typeof createSessionRecoveryHook>[0]

  return {
    abort,
    showToast,
    ctx,
  }
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("createSessionRecoveryHook", () => {
  it("handles tool_result_missing and fires lifecycle callbacks", async () => {
    const failed = { info: { id: "msg_1", role: "assistant" }, parts: [] }
    const recovered = mock(async () => true)
    const onAbort = mock(() => {})
    const onDone = mock(() => {})

    add(spyOn(detect, "detectErrorType").mockReturnValue("tool_result_missing"))
    add(spyOn(toolResult, "recoverToolResultMissing").mockImplementation(recovered as never))

    const { ctx, abort, showToast } = mk([failed])
    const hook = createSessionRecoveryHook(ctx)
    hook.setOnAbortCallback(onAbort)
    hook.setOnRecoveryCompleteCallback(onDone)

    const res = await hook.handleSessionRecovery({
      id: "msg_1",
      role: "assistant",
      sessionID: "ses_1",
      error: new Error("tool missing"),
    })

    expect(res).toBe(true)
    expect(onAbort).toHaveBeenCalledWith("ses_1")
    expect(abort).toHaveBeenCalledWith({ path: { id: "ses_1" } })
    expect(showToast).toHaveBeenCalledWith({
      body: {
        title: "Tool Crash Recovery",
        message: "Injecting cancelled tool results...",
        variant: "warning",
        duration: 3000,
      },
    })
    expect(recovered).toHaveBeenCalledWith(ctx.client, "ses_1", failed)
    expect(onDone).toHaveBeenCalledWith("ses_1")
  })

  it("auto-resumes after thinking_block_order recovery when enabled", async () => {
    const failed = { info: { id: "msg_1", role: "assistant" }, parts: [] }
    const user = { info: { id: "msg_u", role: "user" }, parts: [{ type: "text", text: "retry" }] }
    const resumeCfg = { sessionID: "ses_1" }
    const recovered = mock(async () => true)
    const resumed = mock(async () => {})

    add(spyOn(detect, "detectErrorType").mockReturnValue("thinking_block_order"))
    add(spyOn(thinkingOrder, "recoverThinkingBlockOrder").mockImplementation(recovered as never))
    add(spyOn(resume, "findLastUserMessage").mockReturnValue(user as never))
    add(spyOn(resume, "extractResumeConfig").mockReturnValue(resumeCfg as never))
    add(spyOn(resume, "resumeSession").mockImplementation(resumed as never))

    const { ctx } = mk([user, failed])
    const hook = createSessionRecoveryHook(ctx, {
      experimental: { auto_resume: true } as never,
    })

    const res = await hook.handleSessionRecovery({
      id: "msg_1",
      role: "assistant",
      sessionID: "ses_1",
      error: new Error("messages.1: thinking block must not be the first block"),
    })

    expect(res).toBe(true)
    expect(recovered).toHaveBeenCalledWith(ctx.client, "ses_1", failed, "/tmp/project", expect.any(Error))
    expect(resumed).toHaveBeenCalledWith(ctx.client, resumeCfg)
  })

  it("recognizes recoverable errors and logs failures from recovery", async () => {
    const failed = { info: { id: "msg_1", role: "assistant" }, parts: [] }
    const log = mock(() => {})

    add(spyOn(detect, "detectErrorType").mockImplementation((err) => {
      if (err === "recoverable") return "unavailable_tool"
      return "thinking_disabled_violation"
    }))
    add(spyOn(thinkingDisabled, "recoverThinkingDisabledViolation").mockImplementation(async () => {
      throw new Error("boom")
    }))
    add(spyOn(unavailable, "recoverUnavailableTool").mockImplementation(mock(async () => true) as never))
    add(spyOn(logger, "log").mockImplementation(log as never))

    const { ctx } = mk([failed])
    const hook = createSessionRecoveryHook(ctx)

    expect(hook.isRecoverableError("recoverable")).toBe(true)

    const res = await hook.handleSessionRecovery({
      id: "msg_1",
      role: "assistant",
      sessionID: "ses_1",
      error: new Error("thinking disabled"),
    })

    expect(res).toBe(false)
    expect(log).toHaveBeenCalledWith("[session-recovery] Recovery failed:", expect.any(Error))
  })
})
