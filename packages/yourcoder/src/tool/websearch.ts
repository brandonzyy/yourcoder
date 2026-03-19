import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./websearch.txt"
import { abortAfterAny } from "../util/abort"

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    SEARCH: "/mcp",
  },
  DEFAULT_NUM_RESULTS: 8,
} as const

interface McpSearchRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      numResults?: number
      livecrawl?: "fallback" | "preferred"
      type?: "auto" | "fast" | "deep"
      contextMaxCharacters?: number
    }
  }
}

interface McpSearchResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

type ParsedSearchResult = {
  title: string
  url: string
  snippet?: string
  publishedDate?: string
}

export const WebSearchTool = Tool.define("websearch", async () => {
  return {
    get description() {
      return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
    },
    parameters: z.object({
      query: z.string().describe("Websearch query"),
      numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
      livecrawl: z
        .enum(["fallback", "preferred"])
        .optional()
        .describe(
          "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
        ),
      type: z
        .enum(["auto", "fast", "deep"])
        .optional()
        .describe(
          "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
        ),
      contextMaxCharacters: z
        .number()
        .optional()
        .describe("Maximum characters for context string optimized for LLMs (default: 10000)"),
    }),
    async execute(params, ctx) {
      await ctx.ask({
        permission: "websearch",
        patterns: [params.query],
        always: ["*"],
        metadata: {
          query: params.query,
          numResults: params.numResults,
          livecrawl: params.livecrawl,
          type: params.type,
          contextMaxCharacters: params.contextMaxCharacters,
        },
      })

      const searchRequest: McpSearchRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: {
            query: params.query,
            type: params.type || "auto",
            numResults: params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
            livecrawl: params.livecrawl || "fallback",
            contextMaxCharacters: params.contextMaxCharacters,
          },
        },
      }

      const { signal, clearTimeout } = abortAfterAny(25000, ctx.abort)

      try {
        const headers: Record<string, string> = {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        }

        const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`, {
          method: "POST",
          headers,
          body: JSON.stringify(searchRequest),
          signal,
        })

        clearTimeout()

        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`Search error (${response.status}): ${errorText}`)
        }

        const responseText = await response.text()

        // Parse SSE response
        const lines = responseText.split("\n")
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data: McpSearchResponse = JSON.parse(line.substring(6))
            if (data.result && data.result.content && data.result.content.length > 0) {
              const text = data.result.content[0].text
              const parsedResults = parseSearchTextToResults(text)
              return {
                output: text,
                title: `Web search: ${params.query}`,
                metadata: {
                  query: params.query,
                  results: parsedResults,
                },
              }
            }
          }
        }

        return {
          output: "No search results found. Please try a different query.",
          title: `Web search: ${params.query}`,
          metadata: {
            query: params.query,
            results: [],
          },
        }
      } catch (error) {
        clearTimeout()

        if (error instanceof Error && error.name === "AbortError") {
          throw new Error("Search request timed out")
        }

        throw error
      }
    },
  }
})


function parseSearchTextToResults(text: string): ParsedSearchResult[] {
  const results: ParsedSearchResult[] = []
  const seenUrls = new Set<string>()

  const lines = text.split("\n")
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // a) Markdown link line: - [Title](https://...)
    const markdownMatch = line.match(/^[-*+]?\s*\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)\s*(?:[-–—:]\s*)?(.*)$/i)
    if (markdownMatch) {
      const [, rawTitle, url, rest] = markdownMatch
      const normalizedUrl = normalizeUrl(url)
      if (seenUrls.has(normalizedUrl)) continue
      seenUrls.add(normalizedUrl)
      const title = (rawTitle || "").trim() || normalizedUrl
      const snippet = cleanSnippet(rest)
      results.push({ title, url: normalizedUrl, ...(snippet ? { snippet } : {}) })
      continue
    }

    // b) Numbered line: 1. Title - https://...
    const numberedMatch = line.match(/^\d+[.)]\s*(.*?)\s*(?:[-–—:|]\s*)?(https?:\/\/\S+)\s*(.*)$/i)
    if (numberedMatch) {
      const [, preTitle, url, rest] = numberedMatch
      const normalizedUrl = normalizeUrl(url)
      if (seenUrls.has(normalizedUrl)) continue
      seenUrls.add(normalizedUrl)
      const title = (preTitle || "").trim() || normalizedUrl
      const snippet = cleanSnippet(rest)
      results.push({ title, url: normalizedUrl, ...(snippet ? { snippet } : {}) })
      continue
    }

    // c) Plain URL line: https://...
    const plainUrlMatch = line.match(/^(https?:\/\/\S+)\s*(.*)$/i)
    if (plainUrlMatch) {
      const [, url, rest] = plainUrlMatch
      const normalizedUrl = normalizeUrl(url)
      if (seenUrls.has(normalizedUrl)) continue
      seenUrls.add(normalizedUrl)
      const snippet = cleanSnippet(rest)
      results.push({ title: normalizedUrl, url: normalizedUrl, ...(snippet ? { snippet } : {}) })
      continue
    }

    // Best-effort fallback: any URL embedded in line
    const embeddedUrl = line.match(/https?:\/\/\S+/i)?.[0]
    if (embeddedUrl) {
      const normalizedUrl = normalizeUrl(embeddedUrl)
      if (seenUrls.has(normalizedUrl)) continue
      seenUrls.add(normalizedUrl)

      const withoutUrl = line.replace(embeddedUrl, "").replace(/^[-*+]?\s*\d*[.)]?\s*/, "").trim()
      const title = withoutUrl || normalizedUrl
      results.push({ title, url: normalizedUrl })
    }
  }

  return results
}

function normalizeUrl(url: string): string {
  return url.replace(/[),.;]+$/, "")
}

function cleanSnippet(text?: string): string | undefined {
  if (!text) return undefined
  const snippet = text.trim().replace(/^[-–—:|]\s*/, "")
  return snippet || undefined
}
