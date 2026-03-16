// Merged from: category-resolver.ts + subagent-resolver.ts + skill-resolver.ts + coderhand-agent.ts

import type { ModelFallbackInfo } from "../../cli/toast/types"
import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./types"
import type { FallbackEntry } from "../../model/model-requirements"
import type { GitMasterConfig, BrowserAutomationProvider } from "../../config/plugin-schema"
import { mergeCategories } from "../../config/plugin-utils/merge-categories"
import { resolveCategoryConfig } from "./categories"
import { parseModelString } from "./util"
import { CATEGORY_MODEL_REQUIREMENTS, AGENT_MODEL_REQUIREMENTS } from "../../model/model-requirements"
import { getAvailableModelsForDelegateTask } from "./available-models"
import { resolveModelForDelegateTask } from "./model-selection"
import { isPlanFamily } from "./constants"
import { normalizeModelFormat, normalizeSDKResponse } from "../../model/normalize"
import { getAgentDisplayName, getAgentConfigKey } from "../../util/agent-display-names"
import { log } from "../../util/logger"
import { resolveMultipleSkillsAsync } from "../../skill/loader/skill-template-resolver"
import { discoverSkills } from "../../skill/loader"

// --- CoderHand Agent ---

export const CODERHAND_AGENT = getAgentDisplayName("coderhand")

// --- Category Resolver ---

export interface CategoryResolutionResult {
  agentToUse: string
  categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
  categoryPromptAppend: string | undefined
  maxPromptTokens?: number
  modelInfo: ModelFallbackInfo | undefined
  actualModel: string | undefined
  isUnstableAgent: boolean
  fallbackChain?: FallbackEntry[]
  error?: string
}

