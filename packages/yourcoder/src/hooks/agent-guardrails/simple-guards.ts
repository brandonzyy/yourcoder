// Merged from: tool-output-truncator.ts, question-label-truncator.ts,
// empty-task-response-detector.ts, no-yc-gpt.ts, tasks-todowrite-disabler.ts

import type { PluginInput } from "../../plugin/sdk"
import type { ExperimentalConfig } from "../../config/plugin-schema"
import { createDynamicTruncator } from "../shared/dynamic-truncator"
import { isGptModel, isGpt5_4Model } from "../../agent/plugin-agent-types"
import { getSessionAgent, updateSessionAgent } from "../../session/state"
import { log } from "../../util/logger"
import { getAgentConfigKey, getAgentDisplayName } from "../../util/agent-display-names"

// --- Tool Output Truncator ---

const DEFAULT_MAX_TOKENS = 50_000 // ~200k chars
const WEBFETCH_MAX_TOKENS = 10_000 // ~40k chars - web pages need aggressive truncation

const TRUNCATABLE_TOOLS = [
  "grep",
  "Grep",
  "safe_grep",
  "glob",
  "Glob",
  "safe_glob",
  "lsp_diagnostics",
  "ast_grep_search",
  "interactive_bash",
  "Interactive_bash",
  "webfetch",
  "WebFetch",
]

const TOOL_SPECIFIC_MAX_TOKENS: Record<string, number> = {
  webfetch: WEBFETCH_MAX_TOKENS,
  WebFetch: WEBFETCH_MAX_TOKENS,
}

interface ToolOutputTruncatorOptions {
  modelCacheState?: { anthropicContext1MEnabled: boolean }
  experimental?: ExperimentalConfig
}

export function createToolOutputTruncatorHook(ctx: PluginInput, options?: ToolOutputTruncatorOptions) {
  const truncator = createDynamicTruncator(ctx, options?.modelCacheState)
  const truncateAll = options?.experimental?.truncate_all_tool_outputs ?? false

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    if (!truncateAll && !TRUNCATABLE_TOOLS.includes(input.tool)) return
    if (typeof output.output !== 'string') return

    try {
      const targetMaxTokens = TOOL_SPECIFIC_MAX_TOKENS[input.tool] ?? DEFAULT_MAX_TOKENS
      const { result, truncated } = await truncator.truncate(
        input.sessionID,
        output.output,
        { targetMaxTokens }
      )
      if (truncated) {
        output.output = result
      }
    } catch {
      // Graceful degradation - don't break tool execution
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}

// --- Question Label Truncator ---

const MAX_LABEL_LENGTH = 30;

interface QuestionOption {
  label: string;
  description?: string;
}

interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

interface AskUserQuestionArgs {
  questions: Question[];
}

function truncateLabel(label: string, maxLength: number = MAX_LABEL_LENGTH): string {
  if (label.length <= maxLength) {
    return label;
  }
  return label.substring(0, maxLength - 3) + "...";
}

function truncateQuestionLabels(args: AskUserQuestionArgs): AskUserQuestionArgs {
  if (!args.questions || !Array.isArray(args.questions)) {
    return args;
  }

  return {
    ...args,
    questions: args.questions.map((question) => ({
      ...question,
      options:
        question.options?.map((option) => ({
          ...option,
          label: truncateLabel(option.label),
        })) ?? [],
    })),
  };
}

export function createQuestionLabelTruncatorHook() {
  return {
    "tool.execute.before": async (
      input: { tool: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      const toolName = input.tool?.toLowerCase();

      if (toolName === "askuserquestion" || toolName === "ask_user_question") {
        const args = output.args as unknown as AskUserQuestionArgs | undefined;

        if (args?.questions) {
          const truncatedArgs = truncateQuestionLabels(args);
          Object.assign(output.args, truncatedArgs);
        }
      }
    },
  };
}

// --- Empty Task Response Detector ---

const EMPTY_RESPONSE_WARNING = `[Task Empty Response Warning]

Task invocation completed but returned no response. This indicates the agent either:
- Failed to execute properly
- Did not terminate correctly
- Returned an empty result

Note: The call has already completed - you are NOT waiting for a response. Proceed accordingly.`

export function createEmptyTaskResponseDetectorHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool !== "Task" && input.tool !== "task") return

      const responseText = output.output?.trim() ?? ""

      if (responseText === "") {
        output.output = EMPTY_RESPONSE_WARNING
      }
    },
  }
}

