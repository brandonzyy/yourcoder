import z from "zod"
import { Tool } from "./tool"
import { abortAfterAny } from "../util/abort"

type SemanticRole =
  | "link"
  | "button"
  | "textbox"
  | "searchbox"
  | "checkbox"
  | "radio"
  | "switch"
  | "combobox"
  | "listbox"
  | "option"
  | "menu"
  | "menuitem"
  | "navigation"
  | "form"
  | "dialog"
  | "tab"
  | "tabpanel"
  | "heading"
  | "region"
  | "generic"

interface SemanticElement {
  index: number
  action_id?: number
  tag: string
  role: SemanticRole
  name: string
  state: Record<string, string | boolean>
  value?: string
  path: string
  clickable: boolean
  group?: "collapsible" | "menu" | "form" | "dialog"
}

interface ContainerCtx {
  tag: string
  role: SemanticRole
  name?: string
  group?: "collapsible" | "menu" | "form" | "dialog"
}

const CLICKABLE_ROLES = new Set([
  "link",
  "button",
  "menuitem",
  "tab",
  "option",
  "checkbox",
  "radio",
  "switch",
])

const CLICKABLE_TAGS = new Set(["a", "button", "summary", "option"])

export const PageSemanticAdapterTool = Tool.define("page_semantic_adapter", {
  description:
    "Build actionable page semantic representation: accessibility-like role/name/state/value extraction, clickable indexing, and collapsible/menu/form semantics.",
  parameters: z.object({
    url: z.string().optional().describe("URL to fetch and analyze"),
    html: z.string().optional().describe("Raw HTML (if provided, skips fetch)"),
    max_elements: z.number().optional().describe("Max semantic elements to emit (default 200)"),
    include_hidden: z.boolean().optional().describe("Include aria-hidden/hidden elements (default false)"),
  }),
  async execute(params, ctx) {
    if (!params.url && !params.html) {
      throw new Error("Either url or html must be provided")
    }

    let html = params.html ?? ""
    if (!html && params.url) {
      if (!/^https?:\/\//.test(params.url)) throw new Error("URL must start with http:// or https://")

      await ctx.ask({
        permission: "webfetch",
        patterns: [params.url],
        always: ["*"],
        metadata: { url: params.url, tool: "page_semantic_adapter" },
      })

      const { signal, clearTimeout } = abortAfterAny(15000, ctx.abort)
      const res = await fetch(params.url, {
        signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      })
      clearTimeout()

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      html = await res.text()
    }

    const maxElements = Math.max(20, Math.min(params.max_elements ?? 200, 2000))
    const includeHidden = params.include_hidden ?? false

    const analyzed = analyzeSemantics(html, { maxElements, includeHidden })

    const lines = [
      "# Page Semantic Adapter",
      "",
      `- title: ${analyzed.title || "(none)"}`,
      `- total_elements: ${analyzed.elements.length}`,
      `- actionable_elements: ${analyzed.elements.filter((e) => e.clickable).length}`,
      `- groups: collapsible=${analyzed.stats.collapsible}, menu=${analyzed.stats.menu}, form=${analyzed.stats.form}, dialog=${analyzed.stats.dialog}`,
      "",
      "## Actionable Elements",
      "| action_id | role | name | state | path |",
      "|---:|---|---|---|---|",
      ...analyzed.elements
        .filter((e) => e.action_id !== undefined)
        .slice(0, 120)
        .map(
          (e) =>
            `| ${e.action_id} | ${e.role} | ${escapePipe(e.name || "(unnamed)")} | ${escapePipe(renderState(e.state))} | ${escapePipe(e.path)} |`,
        ),
      "",
      "## Notes",
      "- Use action_id for deterministic click/expand/select planning.",
      "- Collapsible/menu/form/dialog grouping is preserved in metadata.",
    ]

    return {
      title: `page_semantic_adapter: ${params.url ?? "inline-html"}`,
      output: lines.join("\n"),
      metadata: {
        title: analyzed.title,
        elements: analyzed.elements,
        stats: analyzed.stats,
        source: params.url ? "url" : "html",
      },
    }
  },
})

function analyzeSemantics(htmlRaw: string, options: { maxElements: number; includeHidden: boolean }) {
  const html = htmlRaw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")

  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "").trim()

  const elements: SemanticElement[] = []
  const stack: ContainerCtx[] = []

  let actionCounter = 1
  let semanticIndex = 1

  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/g
  let m: RegExpExecArray | null

  while ((m = tagRe.exec(html)) !== null) {
    if (elements.length >= options.maxElements) break

    const raw = m[0]
    const tag = m[1].toLowerCase()
    const attrsRaw = m[2] || ""
    const isClose = raw.startsWith("</")
    const isSelfClose = raw.endsWith("/>")

    if (isClose) {
      popContainer(stack, tag)
      continue
    }

    const attrs = parseAttributes(attrsRaw)
    const role = resolveRole(tag, attrs)
    const group = detectGroup(tag, role)

    if (group && !isSelfClose) {
      stack.push({
        tag,
        role,
        name: attrs["aria-label"] || attrs.title || "",
        group,
      })
    }

    const candidate = isSemanticCandidate(tag, attrs, role)
    if (!candidate) continue

    if (!options.includeHidden && isHidden(attrs)) continue

    const name = resolveName(html, m.index, tag, attrs)
    const state = resolveState(attrs)
    const value = resolveValue(attrs)
    const clickable = isClickable(tag, role, attrs)

    const item: SemanticElement = {
      index: semanticIndex++,
      tag,
      role,
      name,
      state,
      value,
      path: buildPath(stack, tag, role),
      clickable,
      group: inferGroup(stack, group),
    }

    if (clickable) item.action_id = actionCounter++

    elements.push(item)
  }

  const stats = {
    collapsible: elements.filter((e) => e.group === "collapsible").length,
    menu: elements.filter((e) => e.group === "menu").length,
    form: elements.filter((e) => e.group === "form").length,
    dialog: elements.filter((e) => e.group === "dialog").length,
  }

  return { title, elements, stats }
}

