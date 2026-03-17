// storage.ts — Merged session-recovery storage utilities
//
// Sections (in dependency order):
//   1. Re-exports
//   2. Part ID generation
//   3. Parts reader
//   4. Part content checks
//   5. Messages reader
//   6. Empty messages
//   7. Empty text parts
//   8. Thinking block search
//   9. Orphan thinking search
//  10. Text part injector
//  11. Thinking prepend
//  12. Thinking strip

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "../../plugin/sdk"
import { PART_STORAGE, THINKING_TYPES, META_TYPES } from "./types"
import type { StoredPart, StoredTextPart, StoredMessageMeta, MessageData } from "./types"
import { getMessageDir } from "../../util/opencode-message-dir"
import { log } from "../../util/logger"
import { isSqliteBackend } from "../../config/opencode-storage-detection"
import { normalizeSDKResponse } from "../../model/normalize"
import { isRecord } from "../../hooks/shared/record-type-guard"
import { patchPart, deletePart } from "../../hooks/shared/opencode-http-api"

// ─── Re-exports ──────────────────────────────────────────────────────────────

export { getMessageDir } from "../../util/opencode-message-dir"

type YcClient = PluginInput["client"]

// ─── Part ID Generation ──────────────────────────────────────────────────────

export function generatePartId(): string {
  const timestamp = Date.now().toString(16)
  const random = Math.random().toString(36).substring(2, 10)
  return `prt_${timestamp}${random}`
}

// ─── Parts Reader ────────────────────────────────────────────────────────────

function stamp(part: StoredPart): number | undefined {
  const obj = part as Record<string, unknown>

  if (isRecord(obj.time)) {
    if (typeof obj.time.start === "number") return obj.time.start
    if (typeof obj.time.created === "number") return obj.time.created
  }

  if (isRecord(obj.state) && isRecord(obj.state.time)) {
    if (typeof obj.state.time.start === "number") return obj.state.time.start
    if (typeof obj.state.time.created === "number") return obj.state.time.created
  }

  const match = /^prt_([0-9a-f]+)(?:[a-z0-9]{8})?(?:_|$)/i.exec(part.id)
  if (!match) return undefined

  const parsed = Number.parseInt(match[1], 16)
  return Number.isFinite(parsed) ? parsed : undefined
}

function sortParts(parts: StoredPart[]): StoredPart[] {
  return [...parts].sort((a, b) => {
    const ax = stamp(a)
    const bx = stamp(b)
    if (ax !== undefined && bx !== undefined && ax !== bx) return ax - bx
    if (ax !== undefined) return -1
    if (bx !== undefined) return 1
    return a.id.localeCompare(b.id)
  })
}

export function readParts(messageID: string): StoredPart[] {
  if (isSqliteBackend()) return []

  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return []

  const parts: StoredPart[] = []
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const content = readFileSync(join(partDir, file), "utf-8")
      parts.push(JSON.parse(content))
    } catch {
      continue
    }
  }

  return sortParts(parts)
}

export async function readPartsFromSDK(
  client: YcClient,
  sessionID: string,
  messageID: string,
): Promise<StoredPart[]> {
  try {
    const response = await client.session.message({
      path: { id: sessionID, messageID },
    })

    const data: unknown = response.data
    if (!isRecord(data)) return []

    const rawParts = data.parts
    if (!Array.isArray(rawParts)) return []

    return rawParts
      .map((part: unknown) => {
        if (!isRecord(part) || typeof part.id !== "string" || typeof part.type !== "string") return null
        return { ...part, sessionID, messageID } as StoredPart
      })
      .filter((part): part is StoredPart => part !== null)
  } catch {
    return []
  }
}

// ─── Part Content Checks ─────────────────────────────────────────────────────

export function hasContent(part: StoredPart): boolean {
  if (THINKING_TYPES.has(part.type)) return false
  if (META_TYPES.has(part.type)) return false

  if (part.type === "text") {
    const textPart = part as StoredTextPart
    return !!textPart.text?.trim()
  }

  if (part.type === "tool" || part.type === "tool_use") {
    return true
  }

  if (part.type === "tool_result") {
    return true
  }

  return false
}

