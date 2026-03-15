import { describe, expect, it, mock } from "bun:test"
import { createSyncSession } from "./sync-session-creator"

describe("createSyncSession", () => {
  it("creates a child session in the parent directory when available", async () => {
    const client = {
      session: {
        get: mock(async () => ({ data: { directory: "/tmp/parent" } })),
        create: mock(async () => ({ data: { id: "ses_child" } })),
      },
    } as never

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
        get: mock(async () => null),
        create: mock(async () => ({ error: "permission denied" })),
      },
    } as never

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
