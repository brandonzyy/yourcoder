import { describe, expect, it, test } from "bun:test"
import { normalizeModel, normalizeModelID, normalizeModelFormat, normalizeSDKResponse } from "./normalize"

describe("normalizeModel", () => {
	describe("#given undefined input", () => {
		test("#when normalizeModel is called with undefined #then returns undefined", () => {
			const input = undefined
			const result = normalizeModel(input)
			expect(result).toBeUndefined()
		})
	})

	describe("#given empty string", () => {
		test("#when normalizeModel is called with empty string #then returns undefined", () => {
			const input = ""
			const result = normalizeModel(input)
			expect(result).toBeUndefined()
		})
	})

	describe("#given whitespace-only string", () => {
		test("#when normalizeModel is called with whitespace-only string #then returns undefined", () => {
			const input = "   "
			const result = normalizeModel(input)
			expect(result).toBeUndefined()
		})
	})

	describe("#given valid model string", () => {
		test("#when normalizeModel is called with valid model string #then returns same string", () => {
			const input = "claude-3-opus"
			const result = normalizeModel(input)
			expect(result).toBe("claude-3-opus")
		})
	})

	describe("#given string with leading and trailing spaces", () => {
		test("#when normalizeModel is called with spaces #then returns trimmed string", () => {
			const input = "  claude-3-opus  "
			const result = normalizeModel(input)
			expect(result).toBe("claude-3-opus")
		})
	})

	describe("#given string with only spaces", () => {
		test("#when normalizeModel is called with only spaces #then returns undefined", () => {
			const input = "     "
			const result = normalizeModel(input)
			expect(result).toBeUndefined()
		})
	})
})

describe("normalizeModelID", () => {
	describe("#given model with dots in version numbers", () => {
		test("#when normalizeModelID is called with claude-3.5-sonnet #then returns claude-3-5-sonnet", () => {
			const input = "claude-3.5-sonnet"
			const result = normalizeModelID(input)
			expect(result).toBe("claude-3-5-sonnet")
		})
	})

	describe("#given model without dots", () => {
		test("#when normalizeModelID is called with claude-opus #then returns unchanged", () => {
			const input = "claude-opus"
			const result = normalizeModelID(input)
			expect(result).toBe("claude-opus")
		})
	})

	describe("#given model with multiple dot-numbers", () => {
		test("#when normalizeModelID is called with model.1.2 #then returns model-1-2", () => {
			const input = "model.1.2"
			const result = normalizeModelID(input)
			expect(result).toBe("model-1-2")
		})
	})
})

describe("normalizeModelFormat", () => {
  describe("string format input", () => {
    it("splits provider/model format correctly", () => {
      const result = normalizeModelFormat("opencode/glm-5-free")
      expect(result).toEqual({ providerID: "opencode", modelID: "glm-5-free" })
    })

    it("handles provider with multiple slashes", () => {
      const result = normalizeModelFormat("anthropic/claude-opus-4-6/max")
      expect(result).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-6/max" })
    })

    it("returns undefined for malformed string without separator", () => {
      const result = normalizeModelFormat("invalid")
      expect(result).toBeUndefined()
    })

    it("returns undefined for empty string", () => {
      const result = normalizeModelFormat("")
      expect(result).toBeUndefined()
    })
  })

  describe("object format input", () => {
    it("passthroughs object format unchanged", () => {
      const input = { providerID: "opencode", modelID: "glm-5-free" }
      const result = normalizeModelFormat(input)
      expect(result).toEqual(input)
    })
  })

  describe("edge cases", () => {
    it("returns undefined for null", () => {
      const result = normalizeModelFormat(null as unknown as Parameters<typeof normalizeModelFormat>[0])
      expect(result).toBeUndefined()
    })

    it("returns undefined for undefined", () => {
      const result = normalizeModelFormat(undefined as unknown as Parameters<typeof normalizeModelFormat>[0])
      expect(result).toBeUndefined()
    })
  })
})

describe("normalizeSDKResponse", () => {
  it("returns data array when response includes data", () => {
    const response = { data: [{ id: "1" }] }
    const result = normalizeSDKResponse(response, [] as Array<{ id: string }>)
    expect(result).toEqual([{ id: "1" }])
  })

  it("returns fallback array when data is missing", () => {
    const response = {}
    const fallback = [{ id: "fallback" }]
    const result = normalizeSDKResponse(response, fallback)
    expect(result).toEqual(fallback)
  })

  it("returns response array directly when SDK returns plain array", () => {
    const response = [{ id: "2" }]
    const result = normalizeSDKResponse(response, [] as Array<{ id: string }>)
    expect(result).toEqual([{ id: "2" }])
  })

  it("returns response when data missing and preferResponseOnMissingData is true", () => {
    const response = { value: "legacy" }
    const result = normalizeSDKResponse(response, { value: "fallback" }, { preferResponseOnMissingData: true })
    expect(result).toEqual({ value: "legacy" })
  })

  it("returns fallback for null response", () => {
    const response = null
    const result = normalizeSDKResponse(response, [] as string[])
    expect(result).toEqual([])
  })

  it("returns object fallback for direct data nullish pattern", () => {
    const response = { data: undefined as { connected: string[] } | undefined }
    const fallback = { connected: [] }
    const result = normalizeSDKResponse(response, fallback)
    expect(result).toEqual(fallback)
  })
})
