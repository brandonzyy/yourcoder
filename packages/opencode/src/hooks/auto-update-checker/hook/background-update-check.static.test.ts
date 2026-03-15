import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { runBackgroundUpdateCheck } from "./background-update-check"
import * as checker from "../checker"
import * as version from "../version-channel"
import * as cache from "../cache"
import * as config from "../../../config/config-manager"
import * as toasts from "./update-toasts"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("runBackgroundUpdateCheck", () => {
  const ctx = { directory: "/tmp/project" } as never
  const msg = (isUpdate: boolean, next?: string) => isUpdate ? `update ${next}` : "ok"

  it("shows a pinned-version notification without auto-updating", async () => {
    const notify = mock(async () => {})

    add(spyOn(checker, "findPluginEntry").mockReturnValue({
      entry: "oh-my-opencode@3.4.0",
      isPinned: true,
      pinnedVersion: "3.4.0",
      configPath: "/tmp/opencode.json",
    }))
    add(spyOn(checker, "getCachedVersion").mockReturnValue("3.4.0"))
    add(spyOn(version, "extractChannel").mockReturnValue("latest"))
    add(spyOn(checker, "getLatestVersion").mockResolvedValue("3.5.0"))
    add(spyOn(toasts, "showUpdateAvailableToast").mockImplementation(notify as never))
    add(spyOn(config, "runBunInstall").mockImplementation(mock(async () => true) as never))

    await runBackgroundUpdateCheck(ctx, true, msg)

    expect(notify).toHaveBeenCalledTimes(1)
    expect(config.runBunInstall).not.toHaveBeenCalled()
  })

  it("installs updates and shows auto-updated toast when auto-update succeeds", async () => {
    const updated = mock(async () => {})
    const install = mock(async () => true)
    const invalidate = mock(() => {})

    add(spyOn(checker, "findPluginEntry").mockReturnValue({
      entry: "oh-my-opencode@3.4.0",
      isPinned: false,
      pinnedVersion: null,
      configPath: "/tmp/opencode.json",
    }))
    add(spyOn(checker, "getCachedVersion").mockReturnValue("3.4.0"))
    add(spyOn(version, "extractChannel").mockReturnValue("latest"))
    add(spyOn(checker, "getLatestVersion").mockResolvedValue("3.5.0"))
    add(spyOn(cache, "invalidatePackage").mockImplementation(invalidate))
    add(spyOn(config, "runBunInstall").mockImplementation(install as never))
    add(spyOn(toasts, "showAutoUpdatedToast").mockImplementation(updated as never))

    await runBackgroundUpdateCheck(ctx, true, msg)

    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledTimes(1)
    expect(updated).toHaveBeenCalledWith(ctx, "3.4.0", "3.5.0")
  })
})
