import { getOpenCodeConfigPaths } from "../opencode-config-dir"
import type { OpenCodeBinaryType, OpenCodeConfigPaths } from "../opencode-config-dir"

export interface ConfigContext {
  binary: OpenCodeBinaryType
  version: string | null
  paths: OpenCodeConfigPaths
}

let configContext: ConfigContext | null = null

export function initConfigContext(binary: OpenCodeBinaryType, version: string | null): void {
  const paths = getOpenCodeConfigPaths({ binary, version })
  configContext = { binary, version, paths }
}

export function getConfigContext(): ConfigContext {
  if (!configContext) {
    const paths = getOpenCodeConfigPaths({ binary: "yourcoder", version: null })
    configContext = { binary: "yourcoder", version: null, paths }
  }
  return configContext
}

export function resetConfigContext(): void {
  configContext = null
}

export function getConfigDir(): string {
  return getConfigContext().paths.configDir
}

export function getConfigJson(): string {
  return getConfigContext().paths.configJson
}

export function getConfigJsonc(): string {
  return getConfigContext().paths.configJsonc
}

export function getPluginConfigPath(): string {
  return getConfigContext().paths.pluginConfig
}