export function messageHasContent(messageID: string): boolean {
  const parts = readParts(messageID)
  return parts.some(hasContent)
}

// ─── Messages Reader ─────────────────────────────────────────────────────────

function normalizeSDKMessage(
  sessionID: string,
  value: unknown
): StoredMessageMeta | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== "string") return null

  const roleValue = value.role
  const role: StoredMessageMeta["role"] = roleValue === "assistant" ? "assistant" : "user"

  const created =
    isRecord(value.time) && typeof value.time.created === "number"
      ? value.time.created
      : 0

  return {
    id: value.id,
    sessionID,
    role,
    time: { created },
  }
}

export function readMessages(sessionID: string): StoredMessageMeta[] {
  if (isSqliteBackend()) return []

  const messageDir = getMessageDir(sessionID)
  if (!messageDir || !existsSync(messageDir)) return []

  const messages: StoredMessageMeta[] = []
  for (const file of readdirSync(messageDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const content = readFileSync(join(messageDir, file), "utf-8")
      messages.push(JSON.parse(content))
    } catch {
      continue
    }
  }

  return messages.sort((a, b) => {
    const aTime = a.time?.created ?? 0
    const bTime = b.time?.created ?? 0
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

export async function readMessagesFromSDK(
  client: YcClient,
  sessionID: string
): Promise<StoredMessageMeta[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const data = normalizeSDKResponse(response, [] as unknown[], {
      preferResponseOnMissingData: true,
    })
    if (!Array.isArray(data)) return []

    const messages = data
      .map((msg): StoredMessageMeta | null => normalizeSDKMessage(sessionID, msg))
      .filter((msg): msg is StoredMessageMeta => msg !== null)

    return messages.sort((a, b) => {
      const aTime = a.time?.created ?? 0
      const bTime = b.time?.created ?? 0
      if (aTime !== bTime) return aTime - bTime
      return a.id.localeCompare(b.id)
    })
  } catch {
    return []
  }
}

// ─── Empty Messages ──────────────────────────────────────────────────────────

export function findEmptyMessages(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const emptyIds: string[] = []

  for (const msg of messages) {
    if (!messageHasContent(msg.id)) {
      emptyIds.push(msg.id)
    }
  }

  return emptyIds
}

export function findEmptyMessageByIndex(sessionID: string, targetIndex: number): string | null {
  const messages = readMessages(sessionID)

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

    if (!messageHasContent(targetMessage.id)) {
      return targetMessage.id
    }
  }

  return null
}

export function findFirstEmptyMessage(sessionID: string): string | null {
  const emptyIds = findEmptyMessages(sessionID)
  return emptyIds.length > 0 ? emptyIds[0] : null
}

// ─── Empty Text Parts ────────────────────────────────────────────────────────

export function findMessagesWithEmptyTextParts(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (const msg of messages) {
    const parts = readParts(msg.id)
    const hasEmptyTextPart = parts.some((part) => {
      if (part.type !== "text") return false
      const textPart = part as StoredTextPart
      return !textPart.text?.trim()
    })

    if (hasEmptyTextPart) {
      result.push(msg.id)
    }
  }

  return result
}

export async function findMessagesWithEmptyTextPartsFromSDK(
  client: YcClient,
  sessionID: string
): Promise<string[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })
    const result: string[] = []

    for (const msg of messages) {
      if (!msg.parts || !msg.info?.id) continue
      const hasEmpty = msg.parts.some((p) => p.type === "text" && !p.text?.trim())
      if (hasEmpty) result.push(msg.info.id)
    }

    return result
  } catch {
    return []
  }
}

export function replaceEmptyTextParts(messageID: string, replacementText: string): boolean {
  if (isSqliteBackend()) {
    log("[session-recovery] Disabled on SQLite backend: replaceEmptyTextParts (use async variant)")
    return false
  }

  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return false

  let anyReplaced = false
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const filePath = join(partDir, file)
      const content = readFileSync(filePath, "utf-8")
      const part = JSON.parse(content) as StoredPart

      if (part.type === "text") {
        const textPart = part as StoredTextPart
        if (!textPart.text?.trim()) {
          textPart.text = replacementText
          textPart.synthetic = true
          writeFileSync(filePath, JSON.stringify(textPart, null, 2))
          anyReplaced = true
        }
      }
    } catch {
      continue
    }
  }

  return anyReplaced
}

