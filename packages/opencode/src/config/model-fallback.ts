import type { InstallConfig } from "./types"

export type GeneratedOmoConfig = Record<string, unknown>

/**
 * Stub: model config generation was part of the CLI installer.
 * Returns a minimal config object.
 */
export function generateModelConfig(_config: InstallConfig): GeneratedOmoConfig {
  return {}
}
