import z from "zod"
import { Tool } from "./tool"

interface RawResult {
  title?: string
  url?: string
  snippet?: string
  publishedDate?: string
  [key: string]: any
}

interface NormalizedResult {
  title: string
  url: string
  canonicalUrl: string
  domain: string
  snippet: string
  publishedDate?: string
  sourceType: "docs" | "blog" | "forum" | "code" | "news" | "unknown"
  quality: number
}

const SPAM_PATTERNS = [
  /click here/i,
  /buy now/i,
  /download free/i,
  /\d{3,}% off/i,
  /limited time/i,
]

const SPAM_DOMAINS = new Set([
  "spam.com",
  "ads.com",
  "clickbait.com",
])

export const ResultNormalizerTool = Tool.define("result_normalizer", {
  description: "Result normalization - cleans and standardizes search results. Unifies fields, canonicalizes URLs, extracts domains, identifies source types, filters spam. Pure code logic.",
  parameters: z.object({
    results: z.array(z.any()).describe("Raw search results to normalize"),
  }),
  async execute(params) {
    const normalized: NormalizedResult[] = []
    const filtered: string[] = []

    for (const raw of params.results) {
      const result = normalizeResult(raw)
      
      if (!result) {
        filtered.push(`Filtered: ${raw.url || "no URL"} (invalid)`)
        continue
      }
      
      if (isSpam(result)) {
        filtered.push(`Filtered: ${result.url} (spam)`)
        continue
      }
      
      normalized.push(result)
    }

    const output = [
      `# Normalized Results (${normalized.length}/${params.results.length})\n`,
      "| Title | Domain | Type | Quality |",
      "|-------|--------|------|---------|",
      ...normalized.map(r => 
        `| ${r.title.slice(0, 40)} | ${r.domain} | ${r.sourceType} | ${r.quality} |`
      ),
      "",
      filtered.length > 0 ? `## Filtered (${filtered.length})\n${filtered.join("\n")}` : "",
    ].filter(Boolean).join("\n")

    return {
      title: `Normalized ${normalized.length} results`,
      output,
      metadata: { normalized, filtered: filtered.length },
    }
  },
})

function normalizeResult(raw: RawResult): NormalizedResult | null {
  // Extract URL
  const url = extractUrl(raw)
  if (!url) return null
  
  // Canonicalize URL
  const canonicalUrl = canonicalizeUrl(url)
  
  // Extract domain
  const domain = extractDomain(canonicalUrl)
  if (!domain) return null
  
  // Clean title
  const title = cleanTitle(raw.title || raw.name || "Untitled")
  
  // Clean snippet
  const snippet = cleanSnippet(raw.snippet || raw.description || raw.text || "")
  
  // Extract date
  const publishedDate = extractDate(raw)
  
  // Identify source type
  const sourceType = identifySourceType(domain, url, title, snippet)
  
  // Calculate quality score
  const quality = calculateQuality({ title, url: canonicalUrl, domain, snippet, sourceType })
  
  return {
    title,
    url,
    canonicalUrl,
    domain,
    snippet,
    publishedDate,
    sourceType,
    quality,
  }
}

function extractUrl(raw: RawResult): string | null {
  const url = raw.url || raw.link || raw.href
  if (!url || typeof url !== "string") return null
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null
  return url
}

function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    
    // Remove tracking params
    const trackingParams = ["utm_source", "utm_medium", "utm_campaign", "fbclid", "gclid"]
    trackingParams.forEach(p => parsed.searchParams.delete(p))
    
    // Remove trailing slash
    let path = parsed.pathname
    if (path.endsWith("/") && path.length > 1) {
      path = path.slice(0, -1)
    }
    
    // Remove fragment
    parsed.hash = ""
    
    // Lowercase domain
    parsed.hostname = parsed.hostname.toLowerCase()
    
    return `${parsed.protocol}//${parsed.hostname}${path}${parsed.search}`
  } catch {
    return url
  }
}

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s+/g, " ")
    .replace(/[|•·]/g, "-")
    .trim()
    .slice(0, 200)
}

function cleanSnippet(snippet: string): string {
  return snippet
    .replace(/\s+/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim()
    .slice(0, 500)
}

function extractDate(raw: RawResult): string | undefined {
  const date = raw.publishedDate || raw.published || raw.date || raw.created_at
  if (!date) return undefined
  
  try {
    const parsed = new Date(date)
    if (isNaN(parsed.getTime())) return undefined
    return parsed.toISOString().split("T")[0]
  } catch {
    return undefined
  }
}

function identifySourceType(domain: string, url: string, title: string, snippet: string): NormalizedResult["sourceType"] {
  const lower = domain.toLowerCase()
  const urlLower = url.toLowerCase()
  const contentLower = (title + " " + snippet).toLowerCase()
  
  // Docs
  if (lower.includes("docs.") || lower.includes("documentation") || 
      urlLower.includes("/docs/") || urlLower.includes("/api/")) {
    return "docs"
  }
  
  // Code
  if (lower.includes("github.com") || lower.includes("gitlab.com") || 
      lower.includes("stackoverflow.com") || urlLower.includes("/code/")) {
    return "code"
  }
  
  // Forum
  if (lower.includes("reddit.com") || lower.includes("discourse.") || 
      lower.includes("forum") || contentLower.includes("discussion")) {
    return "forum"
  }
  
  // Blog
  if (lower.includes("medium.com") || lower.includes("dev.to") || 
      lower.includes("blog") || urlLower.includes("/blog/")) {
    return "blog"
  }
  
  // News
  if (lower.includes("news") || contentLower.includes("breaking") || 
      contentLower.includes("announced")) {
    return "news"
  }
  
  return "unknown"
}

function calculateQuality(result: Pick<NormalizedResult, "title" | "url" | "domain" | "snippet" | "sourceType">): number {
  let score = 50 // base
  
  // Title quality
  if (result.title.length > 10 && result.title.length < 100) score += 10
  if (!/untitled/i.test(result.title)) score += 5
  
  // Snippet quality
  if (result.snippet.length > 50) score += 10
  if (result.snippet.length > 200) score += 5
  
  // URL quality
  if (result.url.length < 200) score += 5
  if (!result.url.includes("?")) score += 5
  
  // Source type bonus
  const typeBonus: Record<string, number> = {
    docs: 20,
    code: 15,
    blog: 10,
    forum: 5,
    news: 5,
    unknown: 0,
  }
  score += typeBonus[result.sourceType]
  
  // Domain reputation
  if (result.domain.includes("github.com")) score += 10
  if (result.domain.includes("stackoverflow.com")) score += 10
  if (result.domain.startsWith("docs.")) score += 15
  
  return Math.min(score, 100)
}

function isSpam(result: NormalizedResult): boolean {
  const content = (result.title + " " + result.snippet).toLowerCase()
  
  // Check spam patterns
  if (SPAM_PATTERNS.some(p => p.test(content))) return true
  
  // Check spam domains
  if (SPAM_DOMAINS.has(result.domain)) return true
  
  // Check suspicious URLs
  if (result.url.split("/").length > 10) return true
  if (result.url.length > 300) return true
  
  // Check low quality
  if (result.quality < 30) return true
  
  // Check empty content
  if (result.title.length < 5 || result.snippet.length < 10) return true
  
  return false
}
