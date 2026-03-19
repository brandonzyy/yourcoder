import z from "zod"
import { Tool } from "./tool"

interface SearchResult {
  title: string
  url: string
  snippet?: string
  publishedDate?: string
}

interface RankedResult extends SearchResult {
  score: number
  breakdown: string
}

const OFFICIAL_DOMAINS = new Set([
  "github.com", "docs.", "developer.", "dev.", "api.",
  "stackoverflow.com", "mdn.mozilla.org", "w3.org",
])

const HIGH_AUTHORITY = new Set([
  "stackoverflow.com", "github.com", "medium.com",
  "dev.to", "hackernoon.com", "freecodecamp.org",
])

export const WebSearchRankTool = Tool.define("websearch_rank", {
  description: "Rule-based search result ranking - scores and sorts results by official domain, recency, relevance, code examples, and authority. Pure code logic, no LLM scoring.",
  parameters: z.object({
    results: z.array(z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string().optional(),
      publishedDate: z.string().optional(),
    })).describe("Search results to rank"),
    query: z.string().describe("Original search query for relevance matching"),
  }),
  async execute(params, ctx) {
    const ranked = params.results.map(r => rankResult(r, params.query))
    ranked.sort((a, b) => b.score - a.score)

    const output = [
      `# Ranked Results (${ranked.length} total)\n`,
      "| Rank | Score | Title | URL | Breakdown |",
      "|------|-------|-------|-----|-----------|",
      ...ranked.map((r, i) => 
        `| ${i + 1} | ${r.score} | ${r.title.slice(0, 40)} | ${r.url.slice(0, 50)} | ${r.breakdown} |`
      ),
      "",
      `Top 3 URLs:\n${ranked.slice(0, 3).map(r => `- ${r.url}`).join("\n")}`,
    ].join("\n")

    return {
      title: `Ranked ${ranked.length} results`,
      output,
      metadata: { topUrls: ranked.slice(0, 3).map(r => r.url) },
    }
  },
})

function rankResult(result: SearchResult, query: string): RankedResult {
  let score = 0
  const breakdown: string[] = []

  // Official domain: +40
  if (OFFICIAL_DOMAINS.has(new URL(result.url).hostname) || 
      Array.from(OFFICIAL_DOMAINS).some(d => result.url.includes(d))) {
    score += 40
    breakdown.push("official:+40")
  }

  // Recent (within 1 year): +20
  if (result.publishedDate) {
    const date = new Date(result.publishedDate)
    const age = Date.now() - date.getTime()
    if (age < 365 * 24 * 60 * 60 * 1000) {
      score += 20
      breakdown.push("recent:+20")
    }
  }

  // Title matches query: +20
  const queryLower = query.toLowerCase()
  if (result.title.toLowerCase().includes(queryLower)) {
    score += 20
    breakdown.push("title-match:+20")
  }

  // Has code examples: +10
  if (result.snippet?.includes("```") || result.snippet?.includes("code") || 
      result.url.includes("github.com")) {
    score += 10
    breakdown.push("code:+10")
  }

  // High authority: +10
  if (HIGH_AUTHORITY.has(new URL(result.url).hostname)) {
    score += 10
    breakdown.push("authority:+10")
  }

  return {
    ...result,
    score,
    breakdown: breakdown.join(", ") || "base:0",
  }
}
