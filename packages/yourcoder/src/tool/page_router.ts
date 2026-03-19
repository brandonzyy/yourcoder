import z from "zod"
import { Tool } from "./tool"
import { abortAfterAny } from "../util/abort"
import { shouldUsePdfRead } from "./pdf_router"

type ReadStrategy = "static" | "browser" | "pdf" | "github" | "docs" | "skip"

interface RouteDecision {
  strategy: ReadStrategy
  reason: string
  confidence: number
}

const JS_HEAVY_INDICATORS = [
  "react", "vue", "angular", "next.js", "nuxt",
  "__next_data__", "window.__initial_state__",
  "data-reactroot", "ng-app", "v-app",
]

const LOGIN_INDICATORS = [
  "login", "signin", "sign-in", "auth", "password",
  "username", "email", "captcha", "challenge",
]

const ERROR_INDICATORS = [
  "404", "403", "500", "not found", "access denied",
  "error", "unavailable", "maintenance",
]

export const PageRouterTool = Tool.define("page_router", {
  description: "Page routing - decides read strategy for URL (static/browser/pdf/github/docs/skip) with login/error/JS-heavy detection.",
  parameters: z.object({
    url: z.string().describe("URL to route"),
    head_only: z.boolean().optional().describe("If true, route using URL + HEAD only (skip body inspection)."),
    max_bytes: z.number().optional().describe("Max bytes to inspect when fetching body (default 500000)."),
    snippet: z.string().optional().describe("Optional search snippet/title context for PDF routing hints."),
  }),
  async execute(params, ctx) {
    if (!/^https?:\/\//.test(params.url)) {
      throw new Error("URL must start with http:// or https://")
    }

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: { url: params.url, head_only: params.head_only, max_bytes: params.max_bytes },
    })

    const routed = await routePage(params.url, ctx.abort, {
      headOnly: params.head_only ?? false,
      maxBytes: Math.max(1024, Math.min(params.max_bytes ?? 500_000, 5_000_000)),
    })
    const decision = routed.decision

    const pdfRoute = shouldUsePdfRead({
      url: params.url,
      contentType: routed.contentType,
      snippet: params.snippet,
    })
    const readerUsed = pdfRoute.usePdfRead ? "pdf_read" : decision.strategy === "browser" ? "browser_read" : "webread"

    return {
      title: `Route: ${decision.strategy} (${params.url.slice(0, 50)})`,
      output: [
        "# Page Route Decision",
        `- URL: ${params.url}`,
        `- Strategy: ${decision.strategy}`,
        `- Reason: ${decision.reason}`,
        `- Confidence: ${decision.confidence}%`,
        `- ReaderUsed: ${readerUsed}`,
        `- PdfRoutingReason: ${pdfRoute.reason}`,
      ].join("\n"),
      metadata: { decision, readerUsed, pdfRoutingReason: pdfRoute.reason, sourceUrl: params.url },
    }
  },
})

async function routePage(
  url: string,
  abort: AbortSignal,
  options: { headOnly: boolean; maxBytes: number },
): Promise<{ decision: RouteDecision; contentType?: string }> {
  const byUrl = routeByUrl(url)
  if (byUrl) return { decision: byUrl }

  const byHead = await routeByHead(url, abort)
  if (byHead.decision) return { decision: byHead.decision, contentType: byHead.contentType }

  if (options.headOnly) {
    return {
      decision: { strategy: "static", reason: "head_only enabled and no special route matched", confidence: 70 },
      contentType: byHead.contentType,
    }
  }

  return { decision: await routeByContent(url, abort, options.maxBytes), contentType: byHead.contentType }
}

function routeByUrl(url: string): RouteDecision | null {
  const lower = url.toLowerCase()
  if (lower.endsWith(".pdf")) return { strategy: "pdf", reason: "URL ends with .pdf", confidence: 100 }
  if (lower.includes("github.com")) return { strategy: "github", reason: "GitHub domain detected", confidence: 95 }
  if (lower.includes("docs.") || lower.includes("/docs/") || lower.includes("/api/") || lower.includes("documentation")) {
    return { strategy: "docs", reason: "Documentation-like URL pattern", confidence: 90 }
  }
  return null
}