function parseAttributes(attrsRaw: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = attrRe.exec(attrsRaw)) !== null) {
    const key = m[1].toLowerCase()
    const val = m[2] ?? m[3] ?? m[4] ?? ""
    attrs[key] = decodeEntities(val.trim())
  }
  return attrs
}

function resolveRole(tag: string, attrs: Record<string, string>): SemanticRole {
  const explicit = attrs.role?.toLowerCase()
  if (explicit) return normalizeRole(explicit)

  if (tag === "a" && attrs.href) return "link"
  if (tag === "button") return "button"
  if (tag === "input") {
    const type = (attrs.type || "text").toLowerCase()
    if (["checkbox"].includes(type)) return "checkbox"
    if (["radio"].includes(type)) return "radio"
    if (["search"].includes(type)) return "searchbox"
    if (["button", "submit", "reset"].includes(type)) return "button"
    return "textbox"
  }
  if (tag === "textarea") return "textbox"
  if (tag === "select") return "combobox"
  if (tag === "option") return "option"
  if (tag === "nav") return "navigation"
  if (tag === "menu") return "menu"
  if (tag === "form") return "form"
  if (tag === "dialog") return "dialog"
  if (tag === "summary") return "button"
  if (/^h[1-6]$/.test(tag)) return "heading"
  return "generic"
}

function normalizeRole(role: string): SemanticRole {
  const known: SemanticRole[] = [
    "link", "button", "textbox", "searchbox", "checkbox", "radio", "switch",
    "combobox", "listbox", "option", "menu", "menuitem", "navigation", "form",
    "dialog", "tab", "tabpanel", "heading", "region", "generic",
  ]
  return (known.includes(role as SemanticRole) ? role : "generic") as SemanticRole
}

