import type { AvailableCategory } from "../../agent/dynamic-agent-prompt-builder"
import type { PluginConfig } from "../../config/plugin-config-types"
import { CATEGORY_DESCRIPTIONS } from "../../tool/delegate-task/constants"
import { mergeCategories } from "../../config/plugin-utils/merge-categories"

export function createAvailableCategories(
  pluginConfig: PluginConfig,
): AvailableCategory[] {
  const categories = mergeCategories(pluginConfig.categories)

  return Object.entries(categories).map(([name, categoryConfig]) => {
    const model =
      typeof categoryConfig.model === "string" ? categoryConfig.model : undefined

    return {
      name,
      description:
        pluginConfig.categories?.[name]?.description ??
        CATEGORY_DESCRIPTIONS[name] ??
        "General tasks",
      model,
    }
  })
}
