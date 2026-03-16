// Merged from tool-part-types.ts

export interface StoredToolPart {
	id: string
	sessionID: string
	messageID: string
	type: "tool"
	callID: string
	tool: string
	state: {
		status: "pending" | "running" | "completed" | "error"
		input: Record<string, unknown>
		output?: string
		error?: string
		time?: {
			start: number
			end?: number
			compacted?: number
		}
	}
	truncated?: boolean
	originalSize?: number
}

export interface ToolResultInfo {
	partPath: string
	partId: string
	messageID: string
	toolName: string
	outputSize: number
}

export interface AggressiveTruncateResult {
	success: boolean
	sufficient: boolean
	truncatedCount: number
	totalBytesRemoved: number
	targetBytesToRemove: number
	truncatedTools: Array<{ toolName: string; originalSize: number }>
}

// Original pruning-types.ts

export interface ToolCallSignature {
  toolName: string
  signature: string
  callID: string
  turn: number
}

export interface FileOperation {
  callID: string
  tool: string
  filePath: string
  turn: number
}

export interface ErroredToolCall {
  callID: string
  toolName: string
  turn: number
  errorAge: number
}

export interface PruningResult {
  itemsPruned: number
  totalTokensSaved: number
  strategies: {
    deduplication: number
    supersedeWrites: number
    purgeErrors: number
  }
}

export interface PruningState {
  toolIdsToPrune: Set<string>
  currentTurn: number
  fileOperations: Map<string, FileOperation[]>
  toolSignatures: Map<string, ToolCallSignature[]>
  erroredTools: Map<string, ErroredToolCall>
}

export const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}
