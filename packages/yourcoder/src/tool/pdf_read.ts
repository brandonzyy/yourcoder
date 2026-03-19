import z from "zod"
import { Tool } from "./tool"
import { abortAfterAny } from "../util/abort"

type PdfMeta = {
  sourceType: "pdf"
  extractionStatus: "ok" | "partial" | "failed"
  pageCount: null
  contentLength: number
  reader: "pdf_read"
  error?: string
}

export const PdfReadTool = Tool.define("pdf_read", {
  description:
    "PDF reader: fetches a PDF URL, validates content-type, and returns structured text extraction with metadata. Only handles PDF content — does not classify sources or assess credibility.",
  parameters: z.object({
    url: z.string().describe("PDF URL"),
    timeout: z.number().optional().describe("Timeout seconds (max 60)"),
  }),
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: PdfMeta }> {
    if (!/^https?:\/\//.test(params.url)) throw new Error("URL must start with http:// or https://")

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: { url: params.url, strategy: "pdf", timeout: params.timeout },
    })

    const timeoutMs = Math.min((params.timeout ?? 20) * 1000, 60000)
    const { signal, clearTimeout } = abortAfterAny(timeoutMs, ctx.abort)

    let res: Response
    try {
      res = await fetch(params.url, { method: "GET", signal })
      clearTimeout()
    } catch (err) {
      clearTimeout()
      return {
        title: `pdf_read: ${params.url}`,
        output: `# PDF Read Result\n- URL: ${params.url}\n- Status: FETCH_ERROR\n- Error: ${String(err)}`,
        metadata: {
          sourceType: "pdf" as const,
          extractionStatus: "failed" as const,
          pageCount: null,
          contentLength: 0,
          reader: "pdf_read" as const,
          error: String(err),
        },
      }
    }

    if (!res.ok) {
      return {
        title: `pdf_read: ${params.url}`,
        output: `# PDF Read Result\n- URL: ${params.url}\n- Status: HTTP_ERROR\n- HTTP: ${res.status}`,
        metadata: {
          sourceType: "pdf" as const,
          extractionStatus: "failed" as const,
          pageCount: null,
          contentLength: 0,
          reader: "pdf_read" as const,
          error: `HTTP ${res.status}`,
        },
      }
    }

    const contentType = (res.headers.get("content-type") || "").toLowerCase()
    const bytes = await res.arrayBuffer()
    const isPdf =
      contentType.includes("application/pdf") || params.url.toLowerCase().split("?")[0].endsWith(".pdf")

    if (!isPdf) {
      return {
        title: `pdf_read: ${params.url}`,
        output: [
          "# PDF Read Result",
          `- URL: ${params.url}`,
          "- Status: NOT_PDF",
          `- Content-Type: ${contentType || "unknown"}`,
        ].join("\n"),
        metadata: {
          sourceType: "pdf" as const,
          extractionStatus: "failed" as const,
          pageCount: null,
          contentLength: bytes.byteLength,
          reader: "pdf_read" as const,
          error: `Not a PDF (content-type: ${contentType || "unknown"})`,
        },
      }
    }

    // Minimal text extraction: read raw bytes as latin-1 and pull printable ASCII runs
    // (placeholder until pdf.js or similar is wired in)
    const raw = new Uint8Array(bytes)
    const chunks: string[] = []
    let run = ""
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i]
      if (c >= 32 && c < 127) {
        run += String.fromCharCode(c)
      } else {
        if (run.length >= 4) chunks.push(run)
        run = ""
      }
    }
    if (run.length >= 4) chunks.push(run)

    const MAX_CHARS = 20000
    let extracted = chunks.join(" ").replace(/\s+/g, " ").trim()
    const truncated = extracted.length > MAX_CHARS
    if (truncated) extracted = extracted.slice(0, MAX_CHARS) + "\n\n[...truncated]"

    return {
      title: `pdf_read: ${params.url}`,
      output: [
        "# PDF Read Result",
        `- URL: ${params.url}`,
        `- Status: ${truncated ? "PARTIAL" : "OK"}`,
        `- Content-Type: ${contentType || "application/pdf"}`,
        `- Size: ${bytes.byteLength} bytes`,
        "",
        "## Extracted Text",
        extracted || "(no extractable text)",
      ].join("\n"),
      metadata: {
        sourceType: "pdf" as const,
        extractionStatus: (truncated ? "partial" : "ok") as "ok" | "partial" | "failed",
        pageCount: null,
        contentLength: bytes.byteLength,
        reader: "pdf_read" as const,
      },
    }
  },
})
