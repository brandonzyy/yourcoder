import z from "zod"
import { Tool } from "./tool"

type Officiality = "official" | "unofficial"
type SourceOrigin = "primary" | "secondary"
type ContentType = "docs" | "blog" | "news" | "issue" | "forum" | "reference" | "unknown"
type DiscussionMode = "static" | "dynamic"
type TrustLevel = "high" | "medium" | "low"

interface SourceInput {
  url: string
  title?: string
  snippet?: string
  publishedDate?: string
}

interface SourceClassification {
  url: string
  domain: string
  officiality: Officiality
  origin: SourceOrigin
  contentType: ContentType
  discussionMode: DiscussionMode
  trust: TrustLevel
  score: number
  reasons: string[]
}

const OFFICIAL_HINTS = ["docs.", "developer.", "api.", "github.com", "gitlab.com", "w3.org", "mozilla.org"]
const NEWS_HINTS = ["news", "press", "announcement", "breaking"]
const FORUM_HINTS = ["forum", "community", "discussion", "reddit.com", "discourse", "stackoverflow.com"]
const BLOG_HINTS = ["blog", "medium.com", "dev.to", "hashnode", "substack"]
const ISSUE_HINTS = ["/issues", "/pull/", "/discussions", "issue", "bug"]

export const SourceClassifierTool = Tool.define("source_classifier", {
  description:
    "Classify sources for verification pipeline: official/unofficial, primary/secondary, content type, static/dynamic discussion mode, and trust level.",
  parameters: z.object({
    sources: z
      .array(
        z.object({
          url: z.string(),
          title: z.string().optional(),
          snippet: z.string().optional(),
          publishedDate: z.string().optional(),
        }),
      )
      .describe("Sources to classify"),
  }),
  async execute(params) {
    const classified = params.sources.map((s) => classifySource(s))

    const output = [
      `# Source Classifier (${classified.length})`,
      "",
      "| Domain | Official | Origin | Type | Mode | Trust | Score |",
      "|---|---|---|---|---|---|---:|",
      ...classified.map(
        (c) =>
          `| ${c.domain} | ${c.officiality} | ${c.origin} | ${c.contentType} | ${c.discussionMode} | ${c.trust} | ${c.score} |`,
      ),
    ].join("\n")

    return {
      title: `Classified ${classified.length} sources`,
      output,
      metadata: {
        classified,
        summary: {
          highTrust: classified.filter((c) => c.trust === "high").length,
          mediumTrust: classified.filter((c) => c.trust === "medium").length,
          lowTrust: classified.filter((c) => c.trust === "low").length,
          official: classified.filter((c) => c.officiality === "official").length,
          primary: classified.filter((c) => c.origin === "primary").length,
        },
      },
    }
  },
})

function classifySource(input: SourceInput): SourceClassification {
  const url = input.url
  const domain = safeDomain(url)
  const content = `${input.title ?? ""} ${input.snippet ?? ""}`.toLowerCase()
  const lowerUrl = url.toLowerCase()

  const reasons: string[] = []
  let score = 35

  const officiality: Officiality = isOfficial(domain, lowerUrl) ? "official" : "unofficial"
  if (officiality === "official") {
    score += 25
    reasons.push("official-domain")
  }

  const contentType = detectContentType(domain, lowerUrl, content)
  score += contentTypeBonus(contentType)
  reasons.push(`type:${contentType}`)

  const discussionMode: DiscussionMode = isDynamic(contentType, lowerUrl, content) ? "dynamic" : "static"
  if (discussionMode === "static") {
    score += 8
    reasons.push("static-content")
  } else {
    score -= 4
    reasons.push("dynamic-discussion")
  }

  const origin: SourceOrigin = detectOrigin(contentType, officiality, lowerUrl, content)
  if (origin === "primary") {
    score += 15
    reasons.push("primary-source")
  } else {
    score -= 3
    reasons.push("secondary-source")
  }

  if (input.publishedDate) {
    const ageDays = daysSince(input.publishedDate)
    if (ageDays !== null) {
      if (ageDays <= 365) {
        score += 10
        reasons.push("recent")
      } else if (ageDays > 3 * 365) {
        score -= 10
        reasons.push("stale")
      }
    }
  }

  if (domain.includes("github.com") && ISSUE_HINTS.some((h) => lowerUrl.includes(h))) {
    score -= 4
    reasons.push("issue-thread")
  }

  const trust = toTrust(score)

  return {
    url,
    domain,
    officiality,
    origin,
    contentType,
    discussionMode,
    trust,
    score: Math.max(0, Math.min(score, 100)),
    reasons,
  }
}

function isOfficial(domain: string, url: string): boolean {
  return OFFICIAL_HINTS.some((h) => domain.includes(h) || url.includes(h))
}

function detectContentType(domain: string, url: string, content: string): ContentType {
  if (url.includes("/docs/") || url.includes("/api/") || domain.includes("docs.") || content.includes("documentation")) return "docs"
  if (ISSUE_HINTS.some((h) => url.includes(h))) return "issue"
  if (FORUM_HINTS.some((h) => domain.includes(h) || url.includes(h) || content.includes(h))) return "forum"
  if (BLOG_HINTS.some((h) => domain.includes(h) || url.includes(h) || content.includes(h))) return "blog"
  if (NEWS_HINTS.some((h) => domain.includes(h) || url.includes(h) || content.includes(h))) return "news"
  if (domain.includes("wikipedia.org") || domain.includes("mdn.mozilla.org") || domain.includes("w3.org")) return "reference"
  return "unknown"
}

function contentTypeBonus(type: ContentType): number {
  return { docs: 20, reference: 16, news: 8, blog: 6, issue: 4, forum: 2, unknown: 0 }[type]
}

function isDynamic(type: ContentType, url: string, content: string): boolean {
  if (type === "issue" || type === "forum") return true
  return /\b(comment|reply|thread|discussion|votes?)\b/i.test(`${url} ${content}`)
}

function detectOrigin(type: ContentType, officiality: Officiality, url: string, content: string): SourceOrigin {
  if (officiality === "official" && (type === "docs" || type === "news")) return "primary"
  if (type === "reference") return "primary"
  if (type === "issue" && url.includes("github.com") && /maintainer|official/i.test(content)) return "primary"
  return "secondary"
}

function toTrust(score: number): TrustLevel {
  if (score >= 70) return "high"
  if (score >= 50) return "medium"
  return "low"
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return "unknown"
  }
}

function daysSince(dateStr: string): number | null {
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000))
}