// --- No YC GPT Guard ---

const TOAST_TITLE = "NEVER Use Yc with GPT"
const TOAST_MESSAGE = [
  "Yc works best with Claude Opus, and works fine with Kimi/GLM models.",
  "Do NOT use Yac with GPT (except GPT-5.4 which has specialized support).",
  "For GPT models (other than 5.4), always use Hephaestus.",
].join("\n")
const HEPHAESTUS_DISPLAY = getAgentDisplayName("hephaestus")

function showToast(ctx: PluginInput, sessionID: string): void {
  ctx.client.tui.showToast({
    body: {
      title: TOAST_TITLE,
      message: TOAST_MESSAGE,
      variant: "error",
      duration: 10000,
    },
  }).catch((error) => {
    log("[no-yc-gpt] Failed to show toast", {
      sessionID,
      error,
    })
  })
}

export function createNoYcGptHook(ctx: PluginInput) {
  return {
    "chat.message": async (input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
    }, output?: {
      message?: { agent?: string; [key: string]: unknown }
    }): Promise<void> => {
      const rawAgent = input.agent ?? getSessionAgent(input.sessionID) ?? ""
      const agentKey = getAgentConfigKey(rawAgent)
      const modelID = input.model?.modelID

      if (agentKey === "yc" && modelID && isGptModel(modelID) && !isGpt5_4Model(modelID)) {
        showToast(ctx, input.sessionID)
        input.agent = HEPHAESTUS_DISPLAY
        if (output?.message) {
          output.message.agent = HEPHAESTUS_DISPLAY
        }
        updateSessionAgent(input.sessionID, HEPHAESTUS_DISPLAY)
      }
    },
  }
}

// --- Tasks TodoWrite Disabler ---

const BLOCKED_TOOLS = ["TodoWrite", "TodoRead"]
const REPLACEMENT_MESSAGE = `TodoRead/TodoWrite are DISABLED because experimental.task_system is enabled.

**ACTION REQUIRED**: RE-REGISTER what you were about to write as Todo using Task tools NOW. Then ASSIGN yourself and START WORKING immediately.

**Use these tools instead:**
- TaskCreate: Create new task with auto-generated ID
- TaskUpdate: Update status, assign owner, add dependencies
- TaskList: List active tasks with dependency info
- TaskGet: Get full task details

**Workflow:**
1. TaskCreate({ subject: "your task description" })
2. TaskUpdate({ id: "T-xxx", status: "in_progress", owner: "your-thread-id" })
3. DO THE WORK
4. TaskUpdate({ id: "T-xxx", status: "completed" })

CRITICAL: 1 task = 1 task. Fire independent tasks concurrently.

**STOP! DO NOT START WORKING DIRECTLY - NO MATTER HOW SMALL THE TASK!**
Even if the task seems trivial (1 line fix, simple edit, quick change), you MUST:
1. FIRST register it with TaskCreate
2. THEN mark it in_progress
3. ONLY THEN do the actual work
4. FINALLY mark it completed

**WHY?** Task tracking = visibility = accountability. Skipping registration = invisible work = chaos.

DO NOT retry TodoWrite. Convert to TaskCreate NOW.`

export interface TasksTodowriteDisablerConfig {
  experimental?: {
    task_system?: boolean;
  };
}

export function createTasksTodowriteDisablerHook(
  config: TasksTodowriteDisablerConfig,
) {
  const isTaskSystemEnabled = config.experimental?.task_system ?? false;

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      _output: { args: Record<string, unknown> },
    ) => {
      if (!isTaskSystemEnabled) {
        return;
      }

      const toolName = input.tool as string;
      if (
        BLOCKED_TOOLS.some(
          (blocked) => blocked.toLowerCase() === toolName.toLowerCase(),
        )
      ) {
        throw new Error(REPLACEMENT_MESSAGE);
      }
    },
  };
}
