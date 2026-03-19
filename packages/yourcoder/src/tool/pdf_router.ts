/**
 * PDF routing — code-enforced, no LLM interpretation.
 * Called before any read step to decide whether to use pdf_read.
 */

export interface PdfRouteInput {
  url: string
  contentType?: string
  /** title or snippet from search result */
  snippet?: string
}

export interface PdfRouteResult {
  usePdfRead: boolean
  reason: "url_extension_pdf" | "content_type_pdf" | "snippet_pdf_signal" | "not_pdf"
}

const PDF_SNIPPET_SIGNALS = ["pdf", "download pdf", "whitepaper", "white paper", "rfc ", "rfc-", "technical report"]

const DOC_SITE_PATTERNS = [
  /\.gov\//,
  /\.edu\//,
  /arxiv\.org/,
  /ietf\.org/,
  /w3\.org/,
  /iso\.org/,
  /nist\.gov/,
  /acm\.org/,
  /ieee\.org/,
  /researchgate\.net/,
  /semanticscholar\.org/,
  /dl\.acm\.org/,
  /springer\.com/,
  /sciencedirect\.com/,
  /ssrn\.com/,
]

/** Pure function — no network calls, safe to unit test. */
export function shouldUsePdfRead(input: PdfRouteInput): PdfRouteResult {
  // Rule 1: URL ends with .pdf (ignore query/hash)
  const urlPath = input.url.split("?")[0].split("#")[0].toLowerCase()
  if (urlPath.endsWith(".pdf")) {
    return { usePdfRead: true, reason: "url_extension_pdf" }
  }

  // Rule 2: Known content-type
  if (input.contentType && input.contentType.toLowerCase().includes("application/pdf")) {
    return { usePdfRead: true, reason: "content_type_pdf" }
  }

  // Rule 3: Snippet has PDF signal AND URL is from a doc site
  if (input.snippet) {
    const lowerSnippet = input.snippet.toLowerCase()
    const hasSignal = PDF_SNIPPET_SIGNALS.some((s) => lowerSnippet.includes(s))
    const isDocSite = DOC_SITE_PATTERNS.some((p) => p.test(input.url))
    if (hasSignal && isDocSite) {
      return { usePdfRead: true, reason: "snippet_pdf_signal" }
    }
  }

  return { usePdfRead: false, reason: "not_pdf" }
}
