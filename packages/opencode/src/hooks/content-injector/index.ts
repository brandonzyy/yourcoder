import type { PluginInput } from "@opencode-ai/plugin";
import { createContentInjectorHook } from "./framework";

export function createDirectoryAgentsInjectorHook(
  ctx: PluginInput,
  modelCacheState?: { anthropicContext1MEnabled: boolean },
) {
  return createContentInjectorHook(ctx, {
    filename: "AGENTS.md",
    storageName: "directory-agents",
    outputLabel: "Directory Context",
    skipRoot: true,
  }, modelCacheState);
}

export function createDirectoryReadmeInjectorHook(
  ctx: PluginInput,
  modelCacheState?: { anthropicContext1MEnabled: boolean },
) {
  return createContentInjectorHook(ctx, {
    filename: "README.md",
    storageName: "directory-readme",
    outputLabel: "Project README",
    skipRoot: false,
  }, modelCacheState);
}
