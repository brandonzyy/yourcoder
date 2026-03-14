import type { PluginInput } from "@opencode-ai/plugin"
import { platform } from "os"

// ── Types ──

export type Platform = "darwin" | "linux" | "win32" | "unsupported"

type SessionNotificationConfig = {
  title: string
  message: string
  playSound: boolean
  soundPath: string
  idleConfirmationDelay: number
  skipIfIncompleteTodos: boolean
  maxTrackedSessions: number
  /** Grace period in ms to ignore late-arriving activity events after scheduling (default: 100) */
  activityGracePeriodMs?: number
}

// ── Formatting ──

export function escapeAppleScriptText(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

export function escapePowerShellSingleQuotedText(input: string): string {
  return input.replace(/'/g, "''")
}

export function buildWindowsToastScript(title: string, message: string): string {
  const psTitle = escapePowerShellSingleQuotedText(title)
  const psMessage = escapePowerShellSingleQuotedText(message)

  return `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$Template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$RawXml = [xml] $Template.GetXml()
($RawXml.toast.visual.binding.text | Where-Object {$_.id -eq '1'}).AppendChild($RawXml.CreateTextNode('${psTitle}')) | Out-Null
($RawXml.toast.visual.binding.text | Where-Object {$_.id -eq '2'}).AppendChild($RawXml.CreateTextNode('${psMessage}')) | Out-Null
$SerializedXml = New-Object Windows.Data.Xml.Dom.XmlDocument
$SerializedXml.LoadXml($RawXml.OuterXml)
$Toast = [Windows.UI.Notifications.ToastNotification]::new($SerializedXml)
$Notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('OpenCode')
$Notifier.Show($Toast)
`.trim().replace(/\n/g, "; ")
}

// ── Command finders (utils) ──

async function findCommand(commandName: string): Promise<string | null> {
  try {
    return Bun.which(commandName)
  } catch {
    return null
  }
}

function createCommandFinder(commandName: string): () => Promise<string | null> {
  let cachedPath: string | null = null
  let pending: Promise<string | null> | null = null

  return async () => {
    if (cachedPath !== null) return cachedPath
    if (pending) return pending

    pending = (async () => {
      const path = await findCommand(commandName)
      cachedPath = path
      return path
    })()

    return pending
  }
}

const getNotifySendPath = createCommandFinder("notify-send")
const getOsascriptPath = createCommandFinder("osascript")
const getPowershellPath = createCommandFinder("powershell")
const getAfplayPath = createCommandFinder("afplay")
const getPaplayPath = createCommandFinder("paplay")
const getAplayPath = createCommandFinder("aplay")
const getTerminalNotifierPath = createCommandFinder("terminal-notifier")

export function startBackgroundCheck(platform: Platform): void {
  if (platform === "darwin") {
    getOsascriptPath().catch(() => {})
    getAfplayPath().catch(() => {})
    getTerminalNotifierPath().catch(() => {})
  } else if (platform === "linux") {
    getNotifySendPath().catch(() => {})
    getPaplayPath().catch(() => {})
    getAplayPath().catch(() => {})
  } else if (platform === "win32") {
    getPowershellPath().catch(() => {})
  }
}

// ── Sender ──

export function detectPlatform(): Platform {
  const detected = platform()
  if (detected === "darwin" || detected === "linux" || detected === "win32") return detected
  return "unsupported"
}

export function getDefaultSoundPath(p: Platform): string {
  switch (p) {
    case "darwin":
      return "/System/Library/Sounds/Glass.aiff"
    case "linux":
      return "/usr/share/sounds/freedesktop/stereo/complete.oga"
    case "win32":
      return "C:\\Windows\\Media\\notify.wav"
    default:
      return ""
  }
}

export async function sendSessionNotification(
  ctx: PluginInput,
  p: Platform,
  title: string,
  message: string
): Promise<void> {
  switch (p) {
    case "darwin": {
      const terminalNotifierPath = await getTerminalNotifierPath()
      if (terminalNotifierPath) {
        const bundleId = process.env.__CFBundleIdentifier
        try {
          if (bundleId) {
            await ctx.$`${terminalNotifierPath} -title ${title} -message ${message} -activate ${bundleId}`
          } else {
            await ctx.$`${terminalNotifierPath} -title ${title} -message ${message}`
          }
          break
        } catch {
        }
      }

      const osascriptPath = await getOsascriptPath()
      if (!osascriptPath) return

      const escapedTitle = escapeAppleScriptText(title)
      const escapedMessage = escapeAppleScriptText(message)
      await ctx.$`${osascriptPath} -e ${"display notification \"" + escapedMessage + "\" with title \"" + escapedTitle + "\""}`.catch(
        () => {}
      )
      break
    }
    case "linux": {
      const notifySendPath = await getNotifySendPath()
      if (!notifySendPath) return

      await ctx.$`${notifySendPath} ${title} ${message} 2>/dev/null`.catch(() => {})
      break
    }
    case "win32": {
      const powershellPath = await getPowershellPath()
      if (!powershellPath) return

      const toastScript = buildWindowsToastScript(title, message)
      await ctx.$`${powershellPath} -Command ${toastScript}`.catch(() => {})
      break
    }
  }
}

export async function playSessionNotificationSound(
  ctx: PluginInput,
  p: Platform,
  soundPath: string
): Promise<void> {
  switch (p) {
    case "darwin": {
      const afplayPath = await getAfplayPath()
      if (!afplayPath) return
      ctx.$`${afplayPath} ${soundPath}`.catch(() => {})
      break
    }
    case "linux": {
      const paplayPath = await getPaplayPath()
      if (paplayPath) {
        ctx.$`${paplayPath} ${soundPath} 2>/dev/null`.catch(() => {})
      } else {
        const aplayPath = await getAplayPath()
        if (aplayPath) {
          ctx.$`${aplayPath} ${soundPath} 2>/dev/null`.catch(() => {})
        }
      }
      break
    }
    case "win32": {
      const powershellPath = await getPowershellPath()
      if (!powershellPath) return
      const escaped = escapePowerShellSingleQuotedText(soundPath)
      ctx.$`${powershellPath} -Command ${("(New-Object Media.SoundPlayer '" + escaped + "').PlaySync()")}`.catch(() => {})
      break
    }
  }
}

// ── Scheduler ──

export function createIdleNotificationScheduler(options: {
  ctx: PluginInput
  platform: Platform
  config: SessionNotificationConfig
  hasIncompleteTodos: (ctx: PluginInput, sessionID: string) => Promise<boolean>
  send: (ctx: PluginInput, platform: Platform, title: string, message: string) => Promise<void>
  playSound: (ctx: PluginInput, platform: Platform, soundPath: string) => Promise<void>
}) {
  const notifiedSessions = new Set<string>()
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const sessionActivitySinceIdle = new Set<string>()
  const notificationVersions = new Map<string, number>()
  const executingNotifications = new Set<string>()
  const scheduledAt = new Map<string, number>()

  const activityGracePeriodMs = options.config.activityGracePeriodMs ?? 100

  function cleanupOldSessions(): void {
    const maxSessions = options.config.maxTrackedSessions
    if (notifiedSessions.size > maxSessions) {
      const sessionsToRemove = Array.from(notifiedSessions).slice(0, notifiedSessions.size - maxSessions)
      sessionsToRemove.forEach((id) => notifiedSessions.delete(id))
    }
    if (sessionActivitySinceIdle.size > maxSessions) {
      const sessionsToRemove = Array.from(sessionActivitySinceIdle).slice(0, sessionActivitySinceIdle.size - maxSessions)
      sessionsToRemove.forEach((id) => sessionActivitySinceIdle.delete(id))
    }
    if (notificationVersions.size > maxSessions) {
      const sessionsToRemove = Array.from(notificationVersions.keys()).slice(0, notificationVersions.size - maxSessions)
      sessionsToRemove.forEach((id) => notificationVersions.delete(id))
    }
    if (executingNotifications.size > maxSessions) {
      const sessionsToRemove = Array.from(executingNotifications).slice(0, executingNotifications.size - maxSessions)
      sessionsToRemove.forEach((id) => executingNotifications.delete(id))
    }
    if (scheduledAt.size > maxSessions) {
      const sessionsToRemove = Array.from(scheduledAt.keys()).slice(0, scheduledAt.size - maxSessions)
      sessionsToRemove.forEach((id) => scheduledAt.delete(id))
    }
  }

  function cancelPendingNotification(sessionID: string): void {
    const timer = pendingTimers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      pendingTimers.delete(sessionID)
    }
    scheduledAt.delete(sessionID)
    sessionActivitySinceIdle.add(sessionID)
    notificationVersions.set(sessionID, (notificationVersions.get(sessionID) ?? 0) + 1)
  }

  function markSessionActivity(sessionID: string): void {
    const scheduledTime = scheduledAt.get(sessionID)
    if (scheduledTime && Date.now() - scheduledTime < activityGracePeriodMs) {
      return
    }

    cancelPendingNotification(sessionID)
    if (!executingNotifications.has(sessionID)) {
      notifiedSessions.delete(sessionID)
    }
  }

  async function executeNotification(sessionID: string, version: number): Promise<void> {
    if (executingNotifications.has(sessionID)) {
      pendingTimers.delete(sessionID)
      scheduledAt.delete(sessionID)
      return
    }

    if (notificationVersions.get(sessionID) !== version) {
      pendingTimers.delete(sessionID)
      scheduledAt.delete(sessionID)
      return
    }

    if (sessionActivitySinceIdle.has(sessionID)) {
      sessionActivitySinceIdle.delete(sessionID)
      pendingTimers.delete(sessionID)
      scheduledAt.delete(sessionID)
      return
    }

    if (notifiedSessions.has(sessionID)) {
      pendingTimers.delete(sessionID)
      scheduledAt.delete(sessionID)
      return
    }

    executingNotifications.add(sessionID)
    try {
      if (options.config.skipIfIncompleteTodos) {
        const hasPendingWork = await options.hasIncompleteTodos(options.ctx, sessionID)
        if (notificationVersions.get(sessionID) !== version) {
          return
        }
        if (hasPendingWork) return
      }

      if (notificationVersions.get(sessionID) !== version) {
        return
      }

      if (sessionActivitySinceIdle.has(sessionID)) {
        sessionActivitySinceIdle.delete(sessionID)
        return
      }

      notifiedSessions.add(sessionID)

      await options.send(options.ctx, options.platform, options.config.title, options.config.message)

      if (options.config.playSound && options.config.soundPath) {
        await options.playSound(options.ctx, options.platform, options.config.soundPath)
      }
    } finally {
      executingNotifications.delete(sessionID)
      pendingTimers.delete(sessionID)
      scheduledAt.delete(sessionID)
      if (sessionActivitySinceIdle.has(sessionID)) {
        notifiedSessions.delete(sessionID)
        sessionActivitySinceIdle.delete(sessionID)
      }
    }
  }

  function scheduleIdleNotification(sessionID: string): void {
    if (notifiedSessions.has(sessionID)) return
    if (pendingTimers.has(sessionID)) return
    if (executingNotifications.has(sessionID)) return

    sessionActivitySinceIdle.delete(sessionID)
    scheduledAt.set(sessionID, Date.now())

    const currentVersion = (notificationVersions.get(sessionID) ?? 0) + 1
    notificationVersions.set(sessionID, currentVersion)

    const timer = setTimeout(() => {
      executeNotification(sessionID, currentVersion)
    }, options.config.idleConfirmationDelay)

    pendingTimers.set(sessionID, timer)
    cleanupOldSessions()
  }

  function deleteSession(sessionID: string): void {
    cancelPendingNotification(sessionID)
    notifiedSessions.delete(sessionID)
    sessionActivitySinceIdle.delete(sessionID)
    notificationVersions.delete(sessionID)
    executingNotifications.delete(sessionID)
    scheduledAt.delete(sessionID)
  }

  return {
    markSessionActivity,
    scheduleIdleNotification,
    deleteSession,
  }
}