export async function replaceEmptyTextPartsAsync(
  client: YcClient,
  sessionID: string,
  messageID: string,
  replacementText: string
): Promise<boolean> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })

    const targetMsg = messages.find((m) => m.info?.id === messageID)
    if (!targetMsg?.parts) return false

    let anyReplaced = false
    for (const part of targetMsg.parts) {
      if (part.type === "text" && !part.text?.trim() && part.id) {
        const patched = await patchPart(client, sessionID, messageID, part.id, {
          ...part,
          text: replacementText,
          synthetic: true,
        })
        if (patched) anyReplaced = true
      }
    }

    return anyReplaced
  } catch (error) {
    log("[session-recovery] replaceEmptyTextPartsAsync failed", { error: String(error) })
    return false
  }
}

// ─── Thinking Block Search ───────────────────────────────────────────────────

export function findMessagesWithThinkingBlocks(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (const msg of messages) {
    if (msg.role !== "assistant") continue

    const parts = readParts(msg.id)
    const hasThinking = parts.some((part) => THINKING_TYPES.has(part.type))
    if (hasThinking) {
      result.push(msg.id)
    }
  }

  return result
}

export function findMessagesWithThinkingOnly(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (const msg of messages) {
    if (msg.role !== "assistant") continue

    const parts = readParts(msg.id)
    if (parts.length === 0) continue

    const hasThinking = parts.some((part) => THINKING_TYPES.has(part.type))
    const hasTextContent = parts.some(hasContent)

    if (hasThinking && !hasTextContent) {
      result.push(msg.id)
    }
  }

  return result
}

// ─── Orphan Thinking Search ──────────────────────────────────────────────────

export function findMessagesWithOrphanThinking(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (const msg of messages) {
    if (msg.role !== "assistant") continue

    const parts = readParts(msg.id)
    if (parts.length === 0) continue

    const firstPart = parts[0]
    const firstIsThinking = THINKING_TYPES.has(firstPart.type)

    if (!firstIsThinking) {
      result.push(msg.id)
    }
  }

  return result
}

export function findMessageByIndexNeedingThinking(sessionID: string, targetIndex: number): string | null {
  const messages = readMessages(sessionID)

  if (targetIndex < 0 || targetIndex >= messages.length) return null

  const targetMessage = messages[targetIndex]
  if (targetMessage.role !== "assistant") return null

  const parts = readParts(targetMessage.id)
  if (parts.length === 0) return null

  const firstPart = parts[0]
  const firstIsThinking = THINKING_TYPES.has(firstPart.type)

  return firstIsThinking ? null : targetMessage.id
}

// ─── Text Part Injector ──────────────────────────────────────────────────────

export function injectTextPart(sessionID: string, messageID: string, text: string): boolean {
  if (isSqliteBackend()) {
    log("[session-recovery] Disabled on SQLite backend: injectTextPart (use async variant)")
    return false
  }

  const partDir = join(PART_STORAGE, messageID)

  if (!existsSync(partDir)) {
    mkdirSync(partDir, { recursive: true })
  }

  const partId = generatePartId()
  const part: StoredTextPart = {
    id: partId,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: true,
  }

  try {
    writeFileSync(join(partDir, `${partId}.json`), JSON.stringify(part, null, 2))
    return true
  } catch {
    return false
  }
}

export async function injectTextPartAsync(
  client: YcClient,
  sessionID: string,
  messageID: string,
  text: string
): Promise<boolean> {
  const partId = generatePartId()
  const part: Record<string, unknown> = {
    id: partId,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: true,
  }

  try {
    return await patchPart(client, sessionID, messageID, partId, part)
  } catch (error) {
    log("[session-recovery] injectTextPartAsync failed", { error: String(error) })
    return false
  }
}

// ─── Thinking Prepend ────────────────────────────────────────────────────────

