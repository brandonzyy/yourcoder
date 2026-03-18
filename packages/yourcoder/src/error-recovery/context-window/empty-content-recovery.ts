import {
  findEmptyMessages,
  findEmptyMessageByIndex,
  injectTextPart,
  replaceEmptyTextParts,
  replaceEmptyTextPartsAsync,
  injectTextPartAsync,
} from "../session/storage"
import { isSqliteBackend } from "../../config/opencode-storage-detection"
import type { AutoCompactState, Client } from "./types"
import { incrementEmptyContentAttempt, IGNORE_TYPES, TOOL_TYPES } from "./types"
import { PLACEHOLDER_TEXT } from "./message-builder"

// --- SDK helpers (merged from empty-content-recovery-sdk.ts) ---

interface SDKPart {
  id?: string
  type?: string
  text?: string
}

interface SDKMessage {
  info?: { id?: string }
  parts?: SDKPart[]
}

function messageHasContentFromSDK(message: SDKMessage): boolean {
  const parts = message.parts
  if (!parts || parts.length === 0) return false

  for (const part of parts) {
    const type = part.type
    if (!type) continue
    if (IGNORE_TYPES.has(type)) {
      continue
    }

    if (type === "text") {
      if (part.text?.trim()) return true
      continue
    }

    if (TOOL_TYPES.has(type)) return true

    return true
  }

  // Messages with only thinking/meta parts are treated as empty
  // to align with file-based logic (messageHasContent)
  return false
}

function getSdkMessages(response: unknown): SDKMessage[] {
  if (typeof response !== "object" || response === null) return []
  if (Array.isArray(response)) return response as SDKMessage[]
  const record = response as Record<string, unknown>
  const data = record["data"]
  if (Array.isArray(data)) return data as SDKMessage[]
  return Array.isArray(record) ? (record as SDKMessage[]) : []
}

async function findEmptyMessagesFromSDK(client: Client, sessionID: string): Promise<string[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = getSdkMessages(response)

    const emptyIds: string[] = []
    for (const message of messages) {
      const messageID = message.info?.id
      if (!messageID) continue
      if (!messageHasContentFromSDK(message)) {
        emptyIds.push(messageID)
      }
    }

    return emptyIds
  } catch {
    return []
  }
}

async function findEmptyMessageByIndexFromSDK(
  client: Client,
  sessionID: string,
  targetIndex: number,
): Promise<string | null> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = getSdkMessages(response)

    const indicesToTry = [
      targetIndex,
      targetIndex - 1,
      targetIndex + 1,
      targetIndex - 2,
      targetIndex + 2,
      targetIndex - 3,
      targetIndex - 4,
      targetIndex - 5,
    ]

    for (const index of indicesToTry) {
      if (index < 0 || index >= messages.length) continue

      const targetMessage = messages[index]
      const targetMessageId = targetMessage?.info?.id
      if (!targetMessageId) continue

      if (!messageHasContentFromSDK(targetMessage)) {
        return targetMessageId
      }
    }

    return null
  } catch {
    return null
  }
}

