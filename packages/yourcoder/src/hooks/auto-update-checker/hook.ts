import type { PluginInput } from "../../plugin/sdk"
import { runBunInstall } from "../../config/config-manager/bun-install"
import { getConfigLoadErrors, clearConfigLoadErrors } from "../../config/config-errors"
import { updateConnectedProvidersCache } from "../../util/connected-providers-cache"
import { isModelCacheAvailable } from "../../model/availability"
import { log } from "../../util/logger"
import { invalidatePackage } from "./cache"
import { PACKAGE_NAME } from "./constants"
import { extractChannel } from "./version-channel"
import {
  getCachedVersion,
  getLocalDevVersion,
  findPluginEntry,
  getLatestVersion,
  revertPinnedVersion,
} from "./checker"
import type { AutoUpdateCheckerOptions } from "./types"

// --- Spinner toast ---

const SISYPHUS_SPINNER = ["·", "•", "●", "○", "◌", "◦", " "]

async function showSpinnerToast(ctx: PluginInput, version: string, message: string): Promise<void> {
  const totalDuration = 5000
  const frameInterval = 100
  const totalFrames = Math.floor(totalDuration / frameInterval)

  for (let i = 0; i < totalFrames; i++) {
    const spinner = SISYPHUS_SPINNER[i % SISYPHUS_SPINNER.length]
    await ctx.client.tui
      .showToast({
        body: {
          title: `${spinner} OpenCode ${version}`,
          message,
          variant: "info" as const,
          duration: frameInterval + 50,
        },
      })
      .catch(() => {})

    await new Promise((resolve) => setTimeout(resolve, frameInterval))
  }
}

// --- Startup toasts ---

export async function showVersionToast(ctx: PluginInput, version: string | null, message: string): Promise<void> {
  const displayVersion = version ?? "unknown"
  await showSpinnerToast(ctx, displayVersion, message)
  log(`[auto-update-checker] Startup toast shown: v${displayVersion}`)
}

async function showLocalDevToast(
  ctx: PluginInput,
  version: string | null,
  isYcEnabled: boolean
): Promise<void> {
  const displayVersion = version ?? "dev"
  const message = isYcEnabled
    ? "Yc running in local development mode."
    : "Running in local development mode. oMoMoMo..."
  await showSpinnerToast(ctx, `${displayVersion} (dev)`, message)
  log(`[auto-update-checker] Local dev toast shown: v${displayVersion}`)
}

// --- Update toasts ---

async function showUpdateAvailableToast(
  ctx: PluginInput,
  latestVersion: string,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string
): Promise<void> {
  await ctx.client.tui
    .showToast({
      body: {
        title: `OpenCode ${latestVersion}`,
        message: getToastMessage(true, latestVersion),
        variant: "info" as const,
        duration: 8000,
      },
    })
    .catch(() => {})
  log(`[auto-update-checker] Update available toast shown: v${latestVersion}`)
}

async function showAutoUpdatedToast(ctx: PluginInput, oldVersion: string, newVersion: string): Promise<void> {
  await ctx.client.tui
    .showToast({
      body: {
        title: "OpenCode Updated!",
        message: `v${oldVersion} → v${newVersion}\nRestart OpenCode to apply.`,
        variant: "success" as const,
        duration: 8000,
      },
    })
    .catch(() => {})
  log(`[auto-update-checker] Auto-updated toast shown: v${oldVersion} → v${newVersion}`)
}

// --- Config errors toast ---

async function showConfigErrorsIfAny(ctx: PluginInput): Promise<void> {
  const errors = getConfigLoadErrors()
  if (errors.length === 0) return

  const errorMessages = errors.map((error: { path: string; error: string }) => `${error.path}: ${error.error}`).join("\n")
  await ctx.client.tui
    .showToast({
      body: {
        title: "Config Load Error",
        message: `Failed to load config:\n${errorMessages}`,
        variant: "error" as const,
        duration: 10000,
      },
    })
    .catch(() => {})

  log(`[auto-update-checker] Config load errors shown: ${errors.length} error(s)`)
  clearConfigLoadErrors()
}

// --- Connected providers status ---

const CACHE_UPDATE_TIMEOUT_MS = 10000

