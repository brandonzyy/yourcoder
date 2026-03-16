import { tool, type ToolDefinition } from "../../plugin/sdk"
import type { DelegateTaskArgs, ToolContextWithMetadata, DelegateTaskToolOptions } from "./types"
import { CATEGORY_DESCRIPTIONS } from "./constants"
import { CODERHAND_AGENT, resolveSkillContent, resolveCategoryExecution, resolveSubagentExecution } from "./task-resolver"
import { mergeCategories } from "../../config/plugin-utils/merge-categories"
import type { ModelFallbackInfo } from "../../cli/toast/types"
import type { FallbackEntry } from "../../model/model-requirements"
import { log } from "../../util/logger"
import { buildSystemContent } from "./prompt-builder"
import { listBuiltinAgentNames, renderBuiltinAgentList } from "../../agent/builtin/catalog"
import type {
  AvailableCategory,
  AvailableSkill,
} from "../../agent/dynamic-agent-prompt-builder"
import { resolveParentContext } from "./util"
import { executeBackgroundContinuation, executeBackgroundTask } from "./background"
import { executeSyncContinuation, executeSyncTask } from "./sync"
import { executeUnstableAgentTask } from "./unstable-agent-task"

export { resolveCategoryConfig } from "./categories"
export type { SyncSessionCreatedEvent, DelegateTaskToolOptions, BuildSystemContentInput } from "./types"
export { buildSystemContent, buildTaskPrompt } from "./prompt-builder"

