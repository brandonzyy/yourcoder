import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { PART_STORAGE_DIR, TRUNCATION_MESSAGE } from "./types"
import { getMessageDir } from "../../util/opencode-message-dir"
import type { StoredToolPart, ToolResultInfo } from "./types"
import { isSqliteBackend } from "../../config/opencode-storage-detection"
import { log } from "../../util/logger"
import type { PluginInput } from "../../plugin/sdk"
import { patchPart } from "../../hooks/shared/opencode-http-api"
import { normalizeSDKResponse } from "../../model/normalize"

// --- File-based helpers ---

let hasLoggedTruncateWarning = false

function getMessageIds(sessionID: string): string[] {
	const messageDir = getMessageDir(sessionID)
	if (!messageDir || !existsSync(messageDir)) return []

	const messageIds: string[] = []
	for (const file of readdirSync(messageDir)) {
		if (!file.endsWith(".json")) continue
		messageIds.push(file.replace(".json", ""))
	}
	return messageIds
}

export function findToolResultsBySize(sessionID: string): ToolResultInfo[] {
	const messageIds = getMessageIds(sessionID)
	const results: ToolResultInfo[] = []

	for (const messageID of messageIds) {
		const partDir = join(PART_STORAGE_DIR, messageID)
		if (!existsSync(partDir)) continue

		for (const file of readdirSync(partDir)) {
			if (!file.endsWith(".json")) continue
			try {
				const partPath = join(partDir, file)
				const content = readFileSync(partPath, "utf-8")
				const part = JSON.parse(content) as StoredToolPart

				if (part.type === "tool" && part.state?.output && !part.truncated) {
					results.push({
						partPath,
						partId: part.id,
						messageID,
						toolName: part.tool,
						outputSize: part.state.output.length,
					})
				}
			} catch {
				continue
			}
		}
	}

	return results.sort((a, b) => b.outputSize - a.outputSize)
}

export function findLargestToolResult(sessionID: string): ToolResultInfo | null {
	const results = findToolResultsBySize(sessionID)
	return results.length > 0 ? results[0] : null
}

export function truncateToolResult(partPath: string): {
	success: boolean
	toolName?: string
	originalSize?: number
} {
	if (isSqliteBackend()) {
		if (!hasLoggedTruncateWarning) {
			log("[context-window-recovery] Disabled on SQLite backend: truncateToolResult")
			hasLoggedTruncateWarning = true
		}
		return { success: false }
	}

	try {
		const content = readFileSync(partPath, "utf-8")
		const part = JSON.parse(content) as StoredToolPart

		if (!part.state?.output) {
			return { success: false }
		}

		const originalSize = part.state.output.length
		const toolName = part.tool

		part.truncated = true
		part.originalSize = originalSize
		part.state.output = TRUNCATION_MESSAGE

		if (!part.state.time) {
			part.state.time = { start: Date.now() }
		}
		part.state.time.compacted = Date.now()

		writeFileSync(partPath, JSON.stringify(part, null, 2))

		return { success: true, toolName, originalSize }
	} catch {
		return { success: false }
	}
}

export function getTotalToolOutputSize(sessionID: string): number {
	const results = findToolResultsBySize(sessionID)
	return results.reduce((sum, result) => sum + result.outputSize, 0)
}

export function countTruncatedResults(sessionID: string): number {
	const messageIds = getMessageIds(sessionID)
	let count = 0

	for (const messageID of messageIds) {
		const partDir = join(PART_STORAGE_DIR, messageID)
		if (!existsSync(partDir)) continue

		for (const file of readdirSync(partDir)) {
			if (!file.endsWith(".json")) continue
			try {
				const content = readFileSync(join(partDir, file), "utf-8")
				const part = JSON.parse(content)
				if (part.truncated === true) {
					count++
				}
			} catch {
				continue
			}
		}
	}

	return count
}

// --- SDK-based helpers (merged from tool-result-storage-sdk.ts) ---

type YcClient = PluginInput["client"]

interface SDKToolPart {
  id: string
  type: string
  callID?: string
  tool?: string
  state?: {
    status?: string
    input?: Record<string, unknown>
    output?: string
    error?: string
    time?: { start?: number; end?: number; compacted?: number }
  }
}

interface SDKMessage {
  info?: { id?: string }
  parts?: SDKToolPart[]
}

export async function findToolResultsBySizeFromSDK(
  client: YcClient,
  sessionID: string
): Promise<ToolResultInfo[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as SDKMessage[], { preferResponseOnMissingData: true })
    const results: ToolResultInfo[] = []

    for (const msg of messages) {
      const messageID = msg.info?.id
      if (!messageID || !msg.parts) continue

      for (const part of msg.parts) {
        if (part.type === "tool" && part.state?.output && !part.state?.time?.compacted && part.tool) {
          results.push({
            partPath: "",
            partId: part.id,
            messageID,
            toolName: part.tool,
            outputSize: part.state.output.length,
          })
        }
      }
    }

    return results.sort((a, b) => b.outputSize - a.outputSize)
  } catch {
    return []
  }
}

export async function truncateToolResultAsync(
  client: YcClient,
  sessionID: string,
  messageID: string,
  partId: string,
  part: SDKToolPart
): Promise<{ success: boolean; toolName?: string; originalSize?: number }> {
  if (!part.state?.output) return { success: false }

  const originalSize = part.state.output.length
  const toolName = part.tool

  const updatedPart: Record<string, unknown> = {
    ...part,
    state: {
      ...part.state,
      output: TRUNCATION_MESSAGE,
      time: {
        ...(part.state.time ?? { start: Date.now() }),
        compacted: Date.now(),
      },
    },
  }

  try {
    const patched = await patchPart(client, sessionID, messageID, partId, updatedPart)
    if (!patched) return { success: false }
    return { success: true, toolName, originalSize }
  } catch (error) {
    log("[context-window-recovery] truncateToolResultAsync failed", { error: String(error) })
    return { success: false }
  }
}

export async function countTruncatedResultsFromSDK(
  client: YcClient,
  sessionID: string
): Promise<number> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as SDKMessage[], { preferResponseOnMissingData: true })
    let count = 0

    for (const msg of messages) {
      if (!msg.parts) continue
      for (const part of msg.parts) {
        if (part.type === "tool" && part.state?.time?.compacted) count++
      }
    }

    return count
  } catch {
    return 0
  }
}

export async function getTotalToolOutputSizeFromSDK(
  client: YcClient,
  sessionID: string
): Promise<number> {
  const results = await findToolResultsBySizeFromSDK(client, sessionID)
  return results.reduce((sum, result) => sum + result.outputSize, 0)
}
