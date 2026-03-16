// Merged from: constants.ts, types.ts, look-at-arguments.ts, assistant-message-extractor.ts, tools.ts
import { basename } from "node:path"
import { pathToFileURL } from "node:url"
import { tool, type PluginInput, type ToolDefinition } from "../../plugin/sdk"
import {log} from "../../util/logger"
import {promptSyncWithModelSuggestionRetry} from "../../model/model-suggestion-retry"
import {
  extractBase64Data,
  inferMimeTypeFromBase64,
  inferMimeTypeFromFilePath,
} from "./mime-type-inference"
import { resolveMultimodalLookerAgentMetadata } from "./multimodal-agent-metadata"
import {
  needsConversion,
  convertImageToJpeg,
  convertBase64ImageToJpeg,
  cleanupConvertedImage,
} from "./image-converter"

// --- constants ---

export const MULTIMODAL_LOOKER_AGENT = "multimodal-looker" as const

export const LOOK_AT_DESCRIPTION = `Analyze media files (PDFs, images, diagrams) that require interpretation beyond raw text. Extracts specific information or summaries from documents, describes visual content. Use when you need analyzed/extracted data rather than literal file contents.`

// --- types ---

export interface LookAtArgs {
  file_path?: string
  image_data?: string  // base64 encoded image data (for clipboard images)
  goal: string
}

// --- look-at-arguments ---

export interface LookAtArgsWithAlias extends LookAtArgs {
  path?: string
}

export function normalizeArgs(args: LookAtArgsWithAlias): LookAtArgs {
  return {
    file_path: args.file_path ?? args.path,
    image_data: args.image_data,
    goal: args.goal ?? "",
  }
}

export function validateArgs(args: LookAtArgs): string | null {
  const hasFilePath = Boolean(args.file_path && args.file_path.length > 0)
  const hasImageData = Boolean(args.image_data && args.image_data.length > 0)

  if (hasFilePath && /^https?:\/\//i.test(args.file_path!)) {
    return "Error: Remote URLs are not supported for file_path. Download the file first or use a local path."
  }
  if (!hasFilePath && !hasImageData) {
    return `Error: Must provide either 'file_path' or 'image_data'. Usage:
- look_at(file_path="/path/to/file", goal="what to extract")
- look_at(image_data="base64_encoded_data", goal="what to extract")`
  }
  if (hasFilePath && hasImageData) {
    return "Error: Provide only one of 'file_path' or 'image_data', not both."
  }
  if (!args.goal) {
    return "Error: Missing required parameter 'goal'. Usage: look_at(file_path=\"/path/to/file\", goal=\"what to extract\")"
  }
  return null
}

// --- assistant-message-extractor ---

type MessageTime = { created?: number }

type MessageInfo = {
  role?: string
  time?: MessageTime
}

type MessagePart = {
  type?: string
  text?: string
}

type SessionMessage = {
  info?: MessageInfo
  parts?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asSessionMessage(value: unknown): SessionMessage | null {
  if (!isObject(value)) return null
  const info = value["info"]
  const parts = value["parts"]
  return {
    info: isObject(info)
      ? {
          role: typeof info["role"] === "string" ? info["role"] : undefined,
          time: isObject(info["time"]) ? { created: typeof info["time"]["created"] === "number" ? info["time"]["created"] : undefined } : undefined,
        }
      : undefined,
    parts,
  }
}

function getCreatedTime(message: SessionMessage): number {
  return message.info?.time?.created ?? 0
}

function getTextParts(message: SessionMessage): MessagePart[] {
  if (!Array.isArray(message.parts)) return []
  return message.parts
    .filter((part): part is Record<string, unknown> => isObject(part))
    .map((part) => ({
      type: typeof part["type"] === "string" ? part["type"] : undefined,
      text: typeof part["text"] === "string" ? part["text"] : undefined,
    }))
    .filter((part) => part.type === "text" && Boolean(part.text))
}

export function extractLatestAssistantText(messages: unknown): string | null {
  if (!Array.isArray(messages) || messages.length === 0) return null

  const assistantMessages = messages
    .map(asSessionMessage)
    .filter((message): message is SessionMessage => message !== null)
    .filter((message) => message.info?.role === "assistant")
    .sort((a, b) => getCreatedTime(b) - getCreatedTime(a))

  const lastAssistantMessage = assistantMessages[0]
  if (!lastAssistantMessage) return null

  const textParts = getTextParts(lastAssistantMessage)
  const responseText = textParts.map((part) => part.text).join("\n")
  return responseText
}

// --- tools ---

function getTemporaryConversionPath(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }

  const temporaryOutputPath = Reflect.get(error, "temporaryOutputPath")
  if (typeof temporaryOutputPath === "string" && temporaryOutputPath.length > 0) {
    return temporaryOutputPath
  }

  const temporaryDirectory = Reflect.get(error, "temporaryDirectory")
  if (typeof temporaryDirectory === "string" && temporaryDirectory.length > 0) {
    return temporaryDirectory
  }

  return null
}