function detectGroup(tag: string, role: SemanticRole): SemanticElement["group"] | undefined {
  if (tag === "details") return "collapsible"
  if (tag === "menu" || role === "menu" || role === "menuitem" || role === "navigation") return "menu"
  if (tag === "form" || role === "form") return "form"
  if (tag === "dialog" || role === "dialog") return "dialog"
  return undefined
}

function inferGroup(stack: ContainerCtx[], selfGroup: SemanticElement["group"]) {
  if (selfGroup) return selfGroup
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i].group) return stack[i].group
  return undefined
}

function popContainer(stack: ContainerCtx[], closingTag: string) {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].tag === closingTag) {
      stack.splice(i)
      return
    }
  }
}

function isSemanticCandidate(tag: string, attrs: Record<string, string>, role: SemanticRole): boolean {
  if (role !== "generic") return true
  if (attrs.role || attrs["aria-label"] || attrs["aria-expanded"] || attrs["aria-controls"]) return true
  if (attrs.onclick !== undefined || attrs.tabindex !== undefined || attrs.contenteditable !== undefined) return true
  return ["details", "summary", "label", "fieldset"].includes(tag)
}

function isClickable(tag: string, role: SemanticRole, attrs: Record<string, string>): boolean {
  if (attrs.disabled !== undefined || attrs["aria-disabled"] === "true") return false
  if (CLICKABLE_TAGS.has(tag) || CLICKABLE_ROLES.has(role)) return true
  if (attrs.onclick !== undefined) return true
  return attrs.tabindex !== undefined && attrs.role !== undefined
}

function isHidden(attrs: Record<string, string>): boolean {
  if (attrs.hidden !== undefined || attrs["aria-hidden"] === "true") return true
  const style = (attrs.style || "").toLowerCase()
  return style.includes("display:none") || style.includes("visibility:hidden")
}

function resolveName(html: string, openTagIndex: number, tag: string, attrs: Record<string, string>): string {
  const aria = attrs["aria-label"] || attrs.title || attrs.alt || attrs.placeholder
  if (aria) return aria
  if (attrs.value && ["button", "submit", "reset"].includes((attrs.type || "").toLowerCase())) return attrs.value
  const text = extractImmediateText(html, openTagIndex, tag)
  if (text) return text
  if (attrs.name) return attrs.name
  if (attrs.id) return `#${attrs.id}`
  if (tag === "a" && attrs.href) return attrs.href
  return ""
}

function extractImmediateText(html: string, openTagIndex: number, tag: string): string {
  const after = html.slice(openTagIndex)
  const close = new RegExp(`<\/${tag}>`, "i")
  const closeMatch = close.exec(after)
  if (!closeMatch) return ""
  const openEnd = after.indexOf(">")
  if (openEnd < 0) return ""
  const inner = after.slice(openEnd + 1, closeMatch.index)
  return decodeEntities(inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 160)
}

function resolveState(attrs: Record<string, string>): Record<string, string | boolean> {
  const state: Record<string, string | boolean> = {}
  for (const k of ["disabled", "readonly", "required", "checked", "selected", "open"]) {
    if (attrs[k] !== undefined) state[k] = true
  }
  for (const key of ["aria-expanded", "aria-checked", "aria-pressed", "aria-selected", "aria-current", "aria-invalid", "aria-busy"]) {
    if (attrs[key] !== undefined) state[key.replace("aria-", "")] = attrs[key]
  }
  if (attrs["data-state"]) state.dataState = attrs["data-state"]
  return state
}

function resolveValue(attrs: Record<string, string>): string | undefined {
  return attrs.value || attrs.placeholder || undefined
}

function buildPath(stack: ContainerCtx[], tag: string, role: SemanticRole): string {
  const segs = stack.map((s) => `${s.tag}[${s.role}]`)
  segs.push(`${tag}[${role}]`)
  return segs.join(" > ")
}

function renderState(state: Record<string, string | boolean>): string {
  const entries = Object.entries(state)
  return entries.length ? entries.map(([k, v]) => `${k}=${String(v)}`).join(", ") : "-"
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

function escapePipe(input: string): string {
  return input.replace(/\|/g, "\|")
}