export async function resolveCategoryExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  inheritedModel: string | undefined,
  systemDefaultModel: string | undefined
): Promise<CategoryResolutionResult> {
  const { client, userCategories, coderhandModel } = executorCtx

  const availableModels = await getAvailableModelsForDelegateTask(client)

  const categoryName = args.category!
  const enabledCategories = mergeCategories(userCategories)
  const categoryExists = enabledCategories[categoryName] !== undefined

  const resolved = resolveCategoryConfig(categoryName, {
    userCategories,
    inheritedModel,
    systemDefaultModel,
    availableModels,
  })

  if (!resolved) {
    const requirement = CATEGORY_MODEL_REQUIREMENTS[categoryName]
    const allCategoryNames = Object.keys(enabledCategories).join(", ")

    if (categoryExists && requirement?.requiresModel) {
      return {
        agentToUse: "",
        categoryModel: undefined,
        categoryPromptAppend: undefined,
        maxPromptTokens: undefined,
        modelInfo: undefined,
        actualModel: undefined,
        isUnstableAgent: false,
        error: `Category "${categoryName}" requires model "${requirement.requiresModel}" which is not available.

To use this category:
1. Connect a provider with this model: ${requirement.requiresModel}
2. Or configure an alternative model in your yourcoder-plugin.json for this category

Available categories: ${allCategoryNames}`,
      }
    }

    return {
      agentToUse: "",
      categoryModel: undefined,
      categoryPromptAppend: undefined,
      maxPromptTokens: undefined,
      modelInfo: undefined,
      actualModel: undefined,
      isUnstableAgent: false,
      error: `Unknown category: "${categoryName}". Available: ${allCategoryNames}`,
    }
  }

  const requirement = CATEGORY_MODEL_REQUIREMENTS[args.category!]
  let actualModel: string | undefined
  let modelInfo: ModelFallbackInfo | undefined
  let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined

  const overrideModel = coderhandModel
  const explicitCategoryModel = userCategories?.[args.category!]?.model

  if (!requirement) {
    actualModel = explicitCategoryModel ?? overrideModel ?? resolved.model
    if (actualModel) {
      modelInfo = explicitCategoryModel || overrideModel
        ? { model: actualModel, type: "user-defined", source: "override" }
        : { model: actualModel, type: "system-default", source: "system-default" }
    }
  } else {
    const resolution = resolveModelForDelegateTask({
      userModel: explicitCategoryModel ?? overrideModel,
      categoryDefaultModel: resolved.model,
      fallbackChain: requirement.fallbackChain,
      availableModels,
      systemDefaultModel,
    })

    if (resolution) {
      const { model: resolvedModel, variant: resolvedVariant } = resolution
      actualModel = resolvedModel

      if (!parseModelString(actualModel)) {
        return {
          agentToUse: "",
          categoryModel: undefined,
          categoryPromptAppend: undefined,
          maxPromptTokens: undefined,
          modelInfo: undefined,
          actualModel: undefined,
          isUnstableAgent: false,
          error: `Invalid model format "${actualModel}". Expected "provider/model" format (e.g., "anthropic/claude-sonnet-4-6").`,
        }
      }

      const type: "user-defined" | "inherited" | "category-default" | "system-default" =
        (explicitCategoryModel || overrideModel)
          ? "user-defined"
          : (systemDefaultModel && actualModel === systemDefaultModel)
              ? "system-default"
              : "category-default"

      const source: "override" | "category-default" | "system-default" =
        type === "user-defined"
          ? "override"
          : type === "system-default"
              ? "system-default"
              : "category-default"

      modelInfo = { model: actualModel, type, source }

      const parsedModel = parseModelString(actualModel)
      const variantToUse = userCategories?.[args.category!]?.variant ?? resolvedVariant ?? resolved.config.variant
      categoryModel = parsedModel
        ? (variantToUse ? { ...parsedModel, variant: variantToUse } : parsedModel)
        : undefined
    }
  }

  if (!categoryModel && actualModel) {
    const parsedModel = parseModelString(actualModel)
    categoryModel = parsedModel ?? undefined
  }
  const categoryPromptAppend = resolved.promptAppend || undefined

  if (!categoryModel && !actualModel) {
    const categoryNames = Object.keys(enabledCategories)
    return {
      agentToUse: "",
      categoryModel: undefined,
      categoryPromptAppend: undefined,
      maxPromptTokens: undefined,
      modelInfo: undefined,
      actualModel: undefined,
      isUnstableAgent: false,
      error: `Model not configured for category "${args.category}".

Configure in one of:
1. OpenCode: Set "model" in yourcoder.json
2. OpenCode Plugin: Set category model in yourcoder-plugin.json
3. Provider: Connect a provider with available models

Current category: ${args.category}
Available categories: ${categoryNames.join(", ")}`,
    }
  }

  const unstableModel = actualModel?.toLowerCase()
  const categoryConfigModel = resolved.config.model?.toLowerCase()
  const isUnstableAgent = resolved.config.is_unstable_agent === true || [unstableModel, categoryConfigModel].some(m => m ? m.includes("gemini") || m.includes("minimax") || m.includes("kimi") : false)

  return {
    agentToUse: CODERHAND_AGENT,
    categoryModel,
    categoryPromptAppend,
    maxPromptTokens: resolved.config.max_prompt_tokens,
    modelInfo,
    actualModel,
    isUnstableAgent,
    fallbackChain: requirement?.fallbackChain,
  }
}

// --- Subagent Resolver ---

