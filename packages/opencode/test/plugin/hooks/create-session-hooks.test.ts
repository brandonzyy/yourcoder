import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as hooks from "../../../src/hooks"
import * as effort from "../../../src/hooks/model-switching/anthropic-effort"
import * as logger from "../../../src/util/logger"
import * as detector from "../../../src/plugin/external-plugin-detector"
import { createSessionHooks } from "../../../src/plugin/handlers/hooks/create-session-hooks"

const cw = mock((ctx: unknown, state: unknown) => ({ id: "cw", ctx, state }))
const sr = mock((ctx: unknown, cfg: unknown) => ({ id: "sr", ctx, cfg }))
const rf = mock((ctx: unknown, cfg: unknown) => ({ id: "rf", ctx, cfg }))
const sn = mock((ctx: unknown) => ({ id: "sn", ctx }))
const mf = mock((cfg: unknown) => ({ id: "mf", cfg }))
const ae = mock(() => ({ id: "ae" }))
const lg = mock(() => {})

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

function bind() {
  add(spyOn(hooks, "createContextWindowMonitorHook").mockImplementation(cw as never))
  add(spyOn(hooks, "createSessionRecoveryHook").mockImplementation(sr as never))
  add(spyOn(hooks, "createRuntimeFallbackHook").mockImplementation(rf as never))
  add(spyOn(hooks, "createSessionNotification").mockImplementation(sn as never))
  add(spyOn(hooks, "createModelFallbackHook").mockImplementation(mf as never))
  add(spyOn(effort, "createAnthropicEffortHook").mockImplementation(ae as never))
  const scan = add(spyOn(detector, "detectExternalNotificationPlugin").mockReturnValue({
    detected: false,
    pluginName: null,
    allPlugins: [],
  }))
  add(spyOn(detector, "getNotificationConflictWarning").mockReturnValue("conflict"))
  add(spyOn(logger, "log").mockImplementation(lg as never))
  return { scan }
}

function mk() {
  const ctx = {
    directory: "repo",
    client: {
      tui: { showToast: mock(async () => undefined) },
      session: {
        get: mock(async () => null),
        update: mock(async () => undefined),
      },
    },
  } as unknown as Parameters<typeof createSessionHooks>[0]["ctx"]

  const state = { id: "state" } as unknown as Parameters<typeof createSessionHooks>[0]["modelCacheState"]

  return {
    ctx,
    state,
    cfg: {} as Parameters<typeof createSessionHooks>[0]["pluginConfig"],
  }
}

afterEach(() => {
  while (spies.length > 0) {
    spies.pop()?.mockRestore()
  }
  cw.mockClear()
  sr.mockClear()
  rf.mockClear()
  sn.mockClear()
  mf.mockClear()
  ae.mockClear()
  lg.mockClear()
})

describe("createSessionHooks", () => {
  it("mounts core and guard hooks through the grouped assembly", () => {
    bind()
    const { ctx, state, cfg } = mk()

    const res = createSessionHooks({
      ctx,
      pluginConfig: cfg,
      modelCacheState: state,
      safeHookEnabled: true,
      isHookEnabled: (name) =>
        name === "context-window-monitor" ||
        name === "session-recovery" ||
        name === "runtime-fallback" ||
        name === "anthropic-effort",
    })

    expect(res.contextWindowMonitor as unknown).toEqual({ id: "cw", ctx, state })
    expect(res.sessionRecovery as unknown).toEqual({ id: "sr", ctx, cfg: { experimental: cfg.experimental } })
    expect(res.runtimeFallback as unknown).toEqual({
      id: "rf",
      ctx,
      cfg: { config: cfg.runtime_fallback, pluginConfig: cfg },
    })
    expect(res.anthropicEffort as unknown).toEqual({ id: "ae" })
  })

  it("suppresses session notifications when an external notifier already owns that concern", () => {
    const { scan } = bind()
    const { ctx, state, cfg } = mk()
    scan.mockReturnValue({
      detected: true,
      pluginName: "other-plugin",
      allPlugins: ["other-plugin"],
    })

    const res = createSessionHooks({
      ctx,
      pluginConfig: cfg,
      modelCacheState: state,
      safeHookEnabled: true,
      isHookEnabled: (name) => name === "session-notification",
    })

    expect(res.sessionNotification).toBeNull()
    expect(sn).not.toHaveBeenCalled()
    expect(lg).toHaveBeenCalledWith("conflict")
  })

  it("only builds model fallback when config enables it", () => {
    bind()
    const { ctx, state, cfg } = mk()

    const off = createSessionHooks({
      ctx,
      pluginConfig: cfg,
      modelCacheState: state,
      safeHookEnabled: true,
      isHookEnabled: (name) => name === "model-fallback",
    })

    const on = createSessionHooks({
      ctx,
      pluginConfig: { ...cfg, model_fallback: true },
      modelCacheState: state,
      safeHookEnabled: true,
      isHookEnabled: (name) => name === "model-fallback",
    })

    expect(off.modelFallback).toBeNull()
    expect(on.modelFallback as unknown).toEqual({ id: "mf", cfg: expect.any(Object) })
    expect(mf).toHaveBeenCalledTimes(1)
  })
})
