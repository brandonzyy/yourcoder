import { describe, it, expect, beforeEach } from "bun:test"
import { createSubagentHealthCheckHook } from "./hook"

describe("subagent-health-check hook", () => {
  let mockCtx: any

  beforeEach(() => {
    mockCtx = {
      directory: "/test/project",
    }
  })

  it("should create hook when enabled", () => {
    const hook = createSubagentHealthCheckHook(mockCtx, { enabled: true })
    expect(hook).not.toBeNull()
    expect(hook).toHaveProperty("session.created")
  })

  it("should return null when disabled", () => {
    const hook = createSubagentHealthCheckHook(mockCtx, { enabled: false })
    expect(hook).toBeNull()
  })

  it("should inject system reminder on session.created", async () => {
    const hook = createSubagentHealthCheckHook(mockCtx, { enabled: true, timeout: 5000 })
    expect(hook).not.toBeNull()

    const result = await hook!["session.created"]({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: "test-session-123",
            parentID: undefined,
          },
        },
      },
    })

    expect(result).toBeDefined()
    expect(result).toHaveProperty("systemReminder")
    expect(result.systemReminder).toContain("[STARTUP HEALTH CHECK]")
    expect(result.systemReminder).toContain("manon-explorer")
    expect(result.systemReminder).toContain("librarian")
    expect(result.systemReminder).toContain("sisyphus-junior")
    expect(result.systemReminder).toContain("5000ms")
  })

  it("should not inject for subagent sessions (with parentID)", async () => {
    const hook = createSubagentHealthCheckHook(mockCtx, { enabled: true })
    expect(hook).not.toBeNull()

    const result = await hook!["session.created"]({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: "subagent-session-456",
            parentID: "main-session-123",
          },
        },
      },
    })

    expect(result).toBeUndefined()
  })

  it("should only check each session once", async () => {
    const hook = createSubagentHealthCheckHook(mockCtx, { enabled: true })
    expect(hook).not.toBeNull()

    const sessionID = "test-session-789"

    // First call should return reminder
    const result1 = await hook!["session.created"]({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: sessionID,
            parentID: undefined,
          },
        },
      },
    })
    expect(result1).toBeDefined()
    expect(result1).toHaveProperty("systemReminder")

    // Second call should return undefined (already checked)
    const result2 = await hook!["session.created"]({
      event: {
        type: "session.created",
        properties: {
          info: {
            id: sessionID,
            parentID: undefined,
          },
        },
      },
    })
    expect(result2).toBeUndefined()
  })
})