export async function resolveSubagentExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  parentAgent: string | undefined,
  categoryExamples: string
): Promise<{ agentToUse: string; categoryModel: { providerID: string; modelID: string; variant?: string } | undefined; fallbackChain?: FallbackEntry[]; error?: string }> {
  const { client, agentOverrides } = executorCtx

  if (!args.subagent_type?.trim()) {
    return { agentToUse: "", categoryModel: undefined, error: `Agent name cannot be empty.` }
  }

  const agentName = args.subagent_type.trim()

  if (agentName.toLowerCase() === CODERHAND_AGENT.toLowerCase()) {
    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Cannot use subagent_type="${CODERHAND_AGENT}" directly. Use category parameter instead (e.g., ${categoryExamples}).

CoderHand is spawned automatically when you specify a category. Pick the appropriate category for your task domain.`,
    }
  }

  if (isPlanFamily(agentName) && isPlanFamily(parentAgent)) {
    return {
      agentToUse: "",
      categoryModel: undefined,
    error: `You are a plan-family agent (plan/prometheus). You cannot delegate to other plan-family agents via task.

Create the work plan directly - that's your job as the planning agent.`,
    }
  }

  let agentToUse = agentName
  let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
  let fallbackChain: FallbackEntry[] | undefined = undefined

  try {
    const agentsResult = await client.app.agents()
    type AgentInfo = {
      name: string
      mode?: "subagent" | "primary" | "all"
      model?: string | { providerID: string; modelID: string }
    }
    const agents = normalizeSDKResponse(agentsResult, [] as AgentInfo[], {
      preferResponseOnMissingData: true,
    })

    const callableAgents = agents.filter((a) => a.mode !== "primary")

    const resolvedDisplayName = getAgentDisplayName(agentToUse)
    const matchedAgent = callableAgents.find(
      (agent) => agent.name.toLowerCase() === agentToUse.toLowerCase()
        || agent.name.toLowerCase() === resolvedDisplayName.toLowerCase()
    )
    if (!matchedAgent) {
      const isPrimaryAgent = agents
        .filter((a) => a.mode === "primary")
        .find((agent) => agent.name.toLowerCase() === agentToUse.toLowerCase()
          || agent.name.toLowerCase() === resolvedDisplayName.toLowerCase())

      if (isPrimaryAgent) {
        return {
          agentToUse: "",
          categoryModel: undefined,
    error: `Cannot call primary agent "${isPrimaryAgent.name}" via task. Primary agents are top-level orchestrators.`,
        }
      }

      const availableAgents = callableAgents
        .map((a) => a.name)
        .sort()
        .join(", ")
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Unknown agent: "${agentToUse}". Available agents: ${availableAgents}`,
      }
    }

    agentToUse = matchedAgent.name

    const agentConfigKey = getAgentConfigKey(agentToUse)
    const agentOverride = agentOverrides?.[agentConfigKey as keyof typeof agentOverrides]
      ?? (agentOverrides ? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentConfigKey)?.[1] : undefined)
    const agentRequirement = AGENT_MODEL_REQUIREMENTS[agentConfigKey]
    fallbackChain = agentRequirement?.fallbackChain

    if (agentOverride?.model || agentRequirement || matchedAgent.model) {
      const availableModels = await getAvailableModelsForDelegateTask(client)

      const normalizedMatchedModel = matchedAgent.model
        ? normalizeModelFormat(matchedAgent.model)
        : undefined
      const matchedAgentModelStr = normalizedMatchedModel
        ? `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
        : undefined

      const resolution = resolveModelForDelegateTask({
        userModel: agentOverride?.model,
        categoryDefaultModel: matchedAgentModelStr,
        fallbackChain: agentRequirement?.fallbackChain,
        availableModels,
        systemDefaultModel: undefined,
      })

      if (resolution) {
        const normalized = normalizeModelFormat(resolution.model)
        if (normalized) {
          const variantToUse = agentOverride?.variant ?? resolution.variant
          categoryModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
        }
      }
    }

    if (!categoryModel && matchedAgent.model) {
      const normalizedMatchedModel = normalizeModelFormat(matchedAgent.model)
      if (normalizedMatchedModel) {
        categoryModel = normalizedMatchedModel
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log("[delegate-task] Failed to resolve subagent execution", {
      requestedAgent: agentToUse,
      parentAgent,
      error: errorMessage,
    })

    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Failed to delegate to agent "${agentToUse}": ${errorMessage}`,
    }
  }

  return { agentToUse, categoryModel, fallbackChain }
}

// --- Skill Resolver ---

export async function resolveSkillContent(
  skills: string[],
  options: { gitMasterConfig?: GitMasterConfig; browserProvider?: BrowserAutomationProvider, disabledSkills?: Set<string>, directory?: string }
): Promise<{ content: string | undefined; contents: string[]; error: string | null }> {
  if (skills.length === 0) {
    return { content: undefined, contents: [], error: null }
  }

  const { resolved, notFound } = await resolveMultipleSkillsAsync(skills, options)
  if (notFound.length > 0) {
    const allSkills = await discoverSkills({ includeClaudeCodePaths: true, directory: options?.directory })
    const available = allSkills.map(s => s.name).join(", ")
    return { content: undefined, contents: [], error: `Skills not found: ${notFound.join(", ")}. Available: ${available}` }
  }

  const contents = Array.from(resolved.values())
  return { content: contents.join("\n\n"), contents, error: null }
}
