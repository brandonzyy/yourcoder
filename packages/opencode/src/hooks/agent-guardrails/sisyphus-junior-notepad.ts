import type { PluginInput } from "../../plugin/sdk"

import { isCallerOrchestrator } from "../../session/session-utils"
import { SYSTEM_DIRECTIVE_PREFIX } from "../shared/system-directive"
import { log } from "../../util/logger"

const HOOK_NAME = "sisyphus-junior-notepad"

const NOTEPAD_DIRECTIVE = `
<Work_Context>
## Notepad Location (for recording learnings)
NOTEPAD PATH: .sisyphus/notepads/{plan-name}/
- learnings.md: Record patterns, conventions, successful approaches
- issues.md: Record problems, blockers, gotchas encountered
- decisions.md: Record architectural choices and rationales
- problems.md: Record unresolved issues, technical debt

You SHOULD append findings to notepad files after completing work.
IMPORTANT: Always APPEND to notepad files - never overwrite or use Edit tool.

## Plan Location (READ ONLY)
PLAN PATH: .sisyphus/plans/{plan-name}.md

CRITICAL RULE: NEVER MODIFY THE PLAN FILE

The plan file (.sisyphus/plans/*.md) is SACRED and READ-ONLY.
- You may READ the plan to understand tasks
- You may READ checkbox items to know what to do
- You MUST NOT edit, modify, or update the plan file
- You MUST NOT mark checkboxes as complete in the plan
- Only the Orchestrator manages the plan file

VIOLATION = IMMEDIATE FAILURE. The Orchestrator tracks plan state.
</Work_Context>
`

export function createSisyphusJuniorNotepadHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      // 1. Check if tool is task
      if (input.tool !== "task") {
        return
      }

      // 2. Check if caller is Atlas (orchestrator)
      if (!(await isCallerOrchestrator(input.sessionID, ctx.client))) {
        return
      }

      // 3. Get prompt from output.args
      const prompt = output.args.prompt as string | undefined
      if (!prompt) {
        return
      }

      // 4. Check for double injection
      if (prompt.includes(SYSTEM_DIRECTIVE_PREFIX)) {
        return
      }

      // 5. Prepend directive
      output.args.prompt = NOTEPAD_DIRECTIVE + prompt

      // 6. Log injection
      log(`[${HOOK_NAME}] Injected notepad directive to task`, {
        sessionID: input.sessionID,
      })
    },
  }
}
