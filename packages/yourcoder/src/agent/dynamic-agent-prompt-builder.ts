// Re-export all types and functions from the canonical location
export type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "./builtin/yc/prompt-builder"

export {
  categorizeTools,
  buildManonSection,
  buildDelegationTable,
  buildCategorySkillsDelegationGuide,
  buildUltraworkSection,
} from "./builtin/yc/prompt-builder"
