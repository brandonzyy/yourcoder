import type { PluginInput } from "@opencode-ai/plugin"
import type { SubagentHealthCheckConfig } from "./types"
import { log } from "../../util/logger"

const HOOK_NAME = "subagent-health-check"

/**
 * Subagent Health Check Hook
 *
 * Injects a system reminder on session start to prompt Sisyphus
 * to perform a quick health check of all subagents.
 */
export function createSubagentHealthCheckHook(
  ctx: PluginInput,
  config: SubagentHealthCheckConfig = {}
) {
  const { enabled = true, timeout = 10000 } = config

  if (!enabled) {
    return null
  }

  const checkedSessions = new Set<string>()

  return {
    "session.created": async (input: { event: { type: string; properties?: unknown } }) => {
      const { event } = input

      if (event.type !== "session.created") return

      const props = event.properties as Record<string, unknown> | undefined
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.id as string | undefined
      const parentID = info?.parentID as string | undefined

      // Only check main sessions (no parent)
      if (!sessionID || parentID) return

      // Only check once per session
      if (checkedSessions.has(sessionID)) return
      checkedSessions.add(sessionID)

      log(`[${HOOK_NAME}] Injecting health check for session ${sessionID}`)

      // Inject system reminder to trigger health check
      const reminder = buildHealthCheckReminder(timeout)

      return {
        systemReminder: reminder,
      }
    },
  }
}

function buildHealthCheckReminder(timeout: number): string {
  return `<system-reminder>
[STARTUP HEALTH CHECK]

Perform a quick health check of all subagents before proceeding. This ensures the system is ready.

**Required checks:**
1. manon-explorer - Test with a simple manon_search query
2. librarian - Test with a simple search
3. sisyphus-junior - Test with a simple task delegation

**Instructions:**
- Fire all 3 checks in parallel (run_in_background=true)
- Timeout: ${timeout}ms per agent
- Report results in this format:

\`\`\`
🔍 Subagent Health Check:
✅ manon-explorer: Ready (120ms)
✅ librarian: Ready (95ms)
✅ sisyphus-junior: Ready (150ms)

System ready. All agents operational.
\`\`\`

If any agent fails, report the error clearly and suggest next steps.

**Keep it fast** - use minimal test queries, don't wait for full results.
</system-reminder>`
}