function findLastThinkingContent(sessionID: string, beforeMessageID: string): string {
  const messages = readMessages(sessionID)

  const currentIndex = messages.findIndex((message) => message.id === beforeMessageID)
  if (currentIndex === -1) return ""

  for (let i = currentIndex - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "assistant") continue

    const parts = readParts(message.id)
    for (const part of [...parts].reverse()) {
      if (THINKING_TYPES.has(part.type)) {
        const thinking = (part as { thinking?: string; text?: string }).thinking
        const reasoning = (part as { thinking?: string; text?: string }).text
        const content = thinking || reasoning
        if (content && content.trim().length > 0) {
          return content
        }
      }
    }
  }

  return ""
}

export function prependThinkingPart(sessionID: string, messageID: string): boolean {
  if (isSqliteBackend()) {
    log("[session-recovery] Disabled on SQLite backend: prependThinkingPart (use async variant)")
    return false
  }

  const partDir = join(PART_STORAGE, messageID)

  if (!existsSync(partDir)) {
    mkdirSync(partDir, { recursive: true })
  }

  const previousThinking = findLastThinkingContent(sessionID, messageID)

  const partId = `prt_0000000000_${messageID}_thinking`
  const part = {
    id: partId,
    sessionID,
    messageID,
    type: "thinking",
    thinking: previousThinking || "[Continuing from previous reasoning]",
    synthetic: true,
  }

  try {
    writeFileSync(join(partDir, `${partId}.json`), JSON.stringify(part, null, 2))
    return true
  } catch {
    return false
  }
}

async function findLastThinkingContentFromSDK(
  client: YcClient,
  sessionID: string,
  beforeMessageID: string,
): Promise<string> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })

    const currentIndex = messages.findIndex((m) => m.info?.id === beforeMessageID)
    if (currentIndex === -1) return ""

    for (let i = currentIndex - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.info?.role !== "assistant") continue
      if (!msg.parts) continue

      for (const part of [...msg.parts].reverse()) {
        if (part.type && THINKING_TYPES.has(part.type)) {
          const content = part.thinking || part.text
          if (content && content.trim().length > 0) return content
        }
      }
    }
  } catch {
    return ""
  }
  return ""
}

export async function prependThinkingPartAsync(
  client: YcClient,
  sessionID: string,
  messageID: string,
): Promise<boolean> {
  const previousThinking = await findLastThinkingContentFromSDK(client, sessionID, messageID)

  const partId = `prt_0000000000_${messageID}_thinking`
  const part: Record<string, unknown> = {
    id: partId,
    sessionID,
    messageID,
    type: "thinking",
    thinking: previousThinking || "[Continuing from previous reasoning]",
    synthetic: true,
  }

  try {
    return await patchPart(client, sessionID, messageID, partId, part)
  } catch (error) {
    log("[session-recovery] prependThinkingPartAsync failed", { error: String(error) })
    return false
  }
}

// ─── Thinking Strip ──────────────────────────────────────────────────────────

export function stripThinkingParts(messageID: string): boolean {
  if (isSqliteBackend()) {
    log("[session-recovery] Disabled on SQLite backend: stripThinkingParts (use async variant)")
    return false
  }

  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return false

  let anyRemoved = false
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const filePath = join(partDir, file)
      const content = readFileSync(filePath, "utf-8")
      const part = JSON.parse(content) as StoredPart
      if (THINKING_TYPES.has(part.type)) {
        unlinkSync(filePath)
        anyRemoved = true
      }
    } catch {
      continue
    }
  }

  return anyRemoved
}

export async function stripThinkingPartsAsync(
  client: YcClient,
  sessionID: string,
  messageID: string
): Promise<boolean> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as Array<{ parts?: Array<{ type: string; id: string }> }>, { preferResponseOnMissingData: true })

    const targetMsg = messages.find((m) => {
      const info = (m as Record<string, unknown>)["info"] as Record<string, unknown> | undefined
      return info?.["id"] === messageID
    })
    if (!targetMsg?.parts) return false

    let anyRemoved = false
    for (const part of targetMsg.parts) {
      if (THINKING_TYPES.has(part.type) && part.id) {
        const deleted = await deletePart(client, sessionID, messageID, part.id)
        if (deleted) anyRemoved = true
      }
    }

    return anyRemoved
  } catch (error) {
    log("[session-recovery] stripThinkingPartsAsync failed", { error: String(error) })
    return false
  }
}
