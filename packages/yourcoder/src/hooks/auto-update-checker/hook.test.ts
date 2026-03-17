import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

const mockGetConfigLoadErrors = mock(() => [] as Array<{ path: string; error: string }>)
const mockClearConfigLoadErrors = mock(() => {})
const mockUpdateConnectedProvidersCache = mock(async () => {})
const mockIsModelCacheAvailable = mock(() => true)
const mockRunBunInstall = mock(async () => true)
const mockInvalidatePackage = mock(() => true)
const mockGetCachedVersion = mock(() => "3.6.0")
const mockGetLocalDevVersion = mock<(directory: string) => string | null>(() => null)
const mockFindPluginEntry = mock(() => null as ReturnType<typeof import("./checker").findPluginEntry>)
const mockGetLatestVersion = mock(async () => null as string | null)
const mockRevertPinnedVersion = mock(() => true)
const mockShowToast = mock(async () => {})

mock.module("../../config/config-errors", () => ({
  getConfigLoadErrors: mockGetConfigLoadErrors,
  clearConfigLoadErrors: mockClearConfigLoadErrors,
}))

mock.module("../../util/connected-providers-cache", () => ({
  updateConnectedProvidersCache: mockUpdateConnectedProvidersCache,
}))

mock.module("../../model/availability", () => ({
  isModelCacheAvailable: mockIsModelCacheAvailable,
}))

mock.module("../../config/config-manager/bun-install", () => ({
  runBunInstall: mockRunBunInstall,
}))

mock.module("./cache", () => ({
  invalidatePackage: mockInvalidatePackage,
}))

mock.module("./checker", () => ({
  getCachedVersion: mockGetCachedVersion,
  getLocalDevVersion: mockGetLocalDevVersion,
  findPluginEntry: mockFindPluginEntry,
  getLatestVersion: mockGetLatestVersion,
  revertPinnedVersion: mockRevertPinnedVersion,
}))

mock.module("../../util/logger", () => ({
  log: () => {},
}))

type HookFactory = typeof import("./hook").createAutoUpdateCheckerHook

async function importFreshHookFactory(): Promise<HookFactory> {
  const hookModule = await import(`./hook?test-${Date.now()}-${Math.random()}`)
  return hookModule.createAutoUpdateCheckerHook
}

function createPluginInput() {
  return {
    directory: "/test",
    client: {
      tui: {
        showToast: mockShowToast,
      },
    },
  } as never
}

beforeEach(() => {
  mockGetConfigLoadErrors.mockClear()
  mockClearConfigLoadErrors.mockClear()
  mockUpdateConnectedProvidersCache.mockClear()
  mockIsModelCacheAvailable.mockClear()
  mockRunBunInstall.mockClear()
  mockInvalidatePackage.mockClear()
  mockGetCachedVersion.mockClear()
  mockGetLocalDevVersion.mockClear()
  mockFindPluginEntry.mockClear()
  mockGetLatestVersion.mockClear()
  mockRevertPinnedVersion.mockClear()
  mockShowToast.mockClear()

  mockGetCachedVersion.mockReturnValue("3.6.0")
  mockGetLocalDevVersion.mockReturnValue(null)
  mockGetConfigLoadErrors.mockReturnValue([])
  mockIsModelCacheAvailable.mockReturnValue(true)
})

afterEach(() => {
  delete process.env.YC_CLI_RUN_MODE
})

describe("createAutoUpdateCheckerHook", () => {
  it("skips startup toasts and checks in CLI run mode", async () => {
    process.env.YC_CLI_RUN_MODE = "true"
    const createAutoUpdateCheckerHook = await importFreshHookFactory()

    const hook = createAutoUpdateCheckerHook(createPluginInput(), {
      showStartupToast: true,
      isYcEnabled: true,
      autoUpdate: true,
    })

    hook.event({
      event: {
        type: "session.created",
        properties: { info: { parentID: undefined } },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockGetConfigLoadErrors).not.toHaveBeenCalled()
    expect(mockIsModelCacheAvailable).not.toHaveBeenCalled()
    expect(mockUpdateConnectedProvidersCache).not.toHaveBeenCalled()
  })

  it("runs all startup checks on normal session.created", async () => {
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput())

    hook.event({
      event: {
        type: "session.created",
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockGetConfigLoadErrors).toHaveBeenCalledTimes(1)
    expect(mockUpdateConnectedProvidersCache).toHaveBeenCalledTimes(1)
  })

  it("ignores subagent sessions (parentID present)", async () => {
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput())

    hook.event({
      event: {
        type: "session.created",
        properties: { info: { parentID: "parent-123" } },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockGetConfigLoadErrors).not.toHaveBeenCalled()
    expect(mockUpdateConnectedProvidersCache).not.toHaveBeenCalled()
  })

  it("runs only once (hasChecked guard)", async () => {
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput())

    hook.event({
      event: {
        type: "session.created",
      },
    })
    hook.event({
      event: {
        type: "session.created",
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockGetConfigLoadErrors).toHaveBeenCalledTimes(1)
    expect(mockUpdateConnectedProvidersCache).toHaveBeenCalledTimes(1)
  })

  it("ignores non-session.created events", async () => {
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput())

    hook.event({
      event: {
        type: "session.deleted",
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockGetConfigLoadErrors).not.toHaveBeenCalled()
    expect(mockUpdateConnectedProvidersCache).not.toHaveBeenCalled()
  })
})
