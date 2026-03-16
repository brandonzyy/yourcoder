import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { checkForUpdate } from "./check-for-update"
import * as local from "./local-dev-path"
import * as entry from "./plugin-entry"
import * as cache from "./cached-version"
import * as latest from "./latest-version"
import * as channel from "../version-channel"

const spies: Array<{ mockRestore(): void }> = []

function add<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy)
  return spy
}

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("checkForUpdate", () => {
  it("skips update checks in local dev mode", async () => {
    add(spyOn(local, "isLocalDevMode").mockReturnValue(true))
    add(spyOn(entry, "findPluginEntry").mockReturnValue({
      entry: "yourcoder-plugin",
      isPinned: false,
      pinnedVersion: null,
      configPath: "/tmp/yourcoder.json",
    }))

    const res = await checkForUpdate("/tmp/project")

    expect(res).toEqual({
      needsUpdate: false,
      currentVersion: null,
      latestVersion: null,
      isLocalDev: true,
      isPinned: false,
    })
    expect(entry.findPluginEntry).not.toHaveBeenCalled()
  })

  it("returns no-update when the plugin is missing", async () => {
    add(spyOn(local, "isLocalDevMode").mockReturnValue(false))
    add(spyOn(entry, "findPluginEntry").mockReturnValue(null))

    const res = await checkForUpdate("/tmp/project")

    expect(res).toEqual({
      needsUpdate: false,
      currentVersion: null,
      latestVersion: null,
      isLocalDev: false,
      isPinned: false,
    })
  })

  it("uses cached version, fetches latest by channel, and reports an available update", async () => {
    add(spyOn(local, "isLocalDevMode").mockReturnValue(false))
    add(spyOn(entry, "findPluginEntry").mockReturnValue({
      entry: "yourcoder-plugin@3.4.0",
      isPinned: true,
      pinnedVersion: "3.4.0",
      configPath: "/tmp/yourcoder.json",
    }))
    add(spyOn(cache, "getCachedVersion").mockReturnValue("3.5.0"))
    add(spyOn(channel, "extractChannel").mockReturnValue("latest"))
    add(spyOn(latest, "getLatestVersion").mockResolvedValue("3.6.0"))

    const res = await checkForUpdate("/tmp/project")

    expect(res).toEqual({
      needsUpdate: true,
      currentVersion: "3.5.0",
      latestVersion: "3.6.0",
      isLocalDev: false,
      isPinned: true,
    })
    expect(channel.extractChannel).toHaveBeenCalledWith("3.4.0")
    expect(latest.getLatestVersion).toHaveBeenCalledWith("latest")
  })
})
