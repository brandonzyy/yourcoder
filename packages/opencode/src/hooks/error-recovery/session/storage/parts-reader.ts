import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "../../../../plugin/sdk"
import { PART_STORAGE } from "../constants"
import type { StoredPart } from "../types"
import { isSqliteBackend } from "../../../../config/opencode-storage-detection"
import { isRecord } from "../../../shared/record-type-guard"

type OpencodeClient = PluginInput["client"]

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

function sort(parts: StoredPart[]): StoredPart[] {
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

  return sort(parts)
}

export async function readPartsFromSDK(
  client: OpencodeClient,
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
