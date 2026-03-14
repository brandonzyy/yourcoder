// Simplified tools barrel — only exports modules that still exist.
// Deleted tools (grep, glob, ast-grep, session-manager, task, background-task,
// call-omo-agent, lsp) are now handled natively or stubbed out.

import type { ToolDefinition } from "@opencode-ai/plugin"

export { interactive_bash, startBackgroundCheck as startTmuxCheck } from "./interactive-bash"
export { createDelegateTask } from "./delegate-task"
export { createHashlineEditTool } from "./hashline-edit"
export { createLookAt } from "./look-at"

// Stubs for deleted tools — these are registered natively now
export function createGrepTools(..._args: unknown[]): Record<string, ToolDefinition> { return {} }
export function createGlobTools(..._args: unknown[]): Record<string, ToolDefinition> { return {} }
export function createAstGrepTools(..._args: unknown[]): Record<string, ToolDefinition> { return {} }
export function createSessionManagerTools(..._args: unknown[]): Record<string, ToolDefinition> { return {} }
export function createCallOmoAgent(..._args: unknown[]): ToolDefinition { return {} as ToolDefinition }
export function createTaskCreateTool(..._args: unknown[]): ToolDefinition { return {} as ToolDefinition }
export function createTaskGetTool(..._args: unknown[]): ToolDefinition { return {} as ToolDefinition }
export function createTaskList(..._args: unknown[]): ToolDefinition { return {} as ToolDefinition }
export function createTaskUpdateTool(..._args: unknown[]): ToolDefinition { return {} as ToolDefinition }
export function sessionExists(_sessionID: string): boolean { return false }

export function createBackgroundTools(..._args: unknown[]): Record<string, ToolDefinition> { return {} }

// LSP manager stub — the real LSP tools are registered natively
export const lspManager = {
  cleanupTempDirectoryClients: async () => {},
}

export const builtinTools: Record<string, ToolDefinition> = {}
