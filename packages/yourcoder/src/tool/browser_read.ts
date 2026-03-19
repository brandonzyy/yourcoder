import z from "zod"
import { Tool } from "./tool"
import { abortAfterAny } from "../util/abort"

export const BrowserReadTool = Tool.define("browser_read", {
  description:
    "Browser reader for JS-heavy pages. Uses local playwright-cli when available to capture rendered text and accessibility snapshot; falls back to static fetch if unavailable.",
  parameters: z.object({
    url: z.string().describe("URL to read with browser strategy"),
    timeout: z.number().optional().describe("Timeout seconds (max 60)"),
  }),
  async execute(params, ctx) {
    if (!/^https?:\/\//.test(params.url)) throw new Error("URL must start with http:// or https://")

    await ctx.ask({
      permission: "webfetch",
      patterns: [params.url],
      always: ["*"],
      metadata: { url: params.url, strategy: "browser", timeout: params.timeout },
    })

    const timeoutMs = Math.min((params.timeout ?? 30) * 1000, 60000)
    const { signal, clearTimeout } = abortAfterAny(timeoutMs, ctx.abort)

    try {
      const snapshot = await tryPlaywrightCli(params.url, timeoutMs)
      if (snapshot) {
        return {
          title: `browser_read: ${params.url}`,
          output: [
            "# Browser Read Result",
            `- URL: ${params.url}`,
            "- Strategy: playwright-cli",
            `- Status: ${snapshot.status}`,
            snapshot.title ? `- Title: ${snapshot.title}` : "- Title: (unknown)",
            "",
            "## Rendered Text",
            snapshot.renderedText || "(empty)",
            "",
            "## Accessibility Snapshot",
            snapshot.axTree || "(empty)",
          ].join("\n"),
          metadata: {
            strategy: "browser",
            engine: "playwright-cli",
            status: snapshot.status,
            title: snapshot.title,
            hasAxTree: Boolean(snapshot.axTree),
          },
        }
      }

      // fallback to static fetch if playwright-cli is unavailable
      const res = await fetch(params.url, {
        signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const html = await res.text()
      const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").trim()
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 12000)

      return {
        title: `browser_read: ${params.url}`,
        output: [
          "# Browser Read Result",
          `- URL: ${params.url}`,
          "- Strategy: static-fallback",
          "- Status: PLAYWRIGHT_UNAVAILABLE",
          title ? `- Title: ${title}` : "- Title: (unknown)",
          "",
          "## Content",
          text || "(empty)",
        ].join("\n"),
        metadata: {
          strategy: "browser",
          engine: "fallback",
          status: "playwright_unavailable",
          title,
          hasAxTree: false,
        },
      }
    } finally {
      clearTimeout()
    }
  },
})

async function tryPlaywrightCli(url: string, timeoutMs: number) {
  const open = await runCli(["open", url], timeoutMs)
  if (!open.ok) return null

  const snap = await runCli(["snapshot"], timeoutMs)
  const titleRes = await runCli(["eval", "document.title"], timeoutMs)
  await runCli(["close"], Math.min(timeoutMs, 15000))

  if (!snap.ok && !titleRes.ok) return null

  const axTree = snap.stdout.trim()
  const renderedText = renderTextFromAx(axTree)

  return {
    status: snap.ok ? "ok" : "partial",
    axTree,
    renderedText,
    title: titleRes.ok ? titleRes.stdout.trim() : undefined,
  }
}

async function runCli(args: string[], timeoutMs: number) {
  let proc: ReturnType<typeof Bun.spawn> | undefined
  const timer = setTimeout(() => {
    try {
      proc?.kill()
    } catch {}
  }, timeoutMs)

  try {
    proc = Bun.spawn({
      cmd: ["playwright-cli", ...args],
      stdout: "pipe",
      stderr: "pipe",
    })

    const [stdoutBuf, stderrBuf, code] = await Promise.all([new Response(proc.stdout as ReadableStream).text(), new Response(proc.stderr as ReadableStream).text(), proc.exited])

    return {
      ok: code === 0,
      code,
      stdout: stdoutBuf,
      stderr: stderrBuf,
    }
  } catch {
    return {
      ok: false,
      code: -1,
      stdout: "",
      stderr: "playwright-cli not available",
    }
  } finally {
    clearTimeout(timer)
  }
}

function renderTextFromAx(ax: string): string {
  if (!ax) return ""
  const lines = ax.split(/\r?\n/)
  const out: string[] = []
  for (const line of lines) {
    const cleaned = line.trim()
    if (!cleaned) continue
    if (/^e\d+/.test(cleaned) || /role[:=]/i.test(cleaned) || /label[:=]/i.test(cleaned) || /name[:=]/i.test(cleaned)) {
      out.push(cleaned)
    }
    if (out.length >= 300) break
  }
  return out.join("\n")
}
