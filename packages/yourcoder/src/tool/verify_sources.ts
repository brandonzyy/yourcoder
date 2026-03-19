import z from "zod"
import { Tool } from "./tool"

interface Claim {
  source: string
  url: string
  text: string
  publishedDate?: string
}

interface VerificationResult {
  claim: string
  agree: number
  conflict: number
  official: boolean
  confidence: "HIGH" | "MEDIUM" | "LOW"
  sources: string[]
}

export const VerifySourcesTool = Tool.define("verify_sources", {
  description: "Multi-source verification - detects conflicts, marks outdated content, calculates confidence. Rule-based logic without LLM interpretation.",
  parameters: z.object({
    claims: z.array(z.object({
      source: z.string(),
      url: z.string(),
      text: z.string(),
      publishedDate: z.string().optional(),
    })).describe("Claims from different sources to verify"),
  }),
  async execute(params, ctx) {
    const grouped = groupClaims(params.claims)
    const verified = grouped.map(g => verifyClaim(g))

    const conflicts = verified.filter(v => v.conflict > 0)
    const outdated = params.claims.filter(c => isOutdated(c.publishedDate))

    const output = [
      "# Verification Results\n",
      "| Claim | Agree | Conflict | Official | Confidence |",
      "|-------|-------|----------|----------|------------|",
      ...verified.map(v => 
        `| ${v.claim.slice(0, 40)}... | ${v.agree} | ${v.conflict} | ${v.official ? "✅" : "❌"} | ${v.confidence} |`
      ),
      "",
      conflicts.length > 0 ? `## Conflicts (${conflicts.length})\n${conflicts.map(c => 
        `- ${c.claim}: ${c.sources.join(", ")}`
      ).join("\n")}` : "",
      "",
      outdated.length > 0 ? `## Outdated (${outdated.length})\n${outdated.map(c => 
        `- ${c.source} (${c.publishedDate}): ${c.text.slice(0, 60)}...`
      ).join("\n")}` : "",
      "",
      `## Summary`,
      `- Total claims: ${verified.length}`,
      `- High confidence: ${verified.filter(v => v.confidence === "HIGH").length}`,
      `- Conflicts detected: ${conflicts.length}`,
      `- Outdated sources: ${outdated.length}`,
    ].filter(Boolean).join("\n")

    return {
      title: `Verified ${params.claims.length} claims`,
      output,
      metadata: { 
        conflicts: conflicts.length,
        outdated: outdated.length,
        highConfidence: verified.filter(v => v.confidence === "HIGH").length,
      },
    }
  },
})

function groupClaims(claims: Claim[]): Claim[][] {
  const groups: Claim[][] = []
  
  for (const claim of claims) {
    const keywords = extractKeywords(claim.text)
    let found = false
    
    for (const group of groups) {
      const groupKeywords = extractKeywords(group[0].text)
      if (hasOverlap(keywords, groupKeywords)) {
        group.push(claim)
        found = true
        break
      }
    }
    
    if (!found) groups.push([claim])
  }
  
  return groups
}

function extractKeywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 3)
  )
}

function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  let overlap = 0
  for (const word of a) {
    if (b.has(word)) overlap++
  }
  return overlap >= 2
}

function verifyClaim(group: Claim[]): VerificationResult {
  const texts = group.map(c => c.text.toLowerCase())
  const agree = texts.length
  
  let conflict = 0
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (hasConflict(texts[i], texts[j])) conflict++
    }
  }
  
  const official = group.some(c => 
    c.url.includes("docs.") || 
    c.url.includes("developer.") ||
    c.url.includes("github.com")
  )
  
  let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW"
  if (agree >= 3 && conflict === 0 && official) confidence = "HIGH"
  else if (agree >= 2 && conflict === 0) confidence = "MEDIUM"
  
  return {
    claim: group[0].text.slice(0, 100),
    agree,
    conflict,
    official,
    confidence,
    sources: group.map(c => c.source),
  }
}

function hasConflict(a: string, b: string): boolean {
  const negations = ["not", "no", "never", "cannot", "don't", "doesn't"]
  const aHasNeg = negations.some(n => a.includes(n))
  const bHasNeg = negations.some(n => b.includes(n))
  return aHasNeg !== bHasNeg
}

function isOutdated(date?: string): boolean {
  if (!date) return false
  const age = Date.now() - new Date(date).getTime()
  return age > 12 * 30 * 24 * 60 * 60 * 1000 // 12 months
}
