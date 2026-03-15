import { describe, expect, it } from "bun:test"
import { expandEnvVars, expandEnvVarsInObject } from "./env-expander"

describe("expandEnvVars", () => {
  it("uses environment values before defaults", () => {
    process.env["MCP_TOKEN"] = "live-token"

    expect(expandEnvVars("Bearer ${MCP_TOKEN:-fallback}")).toBe("Bearer live-token")
  })

  it("uses defaults and empty strings when variables are missing", () => {
    delete process.env["MCP_TOKEN"]
    delete process.env["MCP_URL"]

    expect(expandEnvVars("${MCP_TOKEN:-fallback}:${MCP_URL}")).toBe("fallback:")
  })
})

describe("expandEnvVarsInObject", () => {
  it("expands nested objects and arrays recursively", () => {
    process.env["MCP_HOST"] = "localhost"
    delete process.env["MCP_PORT"]

    expect(
      expandEnvVarsInObject({
        url: "http://${MCP_HOST}:${MCP_PORT:-8080}",
        env: {
          token: "${MCP_TOKEN:-none}",
        },
        args: ["--url", "http://${MCP_HOST}:${MCP_PORT:-8080}"],
      }),
    ).toEqual({
      url: "http://localhost:8080",
      env: {
        token: "none",
      },
      args: ["--url", "http://localhost:8080"],
    })
  })
})