async function routeByHead(
  url: string,
  abort: AbortSignal,
): Promise<{ decision: RouteDecision | null; contentType?: string }> {
  try {
    const { signal, clearTimeout } = abortAfterAny(5000, abort)
    const response = await fetch(url, {
      method: "HEAD",
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    })
    clearTimeout()

    const contentType = (response.headers.get("content-type") || "").toLowerCase() || undefined
    if (contentType?.includes("application/pdf")) {
      return {
        decision: { strategy: "pdf", reason: "Content-Type is PDF", confidence: 100 },
        contentType,
      }
    }
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return {
        decision: { strategy: "skip", reason: `Unsupported content-type: ${contentType}`, confidence: 100 },
        contentType,
      }
    }
    return { decision: null, contentType }
  } catch {
    return { decision: null }
  }
}

async function routeByContent(url: string, abort: AbortSignal, maxBytes: number): Promise<RouteDecision> {
  try {
    const { signal, clearTimeout } = abortAfterAny(10000, abort)
    const response = await fetch(url, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })
    clearTimeout()

    if (!response.ok) return { strategy: "skip", reason: `HTTP ${response.status}`, confidence: 100 }

    const html = (await response.text()).slice(0, maxBytes)
    const lower = html.toLowerCase()

    if (isLoginPage(lower, url)) return { strategy: "skip", reason: "Login/auth wall detected", confidence: 95 }
    if (isErrorPage(lower, response.status)) return { strategy: "skip", reason: "Error/challenge page detected", confidence: 90 }
    if (isJsHeavyPage(lower, html)) return { strategy: "browser", reason: "JS-heavy SPA indicators detected", confidence: 85 }
    if (isFaqPage(lower, url)) return { strategy: "docs", reason: "FAQ/help pattern detected", confidence: 80 }

    return { strategy: "static", reason: "Static-readable HTML", confidence: 75 }
  } catch (error) {
    return {
      strategy: "skip",
      reason: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      confidence: 100,
    }
  }
}

function isLoginPage(html: string, url: string): boolean {
  const lowerUrl = url.toLowerCase()
  if (LOGIN_INDICATORS.some((t) => lowerUrl.includes(t))) return true
  if (html.includes("<form") && (html.includes("type=\"password\"") || html.includes("type='password'"))) return true
  let score = 0
  for (const token of LOGIN_INDICATORS) if (html.includes(token)) score++
  return score >= 3
}

function isErrorPage(html: string, status: number): boolean {
  if (status >= 400) return true
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.toLowerCase() || ""
  if (title && ERROR_INDICATORS.some((t) => title.includes(t))) return true
  let score = 0
  for (const token of ERROR_INDICATORS) if (html.includes(token)) score++
  return score >= 3
}

function isJsHeavyPage(lowerHtml: string, html: string): boolean {
  let score = 0
  for (const marker of JS_HEAVY_INDICATORS) if (lowerHtml.includes(marker)) score += 2
  const scripts = (html.match(/<script/gi) || []).length
  if (scripts > 10) score += 3
  else if (scripts > 5) score += 2
  const textOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .trim()
  if (textOnly.length < 500 && scripts > 5) score += 4
  if (lowerHtml.includes('id="root"') || lowerHtml.includes('id="app"') || lowerHtml.includes('id="__next"')) score += 3
  return score >= 6
}

function isFaqPage(html: string, url: string): boolean {
  const lowerUrl = url.toLowerCase()
  if (["faq", "help", "support", "questions"].some((k) => lowerUrl.includes(k))) return true
  const patterns = ["frequently asked", "common questions", "how can i", "what is", "how do i"]
  let score = 0
  for (const p of patterns) if (html.includes(p)) score++
  return score >= 2
}
