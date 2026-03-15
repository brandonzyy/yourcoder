/// <reference types="bun" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import type { PluginInput } from "../../plugin/sdk"

import type { ImageDimensions, ResizeResult } from "./types"

const mockCalculateTargetDimensions = mock((): ImageDimensions | null => null)
const mockResizeImage = mock(async (): Promise<ResizeResult | null> => null)
const mockGetSessionModel = mock((_sessionID: string) => ({
  providerID: "anthropic",
  modelID: "claude-sonnet-4-6",
} as { providerID: string; modelID: string } | undefined))

mock.module("./image-resizer", () => ({
  calculateTargetDimensions: mockCalculateTargetDimensions,
  resizeImage: mockResizeImage,
}))

mock.module("../../session/session-model-state", () => ({
  getSessionModel: mockGetSessionModel,
}))

import { createReadImageResizerHook } from "./hook"

function createPngDataUrl(width: number, height: number): string {
  const buf = Buffer.alloc(33)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  buf.writeUInt32BE(13, 8)
  buf.set([0x49, 0x48, 0x44, 0x52], 12)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return `data:image/png;base64,${buf.toString("base64")}`
}

type ToolOutput = {
  title: string
  output: string
  metadata: unknown
  attachments?: Array<{ mime: string; url: string; filename?: string }>
}

function createMockContext(): PluginInput {
  return {
    client: {} as PluginInput["client"],
    directory: "/test",
  } as PluginInput
}

function createInput(tool: string): { tool: string; sessionID: string; callID: string } {
  return {
    tool,
    sessionID: "session-1",
    callID: "call-1",
  }
}

describe("createReadImageResizerHook", () => {
  beforeEach(() => {
    mockCalculateTargetDimensions.mockReset()
    mockResizeImage.mockReset()
    mockGetSessionModel.mockReset()
    mockGetSessionModel.mockReturnValue({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
  })

  afterEach(() => {
    mock.restore()
  })

  it("skips non-Read tools", async () => {
    //#given
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: "data:image/png;base64,old", filename: "image.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Bash"), output)

    //#then
    expect(output.output).toBe("original output")
  })

  it("skips when provider is not anthropic", async () => {
    //#given
    mockGetSessionModel.mockReturnValue({ providerID: "openai", modelID: "gpt-5.3-codex" })
    mockCalculateTargetDimensions.mockReturnValue({ width: 1568, height: 1045 })
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: createPngDataUrl(3000, 2000), filename: "image.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toBe("original output")
  })

  it("skips when session model is unknown", async () => {
    //#given
    mockGetSessionModel.mockReturnValue(undefined)
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: createPngDataUrl(3000, 2000), filename: "image.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toBe("original output")
  })

  it("skips Read output with no attachments", async () => {
    //#given
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toBe("original output")
  })

  it("skips non-image attachments", async () => {
    //#given
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "application/pdf", url: "data:application/pdf;base64,AAAA", filename: "file.pdf" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toBe("original output")
  })

  it("skips unsupported image mime types", async () => {
    //#given
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/heic", url: "data:image/heic;base64,AAAA", filename: "photo.heic" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toBe("original output")
  })

  it("appends within-limits metadata when image is already valid", async () => {
    //#given
    mockCalculateTargetDimensions.mockReturnValue(null)
    const url = createPngDataUrl(800, 600)

    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url, filename: "image.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toContain("[Image Info]")
    expect(output.output).toContain("within limits")
    expect(output.attachments?.[0]?.url).toBe(url)
    expect(mockResizeImage).not.toHaveBeenCalled()
  })

  it("replaces attachment URL and appends resize metadata for oversized image", async () => {
    //#given
    mockCalculateTargetDimensions.mockReturnValue({ width: 1568, height: 1045 })
    mockResizeImage.mockResolvedValue({
      resizedDataUrl: "data:image/png;base64,resized",
      original: { width: 3000, height: 2000 },
      resized: { width: 1568, height: 1045 },
    })

    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: createPngDataUrl(3000, 2000), filename: "big.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.attachments?.[0]?.url).toBe("data:image/png;base64,resized")
    expect(output.output).toContain("[Image Resize Info]")
    expect(output.output).toContain("resized")
  })

  it("keeps original attachment URL and marks resize skipped when resize fails", async () => {
    //#given
    mockCalculateTargetDimensions.mockReturnValue({ width: 1568, height: 1045 })
    mockResizeImage.mockResolvedValue(null)
    const url = createPngDataUrl(3000, 2000)

    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url, filename: "fail.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.attachments?.[0]?.url).toBe(url)
    expect(output.output).toContain("resize skipped")
  })

  it("appends unknown-dimensions metadata when parsing fails", async () => {
    //#given
    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: "data:image/png;base64,AAAA", filename: "corrupt.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("Read"), output)

    //#then
    expect(output.output).toContain("dimensions could not be parsed")
    expect(mockCalculateTargetDimensions).not.toHaveBeenCalled()
  })

  it("fires for lowercase read tool name", async () => {
    //#given
    mockCalculateTargetDimensions.mockReturnValue(null)

    const hook = createReadImageResizerHook(createMockContext())
    const output: ToolOutput = {
      title: "Read",
      output: "original output",
      metadata: {},
      attachments: [{ mime: "image/png", url: createPngDataUrl(800, 600), filename: "image.png" }],
    }

    //#when
    await hook["tool.execute.after"](createInput("read"), output)

    //#then
    expect(output.output).toContain("within limits")
  })
})