async function updateAndShowConnectedProvidersCacheStatus(ctx: PluginInput): Promise<void> {
  const hadCache = isModelCacheAvailable()

  if (!hadCache) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        updateConnectedProvidersCache(ctx.client),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("Cache update timed out")), CACHE_UPDATE_TIMEOUT_MS)
        }),
      ])
    } catch (err) {
      log("[auto-update-checker] Connected providers cache creation failed", { error: String(err) })
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }

    if (!isModelCacheAvailable()) {
      await ctx.client.tui
        .showToast({
          body: {
            title: "Connected Providers Cache",
            message: "Failed to build provider cache. Restart OpenCode to retry.",
            variant: "warning" as const,
            duration: 8000,
          },
        })
        .catch(() => {})

      log("[auto-update-checker] Connected providers cache toast shown (creation failed)")
    } else {
      log("[auto-update-checker] Connected providers cache created on first run")
    }
  } else {
    updateConnectedProvidersCache(ctx.client).catch((err) => {
      log("[auto-update-checker] Background cache update failed", { error: String(err) })
    })
    log("[auto-update-checker] Connected providers cache exists, updating in background")
  }
}

// --- Model cache warning ---

async function showModelCacheWarningIfNeeded(ctx: PluginInput): Promise<void> {
  if (isModelCacheAvailable()) return

  await ctx.client.tui
    .showToast({
      body: {
        title: "Model Cache Not Found",
        message:
          "Run 'opencode models --refresh' or restart OpenCode to populate the models cache for optimal agent model selection.",
        variant: "warning" as const,
        duration: 10000,
      },
    })
    .catch(() => {})

  log("[auto-update-checker] Model cache warning shown")
}

// --- Background update check ---

function getPinnedVersionToastMessage(latestVersion: string): string {
  return `Update available: ${latestVersion} (version pinned, update manually)`
}

async function runBunInstallSafe(): Promise<boolean> {
  try {
    return await runBunInstall()
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    log("[auto-update-checker] bun install error:", errorMessage)
    return false
  }
}

async function runBackgroundUpdateCheck(
  ctx: PluginInput,
  autoUpdate: boolean,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string
): Promise<void> {
  const pluginInfo = findPluginEntry(ctx.directory)
  if (!pluginInfo) {
    log("[auto-update-checker] Plugin not found in config")
    return
  }

  const cachedVersion = getCachedVersion()
  const currentVersion = cachedVersion ?? pluginInfo.pinnedVersion
  if (!currentVersion) {
    log("[auto-update-checker] No version found (cached or pinned)")
    return
  }

  const channel = extractChannel(pluginInfo.pinnedVersion ?? currentVersion)
  const latestVersion = await getLatestVersion(channel)
  if (!latestVersion) {
    log("[auto-update-checker] Failed to fetch latest version for channel:", channel)
    return
  }

  if (currentVersion === latestVersion) {
    log("[auto-update-checker] Already on latest version for channel:", channel)
    return
  }

  log(`[auto-update-checker] Update available (${channel}): ${currentVersion} → ${latestVersion}`)

  if (!autoUpdate) {
    await showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
    log("[auto-update-checker] Auto-update disabled, notification only")
    return
  }

  if (pluginInfo.isPinned) {
    await showUpdateAvailableToast(ctx, latestVersion, () => getPinnedVersionToastMessage(latestVersion))
    log(`[auto-update-checker] User-pinned version detected (${pluginInfo.entry}), skipping auto-update. Notification only.`)
    return
  }

  invalidatePackage(PACKAGE_NAME)

  const installSuccess = await runBunInstallSafe()

  if (installSuccess) {
    await showAutoUpdatedToast(ctx, currentVersion, latestVersion)
    log(`[auto-update-checker] Update installed: ${currentVersion} → ${latestVersion}`)
    return
  }

  if (pluginInfo.isPinned) {
    revertPinnedVersion(pluginInfo.configPath, latestVersion, pluginInfo.entry)
    log("[auto-update-checker] Config reverted due to install failure")
  }

  await showUpdateAvailableToast(ctx, latestVersion, getToastMessage)
  log("[auto-update-checker] bun install failed; update not installed (falling back to notification-only)")
}

// --- Main hook ---

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