export function createLookAt(ctx: PluginInput): ToolDefinition {
  return tool({
    description: LOOK_AT_DESCRIPTION,
    args: {
      file_path: tool.schema.string().optional().describe("Absolute path to the file to analyze"),
      image_data: tool.schema.string().optional().describe("Base64 encoded image data (for clipboard/pasted images)"),
      goal: tool.schema.string().describe("What specific information to extract from the file"),
    },
    async execute(rawArgs: LookAtArgs, toolContext) {
      const args = normalizeArgs(rawArgs as LookAtArgsWithAlias)
      const validationError = validateArgs(args)
      if (validationError) {
        log(`[look_at] Validation failed: ${validationError}`)
        return validationError
      }

      const isBase64Input = Boolean(args.image_data)
      const sourceDescription = isBase64Input ? "clipboard/pasted image" : args.file_path
      log(`[look_at] Analyzing ${sourceDescription}, goal: ${args.goal}`)

      const imageData = args.image_data
      const filePath = args.file_path

      let mimeType: string
      let filePart: { type: "file"; mime: string; url: string; filename: string }
      let tempFilePath: string | null = null
      let tempConversionPath: string | null = null
      let tempFilesToCleanup: string[] = []

      try {
        if (imageData) {
          mimeType = inferMimeTypeFromBase64(imageData)

          let finalBase64Data = extractBase64Data(imageData)
          let finalMimeType = mimeType

          if (needsConversion(mimeType)) {
            log(`[look_at] Detected unsupported Base64 format: ${mimeType}, converting to JPEG...`)
            try {
              const { base64, tempFiles } = convertBase64ImageToJpeg(finalBase64Data, mimeType)
              finalBase64Data = base64
              finalMimeType = "image/jpeg"
              tempFilesToCleanup = tempFiles
              log(`[look_at] Base64 conversion successful`)
            } catch (conversionError) {
              log(`[look_at] Base64 conversion failed: ${conversionError}`)
              return `Error: Failed to convert Base64 image format. ${conversionError}`
            }
          }

          filePart = {
            type: "file",
            mime: finalMimeType,
            url: `data:${finalMimeType};base64,${finalBase64Data}`,
            filename: `clipboard-image.${finalMimeType.split("/")[1] || "png"}`,
          }
        } else if (filePath) {
        mimeType = inferMimeTypeFromFilePath(filePath)

        let actualFilePath = filePath
        if (needsConversion(mimeType)) {
          log(`[look_at] Detected unsupported format: ${mimeType}, converting to JPEG...`)
          try {
            tempFilePath = convertImageToJpeg(filePath, mimeType)
            tempConversionPath = tempFilePath
            actualFilePath = tempFilePath
            mimeType = "image/jpeg"
            log(`[look_at] Conversion successful: ${tempFilePath}`)
          } catch (conversionError) {
            const failedConversionPath = getTemporaryConversionPath(conversionError)
            if (failedConversionPath) {
              tempConversionPath = failedConversionPath
            }
            log(`[look_at] Conversion failed: ${conversionError}`)
            return `Error: Failed to convert image format. ${conversionError}`
          }
        }

        filePart = {
          type: "file",
          mime: mimeType,
          url: pathToFileURL(actualFilePath).href,
          filename: basename(actualFilePath),
        }
      } else {
        return "Error: Must provide either 'file_path' or 'image_data'."
      }

      const prompt = `Analyze this ${isBase64Input ? "image" : "file"} and extract the requested information.

Goal: ${args.goal}

Provide ONLY the extracted information that matches the goal.
Be thorough on what was requested, concise on everything else.
If the requested information is not found, clearly state what is missing.`

      log(`[look_at] Creating session with parent: ${toolContext.sessionID}`)
      const parentSession = await ctx.client.session.get({
        path: { id: toolContext.sessionID },
      }).catch(() => null)
      const parentDirectory = parentSession?.data?.directory ?? ctx.directory

      const createResult = await ctx.client.session.create({
        body: {
          parentID: toolContext.sessionID,
          title: `look_at: ${args.goal.substring(0, 50)}`,
        },
        query: { directory: parentDirectory },
      })

      if (createResult.error) {
        log(`[look_at] Session create error:`, createResult.error)
        const errorStr = String(createResult.error)
        if (errorStr.toLowerCase().includes("unauthorized")) {
          return `Error: Failed to create session (Unauthorized). This may be due to:
1. OAuth token restrictions (e.g., Claude Code credentials are restricted to Claude Code only)
2. Provider authentication issues
3. Session permission inheritance problems

Try using a different provider or API key authentication.

Original error: ${createResult.error}`
        }
        return `Error: Failed to create session: ${createResult.error}`
      }

      const sessionID = createResult.data.id
      log(`[look_at] Created session: ${sessionID}`)

      const { agentModel, agentVariant } = await resolveMultimodalLookerAgentMetadata(ctx)

      log(`[look_at] Sending prompt with ${isBase64Input ? "base64 image" : "file"} to session ${sessionID}`)
      try {
        await promptSyncWithModelSuggestionRetry(ctx.client, {
          path: { id: sessionID },
          body: {
            agent: MULTIMODAL_LOOKER_AGENT,
            tools: {
              task: false,
              call_omo_agent: false,
              look_at: false,
              read: false,
            },
            parts: [
              { type: "text", text: prompt },
              filePart,
            ],
            ...(agentModel ? { model: { providerID: agentModel.providerID, modelID: agentModel.modelID } } : {}),
            ...(agentVariant ? { variant: agentVariant } : {}),
          },
        })
      } catch (promptError) {
        log(`[look_at] Prompt error (ignored, will still fetch messages):`, promptError)
      }

      log(`[look_at] Fetching messages from session ${sessionID}...`)

      const messagesResult = await ctx.client.session.messages({
        path: { id: sessionID },
      })

      if (messagesResult.error) {
        log(`[look_at] Messages error:`, messagesResult.error)
        return `Error: Failed to get messages: ${messagesResult.error}`
      }

      const messages = messagesResult.data
      log(`[look_at] Got ${messages.length} messages`)

      const responseText = extractLatestAssistantText(messages)
      if (!responseText) {
        log("[look_at] No assistant message found")
        return "Error: No response from multimodal-looker agent"
      }

        log(`[look_at] Got response, length: ${responseText.length}`)
        return responseText
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        log(`[look_at] Unexpected error analyzing ${sourceDescription}:`, error)
        return `Error: Failed to analyze ${sourceDescription}: ${errorMessage}`
      } finally {
        if (tempConversionPath) {
          cleanupConvertedImage(tempConversionPath)
        } else if (tempFilePath) {
          cleanupConvertedImage(tempFilePath)
        }
        tempFilesToCleanup.forEach(file => {
          cleanupConvertedImage(file)
        })
      }
    },
  })
}
