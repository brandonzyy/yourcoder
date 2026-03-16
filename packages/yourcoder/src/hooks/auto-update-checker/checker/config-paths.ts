import * as os from "node:os"
import * as path from "node:path"
import {
  USER_CONFIG_DIR,
  USER_YC_CONFIG,
  USER_YC_CONFIG_JSONC,
  getWindowsAppdataDir,
} from "../constants"

export function getConfigPaths(directory: string): string[] {
  const paths = [
    path.join(directory, ".yourcoder", "yourcoder.json"),
    path.join(directory, ".yourcoder", "yourcoder.jsonc"),
    USER_YC_CONFIG,
    USER_YC_CONFIG_JSONC,
  ]

  if (process.platform === "win32") {
    const crossPlatformDir = path.join(os.homedir(), ".config")
    const appdataDir = getWindowsAppdataDir()

    if (appdataDir) {
      const alternateDir = USER_CONFIG_DIR === crossPlatformDir ? appdataDir : crossPlatformDir
      const alternateConfig = path.join(alternateDir, "opencode", "yourcoder.json")
      const alternateConfigJsonc = path.join(alternateDir, "opencode", "yourcoder.jsonc")

      if (!paths.includes(alternateConfig)) {
        paths.push(alternateConfig)
      }
      if (!paths.includes(alternateConfigJsonc)) {
        paths.push(alternateConfigJsonc)
      }
    }
  }

  return paths
}
