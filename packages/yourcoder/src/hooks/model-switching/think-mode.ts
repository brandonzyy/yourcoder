// Merged from: types.ts, detector.ts, switcher.ts, hook.ts
import { normalizeModelID } from "../../model/normalize"
import { log } from "../../util/logger"

// --- types ---

export interface ThinkModeState {
  requested: boolean
  modelSwitched: boolean
  variantSet: boolean
  providerID?: string
  modelID?: string
}

// --- detector ---

const ENGLISH_PATTERNS = [/\bultrathink\b/i, /\bthink\b/i]

const MULTILINGUAL_KEYWORDS = [
  "생각", "고민", "검토", "제대로",
  "思考", "考虑", "考慮",
  "思考", "考え", "熟考",
  "सोच", "विचार",
  "تفكير", "تأمل",
  "চিন্তা", "ভাবনা",
  "думать", "думай", "размышлять", "размышляй",
  "pensar", "pense", "refletir", "reflita",
  "pensar", "piensa", "reflexionar", "reflexiona",
  "penser", "pense", "réfléchir", "réfléchis",
  "denken", "denk", "nachdenken",
  "suy nghĩ", "cân nhắc",
  "düşün", "düşünmek",
  "pensare", "pensa", "riflettere", "rifletti",
  "คิด", "พิจารณา",
  "myśl", "myśleć", "zastanów",
  "denken", "denk", "nadenken",
  "berpikir", "pikir", "pertimbangkan",
  "думати", "думай", "роздумувати",
  "σκέψου", "σκέφτομαι",
  "myslet", "mysli", "přemýšlet",
  "gândește", "gândi", "reflectă",
  "tänka", "tänk", "fundera",
  "gondolkodj", "gondolkodni",
  "ajattele", "ajatella", "pohdi",
  "tænk", "tænke", "overvej",
  "tenk", "tenke", "gruble",
  "חשוב", "לחשוב", "להרהר",
  "fikir", "berfikir",
]

const MULTILINGUAL_PATTERNS = MULTILINGUAL_KEYWORDS.map((kw) => new RegExp(kw, "i"))
const THINK_PATTERNS = [...ENGLISH_PATTERNS, ...MULTILINGUAL_PATTERNS]

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
const INLINE_CODE_PATTERN = /`[^`]+`/g

function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "")
}

export function detectThinkKeyword(text: string): boolean {
  const textWithoutCode = removeCodeBlocks(text)
  return THINK_PATTERNS.some((pattern) => pattern.test(textWithoutCode))
}

export function extractPromptText(
  parts: Array<{ type: string; text?: string }>
): string {
  return parts
    .filter((p) => p.type === "text")
    .map((p) => p.text || "")
    .join("")
}

// --- switcher ---

/**
 * Extracts provider-specific prefix from model ID (if present).
 */
function extractModelPrefix(modelID: string): { prefix: string; base: string } {
  const slashIndex = modelID.indexOf("/")
  if (slashIndex === -1) {
    return { prefix: "", base: modelID }
  }
  return {
    prefix: modelID.slice(0, slashIndex + 1),
    base: modelID.slice(slashIndex + 1),
  }
}

const HIGH_VARIANT_MAP: Record<string, string> = {
  // Claude
  "claude-sonnet-4-6": "claude-sonnet-4-6-high",
  "claude-opus-4-6": "claude-opus-4-6-high",
   // Gemini
   "gemini-3-1-pro": "gemini-3-1-pro-high",
   "gemini-3-1-pro-low": "gemini-3-1-pro-high",
   "gemini-3-flash": "gemini-3-flash-high",
  // GPT-5
  "gpt-5": "gpt-5-high",
  "gpt-5-mini": "gpt-5-mini-high",
  "gpt-5-nano": "gpt-5-nano-high",
  "gpt-5-pro": "gpt-5-pro-high",
  "gpt-5-chat-latest": "gpt-5-chat-latest-high",
  // GPT-5.1
  "gpt-5-1": "gpt-5-1-high",
  "gpt-5-1-chat-latest": "gpt-5-1-chat-latest-high",
  "gpt-5-1-codex": "gpt-5-1-codex-high",
  "gpt-5-1-codex-mini": "gpt-5-1-codex-mini-high",
  "gpt-5-1-codex-max": "gpt-5-1-codex-max-high",
  // GPT-5.4
  "gpt-5-4": "gpt-5-4-high",
  "gpt-5-4-chat-latest": "gpt-5-4-chat-latest-high",
  "gpt-5-4-pro": "gpt-5-4-pro-high",
  // Antigravity (Google)
  "antigravity-gemini-3-1-pro": "antigravity-gemini-3-1-pro-high",
  "antigravity-gemini-3-flash": "antigravity-gemini-3-flash-high",
}

const ALREADY_HIGH: Set<string> = new Set(Object.values(HIGH_VARIANT_MAP))

export function getHighVariant(modelID: string): string | null {
  const normalized = normalizeModelID(modelID)
  const { prefix, base } = extractModelPrefix(normalized)

  if (ALREADY_HIGH.has(base) || base.endsWith("-high")) {
    return null
  }

  const highBase = HIGH_VARIANT_MAP[base]
  if (!highBase) {
    return null
  }

  return prefix + highBase
}

export function isAlreadyHighVariant(modelID: string): boolean {
  const normalized = normalizeModelID(modelID)
  const { base } = extractModelPrefix(normalized)
  return ALREADY_HIGH.has(base) || base.endsWith("-high")
}

// --- hook ---

const thinkModeState = new Map<string, ThinkModeState>()

export function clearThinkModeState(sessionID: string): void {
  thinkModeState.delete(sessionID)
}

export function createThinkModeHook() {
  return {
    "chat.message": async (
      input: {
        sessionID: string
        model?: { providerID: string; modelID: string }
      },
      output: {
        message: Record<string, unknown>
        parts: Array<{ type: string; text?: string; [key: string]: unknown }>
      }
    ): Promise<void> => {
      const promptText = extractPromptText(output.parts)
      const sessionID = input.sessionID

      const state: ThinkModeState = {
        requested: false,
        modelSwitched: false,
        variantSet: false,
      }

      if (!detectThinkKeyword(promptText)) {
        thinkModeState.set(sessionID, state)
        return
      }

      state.requested = true

      if (typeof output.message.variant === "string") {
        thinkModeState.set(sessionID, state)
        return
      }

      const currentModel = input.model
      if (!currentModel) {
        thinkModeState.set(sessionID, state)
        return
      }

      state.providerID = currentModel.providerID
      state.modelID = currentModel.modelID

      if (isAlreadyHighVariant(currentModel.modelID)) {
        thinkModeState.set(sessionID, state)
        return
      }

      const highVariant = getHighVariant(currentModel.modelID)

      if (highVariant) {
        output.message.model = {
          providerID: currentModel.providerID,
          modelID: highVariant,
        }
        output.message.variant = "high"
        state.modelSwitched = true
        state.variantSet = true
        log("Think mode: model switched to high variant", {
          sessionID,
          from: currentModel.modelID,
          to: highVariant,
        })
      }

      thinkModeState.set(sessionID, state)
    },

    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type === "session.deleted") {
        const props = event.properties as { info?: { id?: string } } | undefined
        if (props?.info?.id) {
          thinkModeState.delete(props.info.id)
        }
      }
    },
  }
}