export function createDelegateTask(options: DelegateTaskToolOptions): ToolDefinition {
  const { userCategories } = options

  const allCategories = mergeCategories(userCategories)
  const categoryNames = Object.keys(allCategories)
  const categoryExamples = categoryNames.join(", ")

  const availableCategories: AvailableCategory[] = options.availableCategories
    ?? Object.entries(allCategories).map(([name, categoryConfig]) => {
      const userDesc = userCategories?.[name]?.description
      const builtinDesc = CATEGORY_DESCRIPTIONS[name]
      const description = userDesc || builtinDesc || "General tasks"
      return {
        name,
        description,
        model: categoryConfig.model,
      }
    })

  const availableSkills: AvailableSkill[] = options.availableSkills ?? []

  const categoryList = categoryNames.map(name => {
    const userDesc = userCategories?.[name]?.description
    const builtinDesc = CATEGORY_DESCRIPTIONS[name]
    const desc = userDesc || builtinDesc
    return desc ? `  - ${name}: ${desc}` : `  - ${name}`
  }).join("\n")
  const agentList = renderBuiltinAgentList()
  const agentExamples = listBuiltinAgentNames().join(", ")

  const description = `Spawn agent task with category-based or direct agent selection.
  
  ⚠️  CRITICAL: You MUST provide EITHER category OR subagent_type. Omitting BOTH will FAIL.
  
  **COMMON MISTAKE (DO NOT DO THIS):**
  \`\`\`
  task(description="...", prompt="...", run_in_background=false)  // ❌ FAILS - missing category AND subagent_type
  \`\`\`
  
  **CORRECT - Using category:**
  \`\`\`
  task(category="quick", load_skills=[], description="Fix type error", prompt="...", run_in_background=false)
  \`\`\`
  
  **CORRECT - Using subagent_type:**
  \`\`\`
  task(subagent_type="codersearch", load_skills=[], description="Find patterns", prompt="...", run_in_background=true)
  \`\`\`
  
  REQUIRED: Provide ONE of:
  - category: For task delegation (uses CoderHand with category-optimized model)
  - subagent_type: For direct agent invocation (${agentExamples})
  
  **DO NOT provide both.** If category is provided, subagent_type is ignored.
  
  - load_skills: ALWAYS REQUIRED. Pass [] if no skills needed, or ["skill-1", "skill-2"] for category tasks.
  - category: Use predefined category → Spawns CoderHand with category config
    Available categories:
  ${categoryList}
  - subagent_type: Use specific agent directly
    Available agents:
  ${agentList}
  - run_in_background: true=async (returns task_id), false=sync (waits). Default: false. Use background=true ONLY for parallel exploration with 5+ independent queries.
  - session_id: Existing Task session to continue (from previous task output). Continues agent with FULL CONTEXT PRESERVED - saves tokens, maintains continuity.
  - command: The command that triggered this task (optional, for slash command tracking).
  
  **WHEN TO USE session_id:**
  - Task failed/incomplete → session_id with "fix: [specific issue]"
  - Need follow-up on previous result → session_id with additional question
  - Multi-turn conversation with same agent → always session_id instead of new task
  
  Prompts MUST be in English.`

  return tool({
    description,
    args: {
      load_skills: tool.schema.array(tool.schema.string()).describe("Skill names to inject. REQUIRED - pass [] if no skills needed."),
      description: tool.schema.string().describe("Short task description (3-5 words)"),
      prompt: tool.schema.string().describe("Full detailed prompt for the agent"),
      run_in_background: tool.schema.boolean().describe("true=async (returns task_id), false=sync (waits). Default: false"),
      category: tool.schema.string().optional().describe(`REQUIRED if subagent_type not provided. Do NOT provide both category and subagent_type.`),
      subagent_type: tool.schema.string().optional().describe("REQUIRED if category not provided. Do NOT provide both category and subagent_type."),
      session_id: tool.schema.string().optional().describe("Existing Task session to continue"),
      command: tool.schema.string().optional().describe("The command that triggered this task"),
    },
    async execute(args: DelegateTaskArgs, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata

      if (args.category) {
        if (args.subagent_type && args.subagent_type !== CODERHAND_AGENT) {
          log("[task] category provided - overriding subagent_type to coderhand", {
            category: args.category,
            subagent_type: args.subagent_type,
          })
        }
        args.subagent_type = CODERHAND_AGENT
      }
      if (typeof args.load_skills === "string") {
        try {
          const parsed = JSON.parse(args.load_skills)
          args.load_skills = Array.isArray(parsed) ? parsed : []
        } catch {
          args.load_skills = []
        }
      }
      const task = args

      await ctx.metadata?.({
        title: task.description,
      })

      if (task.run_in_background === undefined) {
        throw new Error(`Invalid arguments: 'run_in_background' parameter is REQUIRED. Use run_in_background=false for task delegation, run_in_background=true only for parallel exploration.`)
      }
      if (task.load_skills === undefined) {
        throw new Error(`Invalid arguments: 'load_skills' parameter is REQUIRED. Pass [] if no skills needed.`)
      }
      if (task.load_skills === null) {
        throw new Error(`Invalid arguments: load_skills=null is not allowed. Pass [] if no skills needed.`)
      }

      const runInBackground = task.run_in_background === true

      const { content: skillContent, contents: skillContents, error: skillError } = await resolveSkillContent(task.load_skills, {
        gitMasterConfig: options.gitMasterConfig,
        browserProvider: options.browserProvider,
        disabledSkills: options.disabledSkills,
        directory: options.directory,
      })
      if (skillError) {
        return skillError
      }

      const parentContext = await resolveParentContext(ctx, options.client)

      if (task.session_id) {
        if (runInBackground) {
          return executeBackgroundContinuation(task, ctx, options, parentContext)
        }
        return executeSyncContinuation(task, ctx, options)
      }

      if (!task.category && !task.subagent_type) {
        return `Invalid arguments: Must provide either category or subagent_type.`
      }

      let systemDefaultModel: string | undefined
      try {
        const openCodeConfig = await options.client.config.get()
        systemDefaultModel = (openCodeConfig as { data?: { model?: string } })?.data?.model
      } catch {
        systemDefaultModel = undefined
      }

      const inheritedModel = parentContext.model
        ? `${parentContext.model.providerID}/${parentContext.model.modelID}`
        : undefined

      let agentToUse: string
      let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
      let categoryPromptAppend: string | undefined
      let modelInfo: ModelFallbackInfo | undefined
      let actualModel: string | undefined
      let isUnstableAgent = false
      let fallbackChain: FallbackEntry[] | undefined
      let maxPromptTokens: number | undefined

      if (task.category) {
        const resolution = await resolveCategoryExecution(task, options, inheritedModel, systemDefaultModel)
        if (resolution.error) {
          return resolution.error
        }
        agentToUse = resolution.agentToUse
        categoryModel = resolution.categoryModel
        categoryPromptAppend = resolution.categoryPromptAppend
        modelInfo = resolution.modelInfo
        actualModel = resolution.actualModel
        isUnstableAgent = resolution.isUnstableAgent
        fallbackChain = resolution.fallbackChain
        maxPromptTokens = resolution.maxPromptTokens

        const isRunInBackgroundExplicitlyFalse = task.run_in_background === false || task.run_in_background === "false" as unknown as boolean

        log("[task] unstable agent detection", {
          category: task.category,
          actualModel,
          isUnstableAgent,
          run_in_background_value: task.run_in_background,
          run_in_background_type: typeof task.run_in_background,
          isRunInBackgroundExplicitlyFalse,
          willForceBackground: isUnstableAgent && isRunInBackgroundExplicitlyFalse,
        })

        if (isUnstableAgent && isRunInBackgroundExplicitlyFalse) {
          const systemContent = buildSystemContent({
            skillContent,
            skillContents,
            categoryPromptAppend,
            agentName: agentToUse,
            maxPromptTokens,
            model: categoryModel,
            availableCategories,
            availableSkills,
          })
          return executeUnstableAgentTask(task, ctx, options, parentContext, agentToUse, categoryModel, systemContent, actualModel)
        }
      } else {
        const resolution = await resolveSubagentExecution(task, options, parentContext.agent, categoryExamples)
        if (resolution.error) {
          return resolution.error
        }
        agentToUse = resolution.agentToUse
        categoryModel = resolution.categoryModel
        fallbackChain = resolution.fallbackChain
      }

      const systemContent = buildSystemContent({
        skillContent,
        skillContents,
        categoryPromptAppend,
        agentName: agentToUse,
        maxPromptTokens,
        model: categoryModel,
        availableCategories,
        availableSkills,
      })

      if (runInBackground) {
        return executeBackgroundTask(task, ctx, options, parentContext, agentToUse, categoryModel, systemContent, fallbackChain)
      }

      return executeSyncTask(task, ctx, options, parentContext, agentToUse, categoryModel, systemContent, modelInfo, fallbackChain)
    },
  })
}
