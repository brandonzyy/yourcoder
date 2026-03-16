import type { PluginInput } from "../../plugin/sdk"
import { log } from "../../util/logger"
import { getCachedVersion, getLocalDevVersion } from "./checker"
import type { AutoUpdateCheckerOptions } from "./types"
import { runBackgroundUpdateCheck } from "./hook/background-update-check"
import { showConfigErrorsIfAny } from "./hook/config-errors-toast"
import { updateAndShowConnectedProvidersCacheStatus } from "./hook/connected-providers-status"
import { showModelCacheWarningIfNeeded } from "./hook/model-cache-warning"
import { showLocalDevToast, showVersionToast } from "./hook/startup-toasts"

export function createAutoUpdateCheckerHook(ctx: PluginInput, options: AutoUpdateCheckerOptions = {}) {
  const { showStartupToast = true, isYcEnabled = false, autoUpdate = true } = options
  const isCliRunMode = process.env.YC_CLI_RUN_MODE === "true"

  const getToastMessage = (isUpdate: boolean, latestVersion?: string): string => {
    if (isYcEnabled) {
      return isUpdate
        ? `Yc is steering YourCoder.\nv${latestVersion} available. Restart to apply.`
        : "Yc is steering YourCoder."
    }
    return isUpdate
      ? `OpenCode is now on Steroids. oMoMoMoMo...\nv${latestVersion} available. Restart OpenCode to apply.`
      : "OpenCode is now on Steroids. oMoMoMoMo..."
  }

  let hasChecked = false

  return {
    event: ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.created") return
      if (isCliRunMode) return
      if (hasChecked) return

      const props = event.properties as { info?: { parentID?: string } } | undefined
      if (props?.info?.parentID) return

      hasChecked = true

      setTimeout(async () => {
        const cachedVersion = getCachedVersion()
        const localDevVersion = getLocalDevVersion(ctx.directory)
        const displayVersion = localDevVersion ?? cachedVersion

        await showConfigErrorsIfAny(ctx)
        await updateAndShowConnectedProvidersCacheStatus(ctx)
        await showModelCacheWarningIfNeeded(ctx)

        if (localDevVersion) {
          if (showStartupToast) {
            showLocalDevToast(ctx, displayVersion, isYcEnabled).catch(() => {})
          }
          log("[auto-update-checker] Local development mode")
          return
        }

        if (showStartupToast) {
          showVersionToast(ctx, displayVersion, getToastMessage(false)).catch(() => {})
        }

        runBackgroundUpdateCheck(ctx, autoUpdate, getToastMessage).catch((err) => {
          log("[auto-update-checker] Background update check failed:", err)
        })
      }, 0)
    },
  }
}
