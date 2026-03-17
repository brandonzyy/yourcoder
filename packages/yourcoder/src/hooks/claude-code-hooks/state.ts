// ============================================================================
// Session hook state
// ============================================================================

export const sessionFirstMessageProcessed = new Set<string>()

export const sessionErrorState = new Map<string, { hasError: boolean; errorMessage?: string }>()

export const sessionInterruptState = new Map<string, { interrupted: boolean }>()

export function clearSessionHookState(sessionID: string): void {
	sessionErrorState.delete(sessionID)
	sessionInterruptState.delete(sessionID)
	sessionFirstMessageProcessed.delete(sessionID)
}

// ============================================================================
// Tool input cache (PreToolUse → PostToolUse)
// ============================================================================

interface CacheEntry {
  toolInput: Record<string, unknown>
  timestamp: number
}

const cache = new Map<string, CacheEntry>()

const CACHE_TTL = 60000 // 1 minute

export function cacheToolInput(
  sessionId: string,
  toolName: string,
  invocationId: string,
  toolInput: Record<string, unknown>
): void {
  const key = `${sessionId}:${toolName}:${invocationId}`
  cache.set(key, { toolInput, timestamp: Date.now() })
}

export function getToolInput(
  sessionId: string,
  toolName: string,
  invocationId: string
): Record<string, unknown> | null {
  const key = `${sessionId}:${toolName}:${invocationId}`
  const entry = cache.get(key)
  if (!entry) return null

  cache.delete(key)
  if (Date.now() - entry.timestamp > CACHE_TTL) return null

  return entry.toolInput
}

// Periodic cleanup (every minute)
const cleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key)
    }
  }
}, CACHE_TTL)
// Allow process to exit naturally even if interval is running
if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
  cleanupInterval.unref()
}
