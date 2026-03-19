import z from "zod"
import { Tool } from "./tool"
import { abortAfterAny } from "../util/abort"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024
const DEFAULT_TIMEOUT = 30 * 1000

export const WebReadTool = Tool.define("webread", {
  description: "Structured page parsing - extracts clean content, accessibility tree, or metadata from URLs. Code-enforced extraction without LLM interpretation.",
  parameters: z.object({
    url: z.string().describe("URL to parse"),
    view: z.enum(["content", "atree", "metadata"]).describe("View type: 'content' (clean text), 'atree' (interactive elements), 'metadata' (meta tags)"),
  }),
  async execute(params, ctx) {
    if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
      throw new Error("URL must start with http:// or https://")
    }

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: { url: params.url, view: params.view },
    })

    const { signal, clearTimeout } = abortAfterAny(DEFAULT_TIMEOUT, ctx.abort)

    const response = await fetch(params.url, {
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })

    clearTimeout()

    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) throw new Error("Response too large")

    const html = new TextDecoder().decode(arrayBuffer)

    let output = ""
    switch (params.view) {
      case "content":
        output = extractContent(html)
        break
      case "atree":
        output = extractAccessibilityTree(html)
        break
      case "metadata":
        output = JSON.stringify(extractMetadata(html), null, 2)
        break
    }

    return {
      title: `webread: ${params.url} (${params.view})`,
      output,
      metadata: { view: params.view },
    }
  },
})

function extractContent(html: string): string {
  let content = ""
  let inBody = false
  let skipTag = ""

  const rewriter = new HTMLRewriter()
    .on("body", {
      element() { inBody = true },
    })
    .on("script, style, nav, header, footer, aside, iframe, noscript", {
      element(el) { skipTag = el.tagName },
    })
    .on("main, article, section, div, p, h1, h2, h3, h4, h5, h6, li, td, th", {
      text(t) {
        if (inBody && !skipTag) content += t.text + " "
      },
    })
    .on("*", {
      element(el) {
        if (!["script", "style", "nav", "header", "footer", "aside", "iframe", "noscript"].includes(el.tagName)) {
          skipTag = ""
        }
      },
    })
    .transform(new Response(html))

  rewriter.text().catch(() => {})
  return content.replace(/\s+/g, " ").trim()
}

function extractAccessibilityTree(html: string): string {
  const tree: string[] = []
  let depth = 0

  const rewriter = new HTMLRewriter()
    .on("a, button, input, select, textarea, [role]", {
      element(el) {
        const tag = el.tagName
        const role = el.getAttribute("role") || ""
        const label = el.getAttribute("aria-label") || el.getAttribute("title") || ""
        const href = el.getAttribute("href") || ""
        
        const indent = "  ".repeat(depth)
        tree.push(`${indent}<${tag}${role ? ` role="${role}"` : ""}${label ? ` label="${label}"` : ""}${href ? ` href="${href}"` : ""}>`)
        depth++
      },
    })
    .transform(new Response(html))

  rewriter.text().catch(() => {})
  return tree.join("\n")
}

function extractMetadata(html: string): Record<string, string> {
  const meta: Record<string, string> = {}
  
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleMatch) meta.title = titleMatch[1].trim()

  const metaRegex = /<meta\s+([^>]+)>/gi
  let match
  while ((match = metaRegex.exec(html)) !== null) {
    const attrs = match[1]
    const nameMatch = attrs.match(/(?:name|property)=["']([^"']+)["']/i)
    const contentMatch = attrs.match(/content=["']([^"']+)["']/i)
    
    if (nameMatch && contentMatch) {
      const key = nameMatch[1].toLowerCase()
      if (key.includes("date") || key.includes("author") || key.includes("description")) {
        meta[key] = contentMatch[1]
      }
    }
  }

  return meta
}
