import { APICallError, LoadAPIKeyError } from "ai"
import { NamedError } from "@yourcoder/util/error"
import z from "zod"
import { Database, desc, eq, inArray } from "../../storage/db"
import { fn } from "../../util/fn"
import { Identifier } from "../../util/id"
import { ProviderError } from "../../provider/error"
import type { SystemError } from "bun"
import { MessageTable, PartTable } from "../session.sql"
import { MessageV2 } from "../message-v2"

export const stream = fn(Identifier.schema("session"), async function* (sessionID) {
  const size = 50
  let offset = 0
  while (true) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(MessageTable)
        .where(eq(MessageTable.session_id, sessionID))
        .orderBy(desc(MessageTable.time_created))
        .limit(size)
        .offset(offset)
        .all(),
    )
    if (rows.length === 0) break

    const ids = rows.map((row) => row.id)
    const partsByMessage = new Map<string, MessageV2.Part[]>()
    if (ids.length > 0) {
      const partRows = Database.use((db) =>
        db
          .select()
          .from(PartTable)
          .where(inArray(PartTable.message_id, ids))
          .orderBy(PartTable.message_id, PartTable.id)
          .all(),
      )
      for (const row of partRows) {
        const part = {
          ...row.data,
          id: row.id,
          sessionID: row.session_id,
          messageID: row.message_id,
        } as MessageV2.Part
        const list = partsByMessage.get(row.message_id)
        if (list) list.push(part)
        else partsByMessage.set(row.message_id, [part])
      }
    }

    for (const row of rows) {
      const info = { ...row.data, id: row.id, sessionID: row.session_id } as MessageV2.Info
      yield {
        info,
        parts: partsByMessage.get(row.id) ?? [],
      }
    }

    offset += rows.length
    if (rows.length < size) break
  }
})

export const parts = fn(Identifier.schema("message"), async (message_id) => {
  const rows = Database.use((db) =>
    db.select().from(PartTable).where(eq(PartTable.message_id, message_id)).orderBy(PartTable.id).all(),
  )
  return rows.map(
    (row) => ({ ...row.data, id: row.id, sessionID: row.session_id, messageID: row.message_id }) as MessageV2.Part,
  )
})

export const get = fn(
  z.object({
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message"),
  }),
  async (input): Promise<MessageV2.WithParts> => {
    const row = Database.use((db) => db.select().from(MessageTable).where(eq(MessageTable.id, input.messageID)).get())
    if (!row) throw new Error(`Message not found: ${input.messageID}`)
    const info = { ...row.data, id: row.id, sessionID: row.session_id } as MessageV2.Info
    return {
      info,
      parts: await parts(input.messageID),
    }
  },
)

export async function filterCompacted(stream: AsyncIterable<MessageV2.WithParts>) {
  const result = [] as MessageV2.WithParts[]
  const completed = new Set<string>()
  for await (const msg of stream) {
    result.push(msg)
    if (
      msg.info.role === "user" &&
      completed.has(msg.info.id) &&
      msg.parts.some((part) => part.type === "compaction")
    ) {
      break
    }
    if (msg.info.role === "assistant" && msg.info.summary && msg.info.finish && !msg.info.error) {
      completed.add(msg.info.parentID)
    }
  }
  result.reverse()
  return result
}

export function fromError(e: unknown, ctx: { providerID: string }) {
  switch (true) {
    case e instanceof DOMException && e.name === "AbortError":
      return new MessageV2.AbortedError(
        { message: e.message },
        {
          cause: e,
        },
      ).toObject()
    case MessageV2.OutputLengthError.isInstance(e):
      return e
    case LoadAPIKeyError.isInstance(e):
      return new MessageV2.AuthError(
        {
          providerID: ctx.providerID,
          message: e.message,
        },
        { cause: e },
      ).toObject()
    case (e as SystemError)?.code === "ECONNRESET":
      return new MessageV2.APIError(
        {
          message: "Connection reset by server",
          isRetryable: true,
          metadata: {
            code: (e as SystemError).code ?? "",
            syscall: (e as SystemError).syscall ?? "",
            message: (e as SystemError).message ?? "",
          },
        },
        { cause: e },
      ).toObject()
    case APICallError.isInstance(e): {
      const parsed = ProviderError.parseAPICallError({
        providerID: ctx.providerID,
        error: e,
      })
      if (parsed.type === "context_overflow") {
        return new MessageV2.ContextOverflowError(
          {
            message: parsed.message,
            responseBody: parsed.responseBody,
          },
          { cause: e },
        ).toObject()
      }

      return new MessageV2.APIError(
        {
          message: parsed.message,
          statusCode: parsed.statusCode,
          isRetryable: parsed.isRetryable,
          responseHeaders: parsed.responseHeaders,
          responseBody: parsed.responseBody,
          metadata: parsed.metadata,
        },
        { cause: e },
      ).toObject()
    }
    case e instanceof Error:
      return new NamedError.Unknown({ message: e.toString() }, { cause: e }).toObject()
    default:
      try {
        const parsed = ProviderError.parseStreamError(e)
        if (parsed) {
          if (parsed.type === "context_overflow") {
            return new MessageV2.ContextOverflowError(
              {
                message: parsed.message,
                responseBody: parsed.responseBody,
              },
              { cause: e },
            ).toObject()
          }
          return new MessageV2.APIError(
            {
              message: parsed.message,
              isRetryable: parsed.isRetryable,
              responseBody: parsed.responseBody,
            },
            {
              cause: e,
            },
          ).toObject()
        }
      } catch {}
      return new NamedError.Unknown({ message: JSON.stringify(e) }, { cause: e }).toObject()
  }
}
