/// <reference types="bun" />

import { describe, expect, it, mock } from "bun:test"

const PNG_1X1_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const GIF_1X1_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"

function createPngDataUrl(width: number, height: number): string {
  const buf = Buffer.alloc(33)
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  buf.writeUInt32BE(13, 8)
  buf.set([0x49, 0x48, 0x44, 0x52], 12)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return `data:image/png;base64,${buf.toString("base64")}`
}

function createGifDataUrl(width: number, height: number): string {
  const buf = Buffer.alloc(10)
  buf.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0)
  buf.writeUInt16LE(width, 6)
  buf.writeUInt16LE(height, 8)
  return `data:image/gif;base64,${buf.toString("base64")}`
}

function createLargePngDataUrl(width: number, height: number, extraBase64Chars: number): string {
  const baseDataUrl = createPngDataUrl(width, height)
  const base64Data = baseDataUrl.slice(baseDataUrl.indexOf(",") + 1)
  const paddedBase64 = `${base64Data}${"A".repeat(extraBase64Chars)}`
  return `data:image/png;base64,${paddedBase64}`
}

async function parse(dataUrl: string, mime: string) {
  mock.restore()
  const path = new URL(`./image-dimensions.ts?image-dimensions-test=${Math.random()}`, import.meta.url).href
  const mod = await import(path)
  return mod.parseImageDimensions(dataUrl, mime)
}

describe("parseImageDimensions", () => {
  it("parses PNG 1x1 dimensions", async () => {
    //#given
    const dataUrl = PNG_1X1_DATA_URL

    //#when
    const result = await parse(dataUrl, "image/png")

    //#then
    expect(result).toEqual({ width: 1, height: 1 })
  })

  it("parses PNG dimensions from IHDR", async () => {
    //#given
    const dataUrl = createPngDataUrl(3000, 2000)

    //#when
    const result = await parse(dataUrl, "image/png")

    //#then
    expect(result).toEqual({ width: 3000, height: 2000 })
  })

  it("parses PNG dimensions from a very large base64 payload", async () => {
    //#given
    const dataUrl = createLargePngDataUrl(4096, 2160, 10 * 1024 * 1024)

    //#when
    const result = await parse(dataUrl, "image/png")

    //#then
    expect(result).toEqual({ width: 4096, height: 2160 })
  })

  it("parses GIF 1x1 dimensions", async () => {
    //#given
    const dataUrl = GIF_1X1_DATA_URL

    //#when
    const result = await parse(dataUrl, "image/gif")

    //#then
    expect(result).toEqual({ width: 1, height: 1 })
  })

  it("parses GIF dimensions from logical screen descriptor", async () => {
    //#given
    const dataUrl = createGifDataUrl(320, 240)

    //#when
    const result = await parse(dataUrl, "image/gif")

    //#then
    expect(result).toEqual({ width: 320, height: 240 })
  })

  it("returns null for empty input", async () => {
    //#given
    const dataUrl = ""

    //#when
    const result = await parse(dataUrl, "image/png")

    //#then
    expect(result).toBeNull()
  })

  it("returns null for too-short PNG buffer", async () => {
    //#given
    const dataUrl = "data:image/png;base64,AAAA"

    //#when
    const result = await parse(dataUrl, "image/png")

    //#then
    expect(result).toBeNull()
  })

  it("returns null for unsupported mime type", async () => {
    //#given
    const dataUrl = PNG_1X1_DATA_URL

    //#when
    const result = await parse(dataUrl, "image/heic")

    //#then
    expect(result).toBeNull()
  })
})
