/**
 * Local proxy for @opencode-ai/plugin SDK types and functions.
 * All opencode code should import from here instead of directly from the plugin package.
 * This provides a single point of change for future SDK decoupling.
 */
export { tool } from "@opencode-ai/plugin"
export type {
  PluginInput,
  Plugin,
  Hooks,
  AuthHook,
  AuthOuathResult,
  ProviderContext,
  ToolContext,
  ToolDefinition,
} from "@opencode-ai/plugin"
