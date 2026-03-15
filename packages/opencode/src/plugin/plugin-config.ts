import * as fs from "fs";
import * as path from "path";
import { PluginConfigSchema, type PluginConfig } from "../config/plugin-config-types";
import { log } from "../util/logger";
import { deepMerge } from "../util/deep-merge";
import { parseJsonc, detectConfigFile } from "../util/jsonc-parser";
import { migrateConfigFile } from "../config/migration/config-migration";
import {getOpenCodeConfigDir} from "../config/opencode-config-dir";
import {addConfigLoadError} from "../config/config-errors";

export function parseConfigPartially(
  rawConfig: Record<string, unknown>
): PluginConfig | null {
  const fullResult = PluginConfigSchema.safeParse(rawConfig);
  if (fullResult.success) {
    return fullResult.data;
  }

  const partialConfig: Record<string, unknown> = {};
  const invalidSections: string[] = [];

  for (const key of Object.keys(rawConfig)) {
    const sectionResult = PluginConfigSchema.safeParse({ [key]: rawConfig[key] });
    if (sectionResult.success) {
      const parsed = sectionResult.data as Record<string, unknown>;
      if (parsed[key] !== undefined) {
        partialConfig[key] = parsed[key];
      }
    } else {
      const sectionErrors = sectionResult.error.issues
        .filter((i) => i.path[0] === key)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      if (sectionErrors) {
        invalidSections.push(`${key}: ${sectionErrors}`);
      }
    }
  }

  if (invalidSections.length > 0) {
    log("Partial config loaded — invalid sections skipped:", invalidSections);
  }

  return partialConfig as PluginConfig;
}

export function loadConfigFromPath(
  configPath: string,
  _ctx: unknown
): PluginConfig | null {
  try {
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, "utf-8");
      const rawConfig = parseJsonc<Record<string, unknown>>(content);

      migrateConfigFile(configPath, rawConfig);

      const result = PluginConfigSchema.safeParse(rawConfig);

      if (result.success) {
        log(`Config loaded from ${configPath}`, { agents: result.data.agents });
        return result.data;
      }

      const errorMsg = result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join(", ");
      log(`Config validation error in ${configPath}:`, result.error.issues);
      addConfigLoadError({
        path: configPath,
        error: `Partial config loaded — invalid sections skipped: ${errorMsg}`,
      });

      const partialResult = parseConfigPartially(rawConfig);
      if (partialResult) {
        log(`Partial config loaded from ${configPath}`, { agents: partialResult.agents });
        return partialResult;
      }

      return null;
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Error loading config from ${configPath}:`, err);
    addConfigLoadError({ path: configPath, error: errorMsg });
  }
  return null;
}

export function mergeConfigs(
  base: PluginConfig,
  override: PluginConfig
): PluginConfig {
  return {
    ...base,
    ...override,
    agents: deepMerge(base.agents, override.agents),
    categories: deepMerge(base.categories, override.categories),
    disabled_agents: [
      ...new Set([
        ...(base.disabled_agents ?? []),
        ...(override.disabled_agents ?? []),
      ]),
    ],
    disabled_mcps: [
      ...new Set([
        ...(base.disabled_mcps ?? []),
        ...(override.disabled_mcps ?? []),
      ]),
    ],
    disabled_hooks: [
      ...new Set([
        ...(base.disabled_hooks ?? []),
        ...(override.disabled_hooks ?? []),
      ]),
    ],
    disabled_commands: [
      ...new Set([
        ...(base.disabled_commands ?? []),
        ...(override.disabled_commands ?? []),
      ]),
    ],
    disabled_skills: [
      ...new Set([
        ...(base.disabled_skills ?? []),
        ...(override.disabled_skills ?? []),
      ]),
    ],
    claude_code: deepMerge(base.claude_code, override.claude_code),
  };
}

export function loadPluginConfig(
  directory: string,
  ctx: unknown
): PluginConfig {
  // User-level config path - prefer .jsonc over .json, with legacy fallback
  const configDir = getOpenCodeConfigDir({ binary: "opencode" });
  const userBasePath = path.join(configDir, "opencode-plugin");
  const userDetected = detectConfigFile(userBasePath);
  let userConfigPath: string
  if (userDetected.format !== "none") {
    userConfigPath = userDetected.path
  } else {
    // Legacy fallback: check old oh-my-opencode name
    const legacyBasePath = path.join(configDir, "oh-my-opencode");
    const legacyDetected = detectConfigFile(legacyBasePath);
    if (legacyDetected.format !== "none") {
      userConfigPath = legacyDetected.path
      log(`[deprecation] Using legacy config "${legacyDetected.path}". Rename to "opencode-plugin.json[c]" to suppress this warning.`);
    } else {
      userConfigPath = userBasePath + ".json";
    }
  }

  // Project-level config path - prefer .jsonc over .json, with legacy fallback
  const projectBasePath = path.join(directory, ".opencode", "opencode-plugin");
  const projectDetected = detectConfigFile(projectBasePath);
  let projectConfigPath: string
  if (projectDetected.format !== "none") {
    projectConfigPath = projectDetected.path
  } else {
    const legacyProjectBasePath = path.join(directory, ".opencode", "oh-my-opencode");
    const legacyProjectDetected = detectConfigFile(legacyProjectBasePath);
    if (legacyProjectDetected.format !== "none") {
      projectConfigPath = legacyProjectDetected.path
      log(`[deprecation] Using legacy config "${legacyProjectDetected.path}". Rename to "opencode-plugin.json[c]" to suppress this warning.`);
    } else {
      projectConfigPath = projectBasePath + ".json";
    }
  }

  // Load user config first (base)
  let config: PluginConfig =
    loadConfigFromPath(userConfigPath, ctx) ?? {};

  // Override with project config
  const projectConfig = loadConfigFromPath(projectConfigPath, ctx);
  if (projectConfig) {
    config = mergeConfigs(config, projectConfig);
  }

  config = {
    ...config,
  };

  log("Final merged config", {
    agents: config.agents,
    disabled_agents: config.disabled_agents,
    disabled_mcps: config.disabled_mcps,
    disabled_hooks: config.disabled_hooks,
    claude_code: config.claude_code,
  });
  return config;
}
