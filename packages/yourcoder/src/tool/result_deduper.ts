import z from "zod"
import { Tool } from "./tool"

interface NormalizedResult {
  title: string
  url: string
  canonicalUrl: string
  domain: string
  snippet: string
  publishedDate?: string
  sourceType: string
  quality: number
}

interface DedupedResult extends NormalizedResult {
  duplicateCount: number
  duplicateUrls: string[]
}

export const ResultDeduperTool = Tool.define("result_deduper", {
  description: "Result deduplication - removes duplicate and similar results. Handles URL dedup, canonical dedup, title dedup, snippet similarity, same-domain downranking. Pure code logic.",
  parameters: z.object({
    results: z.array(z.any()).describe("Normalized results to deduplicate"),
  }),
  async execute(params) {
    const deduped = deduplicateResults(params.results)
    const removed = params.results.length - deduped.length

    const output = [
      `# Deduplicated Results (${deduped.length}/${params.results.length})\n`,
      "| Title | Domain | Duplicates | Quality |",
      "|-------|--------|------------|---------|",
      ...deduped.map(r => 
        `| ${r.title.slice(0, 40)} | ${r.domain} | ${r.duplicateCount} | ${r.quality} |`
      ),
      "",
      removed > 0 ? `## Removed ${removed} duplicates` : "",
    ].filter(Boolean).join("\n")

    return {
      title: `Deduped to ${deduped.length} results`,
      output,
      metadata: { deduped, removed },
    }
  },
})

function deduplicateResults(results: NormalizedResult[]): DedupedResult[] {
  const seen = {
    canonicalUrls: new Map<string, DedupedResult>(),
    titles: new Map<string, DedupedResult>(),
    snippets: new Map<string, DedupedResult>(),
  }
  
  const deduped: DedupedResult[] = []
  
  for (const result of results) {
    // Check canonical URL dedup
    const existing = seen.canonicalUrls.get(result.canonicalUrl)
    if (existing) {
      existing.duplicateCount++
      existing.duplicateUrls.push(result.url)
      continue
    }
    
    // Check title dedup
    const titleKey = normalizeTitle(result.title)
    const existingTitle = seen.titles.get(titleKey)
    if (existingTitle) {
      existingTitle.duplicateCount++
      existingTitle.duplicateUrls.push(result.url)
      continue
    }
    
    // Check snippet similarity
    const snippetKey = normalizeSnippet(result.snippet)
    const existingSnippet = seen.snippets.get(snippetKey)
    if (existingSnippet && isSimilarSnippet(result.snippet, existingSnippet.snippet)) {
      existingSnippet.duplicateCount++
      existingSnippet.duplicateUrls.push(result.url)
      continue
    }
    
    // Add as new result
    const dedupedResult: DedupedResult = {
      ...result,
      duplicateCount: 0,
      duplicateUrls: [],
    }
    
    deduped.push(dedupedResult)
    seen.canonicalUrls.set(result.canonicalUrl, dedupedResult)
    seen.titles.set(titleKey, dedupedResult)
    seen.snippets.set(snippetKey, dedupedResult)
  }
  
  // Apply same-domain downranking
  return applyDomainDownranking(deduped)
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeSnippet(snippet: string): string {
  return snippet
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) // First 100 chars for key
}

function isSimilarSnippet(a: string, b: string): boolean {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 3))
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 3))
  
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)))
  const union = new Set([...wordsA, ...wordsB])
  
  const similarity = intersection.size / union.size
  return similarity > 0.7 // 70% similarity threshold
}

function applyDomainDownranking(results: DedupedResult[]): DedupedResult[] {
  const domainCounts = new Map<string, number>()
  
  // Count per domain
  for (const result of results) {
    domainCounts.set(result.domain, (domainCounts.get(result.domain) || 0) + 1)
  }
  
  // Downrank if domain appears > 2 times
  return results.map(result => {
    const count = domainCounts.get(result.domain) || 0
    if (count > 2) {
      return {
        ...result,
        quality: Math.max(result.quality - (count - 2) * 5, 0),
      }
    }
    return result
  })
}
