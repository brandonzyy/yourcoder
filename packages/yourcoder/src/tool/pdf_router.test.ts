import { describe, test, expect } from "bun:test"
import { shouldUsePdfRead } from "./pdf_router"

describe("shouldUsePdfRead", () => {
  describe("Rule 1: URL extension", () => {
    test(".pdf URL returns true/url_extension_pdf", () => {
      expect(shouldUsePdfRead({ url: "https://example.com/doc.pdf" })).toEqual({
        usePdfRead: true,
        reason: "url_extension_pdf",
      })
    })

    test(".pdf URL with query string still matches", () => {
      expect(shouldUsePdfRead({ url: "https://example.com/doc.pdf?v=2" })).toEqual({
        usePdfRead: true,
        reason: "url_extension_pdf",
      })
    })

    test(".pdf URL with hash still matches", () => {
      expect(shouldUsePdfRead({ url: "https://example.com/doc.pdf#page=2" })).toEqual({
        usePdfRead: true,
        reason: "url_extension_pdf",
      })
    })

    test(".PDF uppercase URL matches", () => {
      expect(shouldUsePdfRead({ url: "https://example.com/DOC.PDF" })).toEqual({
        usePdfRead: true,
        reason: "url_extension_pdf",
      })
    })
  })

  describe("Rule 2: content-type", () => {
    test("application/pdf content-type returns true/content_type_pdf", () => {
      expect(shouldUsePdfRead({ url: "https://example.com/file", contentType: "application/pdf" })).toEqual({
        usePdfRead: true,
        reason: "content_type_pdf",
      })
    })

    test("application/pdf with charset still matches", () => {
      expect(
        shouldUsePdfRead({ url: "https://example.com/file", contentType: "application/pdf; charset=utf-8" }),
      ).toEqual({ usePdfRead: true, reason: "content_type_pdf" })
    })

    test("text/html content-type does not match", () => {
      const result = shouldUsePdfRead({ url: "https://example.com/page", contentType: "text/html" })
      expect(result.usePdfRead).toBe(false)
    })
  })

  describe("Rule 3: snippet signal + doc site", () => {
    test("snippet with 'PDF' on arxiv.org returns true/snippet_pdf_signal", () => {
      expect(
        shouldUsePdfRead({
          url: "https://arxiv.org/abs/2301.00001",
          snippet: "Download PDF of this paper",
        }),
      ).toEqual({ usePdfRead: true, reason: "snippet_pdf_signal" })
    })

    test("snippet with 'whitepaper' on .gov returns true/snippet_pdf_signal", () => {
      expect(
        shouldUsePdfRead({
          url: "https://nist.gov/publications/report",
          snippet: "This whitepaper describes security guidelines",
        }),
      ).toEqual({ usePdfRead: true, reason: "snippet_pdf_signal" })
    })

    test("snippet with 'RFC' on ietf.org returns true/snippet_pdf_signal", () => {
      expect(
        shouldUsePdfRead({
          url: "https://ietf.org/rfc/rfc9000",
          snippet: "RFC 9000 QUIC transport protocol",
        }),
      ).toEqual({ usePdfRead: true, reason: "snippet_pdf_signal" })
    })

    test("snippet with PDF signal but NOT a doc site returns false", () => {
      const result = shouldUsePdfRead({
        url: "https://example.com/blog",
        snippet: "Download PDF of this article",
      })
      expect(result.usePdfRead).toBe(false)
      expect(result.reason).toBe("not_pdf")
    })

    test("doc site but no PDF signal in snippet returns false", () => {
      const result = shouldUsePdfRead({
        url: "https://arxiv.org/abs/2301.00001",
        snippet: "Abstract: This paper discusses machine learning",
      })
      expect(result.usePdfRead).toBe(false)
      expect(result.reason).toBe("not_pdf")
    })
  })

  describe("Rule 4: not_pdf fallback", () => {
    test("plain HTML URL returns false/not_pdf", () => {
      expect(shouldUsePdfRead({ url: "https://example.com/page.html" })).toEqual({
        usePdfRead: false,
        reason: "not_pdf",
      })
    })

    test("no inputs beyond URL returns false/not_pdf", () => {
      expect(shouldUsePdfRead({ url: "https://docs.example.com/guide" })).toEqual({
        usePdfRead: false,
        reason: "not_pdf",
      })
    })
  })

  describe("Rule priority (short-circuit)", () => {
    test("URL extension takes priority over content-type", () => {
      // url_extension_pdf fires first
      expect(
        shouldUsePdfRead({
          url: "https://example.com/doc.pdf",
          contentType: "text/html", // contradictory, but URL wins
        }),
      ).toEqual({ usePdfRead: true, reason: "url_extension_pdf" })
    })
  })
})
