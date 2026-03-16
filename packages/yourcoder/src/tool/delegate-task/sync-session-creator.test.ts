import { describe, expect, it, mock } from "bun:test"
import { createSyncSession } from "./sync"

describe("createSyncSession", () => {
  it("creates a child session in the parent directory when available", async () => {
    const client = {
      session: {
        get: mock(async () => ({ data: { directory: "/tmp/parent" } })) as never,
        create: mock(async () => ({ data: { id: "ses_child" } })) as never,
      } as unknown as Parameters<typeof createSyncSession>[0]["session"],
    } as unknown as Parameters<typeof createSyncSession>[0]

    const res = await createSyncSession(client, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "Find issue",
      defaultDirectory: "/tmp/default",
    })

    expect(res).toEqual({
      ok: true,
      sessionID: "ses_child",
      parentDirectory: "/tmp/parent",
    })
    expect(client.session.create).toHaveBeenCalledWith({
      body: {
        parentID: "ses_parent",
        title: "Find issue (@explore subagent)",
      },
      query: {
        directory: "/tmp/parent",
      },
    })
  })

  it("returns an error result when session creation fails", async () => {
    const client = {
      session: {
        get: mock(async () => null) as never,
        create: mock(async () => ({ error: "permission denied" })) as never,
      } as unknown as Parameters<typeof createSyncSession>[0]["session"],
    } as unknown as Parameters<typeof createSyncSession>[0]

    const res = await createSyncSession(client, {
      parentSessionID: "ses_parent",
      agentToUse: "explore",
      description: "Find issue",
      defaultDirectory: "/tmp/default",
    })

    expect(res).toEqual({
      ok: false,
      error: "Failed to create session: permission denied",
    })
  })
})
