/**
 * Session utilities
 *
 * isCallerOrchestrator always returns false since the atlas agent was removed.
 * Kept as a stub for backward compatibility with sisyphus-junior-notepad hook.
 */
export async function isCallerOrchestrator(_sessionID?: string, _client?: unknown): Promise<boolean> {
  return false
}
