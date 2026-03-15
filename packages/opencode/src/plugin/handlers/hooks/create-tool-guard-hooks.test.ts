import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as hooks from "../../../hooks"
import * as shared from "../../shared/opencode-version"
import * as safeHook from "../../shared/safe-create-hook"
import { createToolGuardHooks } from "./create-tool-guard-hooks"

const cc = mock((cfg: unknown) => ({ id: "cc", cfg }))
const tt = mock((ctx: unknown, cfg: unknown) => ({ id: "tt", ctx, cfg }))
const da = mock((ctx: unknown, state: unknown) => ({ id: "da", ctx, state }))
const dr = mock((ctx: unknown, state: unknown) => ({ id: "dr", ctx, state }))
const et = mock((ctx: unknown) => ({ id: "et", ctx }))
const ri = mock((ctx: unknown, state: unknown) => ({ id: "ri", ctx, state }))
const td = mock((cfg: unknown) => ({ id: "td", cfg }))
const we = mock((ctx: unknown) => ({ id: "we", ctx }))
const hr = mock((ctx: unknown, cfg: unknown) => ({ id: "hr", ctx, cfg }))
const jr = mock((ctx: unknown) => ({ id: "jr", ctx }))
const ir = mock((ctx: unknown) => ({ id: "ir", ctx }))
const lg = mock(() => {})

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

function bind() {
  const ver = add(spyOn(shared, "getOpenCodeVersion").mockReturnValue("1.0.0"))
  const min = add(spyOn(shared, "isOpenCodeVersionAtLeast").mockReturnValue(false))
  const safe = add(
    spyOn(safeHook, "safeCreateHook").mockImplementation((_: unknown, fn: () => unknown, opts: { enabled: boolean }) =>
      opts.enabled ? fn() : null,
    ),
  )
  add(spyOn(hooks, "createCommentCheckerHooks").mockImplementation(cc as never))
  add(spyOn(hooks, "createToolOutputTruncatorHook").mockImplementation(tt as never))
  add(spyOn(hooks, "createDirectoryAgentsInjectorHook").mockImplementation(da as never))
  add(spyOn(hooks, "createDirectoryReadmeInjectorHook").mockImplementation(dr as never))
  add(spyOn(hooks, "createEmptyTaskResponseDetectorHook").mockImplementation(et as never))
  add(spyOn(hooks, "createRulesInjectorHook").mockImplementation(ri as never))
  add(spyOn(hooks, "createTasksTodowriteDisablerHook").mockImplementation(td as never))
  add(spyOn(hooks, "createWriteExistingFileGuardHook").mockImplementation(we as never))
  add(spyOn(hooks, "createHashlineReadEnhancerHook").mockImplementation(hr as never))
  add(spyOn(hooks, "createJsonErrorRecoveryHook").mockImplementation(jr as never))
  add(spyOn(hooks, "createReadImageResizerHook").mockImplementation(ir as never))
  add(spyOn(shared, "log").mockImplementation(lg as never))
  return { ver, min, safe }
}

function mk() {
  const ctx = { id: "ctx" } as never
  const cfg = {
    comment_checker: { on: true },
    experimental: { fast: true },
    hashline_edit: true,
  } as never
  const state = { id: "state" } as never

  return {
    ctx,
    cfg,
    state,
    args: {
      ctx,
      pluginConfig: cfg,
      modelCacheState: state,
      isHookEnabled: () => true,
      safeHookEnabled: true,
    },
  }
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
  cc.mockClear()
  tt.mockClear()
  da.mockClear()
  dr.mockClear()
  et.mockClear()
  ri.mockClear()
  td.mockClear()
  we.mockClear()
  hr.mockClear()
  jr.mockClear()
  ir.mockClear()
  lg.mockClear()
})

describe("createToolGuardHooks", () => {
  it("builds enabled hook factories with the expected inputs", () => {
    bind()
    const { ctx, cfg, state, args } = mk()

    const res = createToolGuardHooks(args)

    expect(res.commentChecker).toEqual({ id: "cc", cfg: cfg.comment_checker })
    expect(res.toolOutputTruncator).toEqual({
      id: "tt",
      ctx,
      cfg: { modelCacheState: state, experimental: cfg.experimental },
    })
    expect(res.directoryAgentsInjector).toEqual({ id: "da", ctx, state })
    expect(res.hashlineReadEnhancer).toEqual({
      id: "hr",
      ctx,
      cfg: { hashline_edit: { enabled: true } },
    })
    expect(res.readImageResizer).toEqual({ id: "ir", ctx })
    expect(ri).toHaveBeenCalledWith(ctx, state)
    expect(td).toHaveBeenCalledWith({ experimental: cfg.experimental })
    expect(we).toHaveBeenCalledWith(ctx)
  })

  it("auto-disables directory agents when native support exists", () => {
    const { ver, min } = bind()
    ver.mockReturnValue("1.3.0")
    min.mockReturnValue(true)

    const { args } = mk()
    const res = createToolGuardHooks(args)

    expect(res.directoryAgentsInjector).toBeNull()
    expect(da).not.toHaveBeenCalled()
    expect(lg).toHaveBeenCalledWith(
      "directory-agents-injector auto-disabled due to native OpenCode support",
      {
        currentVersion: "1.3.0",
        nativeVersion: shared.OPENCODE_NATIVE_AGENTS_INJECTION_VERSION,
      },
    )
  })

  it("returns null hooks when safe creation is disabled", () => {
    const { safe } = bind()
    safe.mockImplementation((_: unknown, _fn: () => unknown) => null)

    const { args } = mk()
    const res = createToolGuardHooks({
      ...args,
      safeHookEnabled: false,
      isHookEnabled: (name) => name === "comment-checker" || name === "tool-output-truncator",
    })

    expect(res.commentChecker).toBeNull()
    expect(res.toolOutputTruncator).toBeNull()
    expect(cc).not.toHaveBeenCalled()
    expect(tt).not.toHaveBeenCalled()
  })
})
