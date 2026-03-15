import { describe, expect, it } from "bun:test"
import { transformMcpServer } from "./transformer"

describe("transformMcpServer", () => {
  it("builds a local config and expands command env vars", () => {
    process.env["MCP_BIN"] = "uvx"
    process.env["MCP_KEY"] = "secret"

    expect(
      transformMcpServer("sqlite", {
        command: "${MCP_BIN}",
        args: ["mcp-server-sqlite"],
        env: {
          API_KEY: "${MCP_KEY}",
        },
      }),
    ).toEqual({
      type: "local",
      command: ["uvx", "mcp-server-sqlite"],
      enabled: true,
      environment: {
        API_KEY: "secret",
      },
    })
  })

  it("builds a remote config with expanded headers", () => {
    process.env["MCP_URL"] = "https://mcp.example.com"
    process.env["MCP_TOKEN"] = "bearer-token"

    expect(
      transformMcpServer("remote", {
        type: "http",
        url: "${MCP_URL}",
        headers: {
          Authorization: "Bearer ${MCP_TOKEN}",
        },
      }),
    ).toEqual({
      type: "remote",
      url: "https://mcp.example.com",
      enabled: true,
      headers: {
        Authorization: "Bearer bearer-token",
      },
    })
  })

  it("throws when a remote server is missing a url", () => {
    expect(() =>
      transformMcpServer("broken-remote", {
        type: "sse",
      }),
    ).toThrow('MCP server "broken-remote" requires url for type "sse"')
  })

  it("throws when a stdio server is missing a command", () => {
    expect(() =>
      transformMcpServer("broken-local", {
        type: "stdio",
      }),
    ).toThrow('MCP server "broken-local" requires command for stdio type')
  })
})