export async function fixEmptyMessagesWithSDK(params: {
  sessionID: string
  client: Client
  placeholderText: string
  messageIndex?: number
}): Promise<{ fixed: boolean; fixedMessageIds: string[]; scannedEmptyCount: number }> {
  let fixed = false
  const fixedMessageIds: string[] = []

  if (params.messageIndex !== undefined) {
    const targetMessageId = await findEmptyMessageByIndexFromSDK(
      params.client,
      params.sessionID,
      params.messageIndex,
    )

    if (targetMessageId) {
      const replaced = await replaceEmptyTextPartsAsync(
        params.client,
        params.sessionID,
        targetMessageId,
        params.placeholderText,
      )

      if (replaced) {
        fixed = true
        fixedMessageIds.push(targetMessageId)
      } else {
        const injected = await injectTextPartAsync(
          params.client,
          params.sessionID,
          targetMessageId,
          params.placeholderText,
        )

        if (injected) {
          fixed = true
          fixedMessageIds.push(targetMessageId)
        }
      }
    }
  }

  if (fixed) {
    return { fixed, fixedMessageIds, scannedEmptyCount: 0 }
  }

  const emptyMessageIds = await findEmptyMessagesFromSDK(params.client, params.sessionID)
  if (emptyMessageIds.length === 0) {
    return { fixed: false, fixedMessageIds: [], scannedEmptyCount: 0 }
  }

  for (const messageID of emptyMessageIds) {
    const replaced = await replaceEmptyTextPartsAsync(
      params.client,
      params.sessionID,
      messageID,
      params.placeholderText,
    )

    if (replaced) {
      fixed = true
      fixedMessageIds.push(messageID)
    } else {
      const injected = await injectTextPartAsync(
        params.client,
        params.sessionID,
        messageID,
        params.placeholderText,
      )

      if (injected) {
        fixed = true
        fixedMessageIds.push(messageID)
      }
    }
  }

  return { fixed, fixedMessageIds, scannedEmptyCount: emptyMessageIds.length }
}

// --- Main entry point ---

export async function fixEmptyMessages(params: {
  sessionID: string
  autoCompactState: AutoCompactState
  client: Client
  messageIndex?: number
}): Promise<boolean> {
  incrementEmptyContentAttempt(params.autoCompactState, params.sessionID)

  let fixed = false
  const fixedMessageIds: string[] = []

  if (isSqliteBackend()) {
    const result = await fixEmptyMessagesWithSDK({
      sessionID: params.sessionID,
      client: params.client,
      placeholderText: PLACEHOLDER_TEXT,
      messageIndex: params.messageIndex,
    })

    if (!result.fixed && result.scannedEmptyCount === 0) {
      await params.client.tui
        .showToast({
          body: {
            title: "Empty Content Error",
            message: "No empty messages found in storage. Cannot auto-recover.",
            variant: "error",
            duration: 5000,
          },
        })
        .catch(() => {})
      return false
    }

    if (result.fixed) {
      await params.client.tui
        .showToast({
          body: {
            title: "Session Recovery",
            message: `Fixed ${result.fixedMessageIds.length} empty message(s). Retrying...`,
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {})
    }

    return result.fixed
  }

  if (params.messageIndex !== undefined) {
    const targetMessageId = findEmptyMessageByIndex(params.sessionID, params.messageIndex)
    if (targetMessageId) {
      const replaced = replaceEmptyTextParts(targetMessageId, PLACEHOLDER_TEXT)
      if (replaced) {
        fixed = true
        fixedMessageIds.push(targetMessageId)
      } else {
        const injected = injectTextPart(params.sessionID, targetMessageId, PLACEHOLDER_TEXT)
        if (injected) {
          fixed = true
          fixedMessageIds.push(targetMessageId)
        }
      }
    }
  }

  if (!fixed) {
    const emptyMessageIds = findEmptyMessages(params.sessionID)
    if (emptyMessageIds.length === 0) {
      await params.client.tui
        .showToast({
          body: {
            title: "Empty Content Error",
            message: "No empty messages found in storage. Cannot auto-recover.",
            variant: "error",
            duration: 5000,
          },
        })
        .catch(() => {})
      return false
    }

    for (const messageID of emptyMessageIds) {
      const replaced = replaceEmptyTextParts(messageID, PLACEHOLDER_TEXT)
      if (replaced) {
        fixed = true
        fixedMessageIds.push(messageID)
      } else {
        const injected = injectTextPart(params.sessionID, messageID, PLACEHOLDER_TEXT)
        if (injected) {
          fixed = true
          fixedMessageIds.push(messageID)
        }
      }
    }
  }

  if (fixed) {
    await params.client.tui
      .showToast({
        body: {
          title: "Session Recovery",
          message: `Fixed ${fixedMessageIds.length} empty message(s). Retrying...`,
          variant: "warning",
          duration: 3000,
        },
      })
      .catch(() => {})
  }

  return fixed
}
