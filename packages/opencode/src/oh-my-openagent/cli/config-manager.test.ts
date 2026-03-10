import { describe, expect, test, mock, afterEach } from "bun:test"

import { getPluginNameWithVersion, fetchNpmDistTags, generateOmoConfig } from "./config-manager"
import type { InstallConfig } from "./types"

describe("getPluginNameWithVersion", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns @latest when current version matches latest tag", async () => {
    // #given npm dist-tags with latest=2.14.0
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 2.14.0
    const result = await getPluginNameWithVersion("2.14.0")

    // #then should use @latest tag
    expect(result).toBe("oh-my-opencode@latest")
  })

  test("returns @beta when current version matches beta tag", async () => {
    // #given npm dist-tags with beta=3.0.0-beta.3
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 3.0.0-beta.3
    const result = await getPluginNameWithVersion("3.0.0-beta.3")

    // #then should use @beta tag
    expect(result).toBe("oh-my-opencode@beta")
  })

  test("returns @next when current version matches next tag", async () => {
    // #given npm dist-tags with next=3.1.0-next.1
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3", next: "3.1.0-next.1" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 3.1.0-next.1
    const result = await getPluginNameWithVersion("3.1.0-next.1")

    // #then should use @next tag
    expect(result).toBe("oh-my-opencode@next")
  })

  test("returns prerelease channel tag when no dist-tag matches prerelease version", async () => {
    // #given npm dist-tags with beta=3.0.0-beta.3
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is old beta 3.0.0-beta.2
    const result = await getPluginNameWithVersion("3.0.0-beta.2")

    // #then should preserve prerelease channel
    expect(result).toBe("oh-my-opencode@beta")
  })

  test("returns prerelease channel tag when fetch fails", async () => {
    // #given network failure
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch

    // #when current version is 3.0.0-beta.3
    const result = await getPluginNameWithVersion("3.0.0-beta.3")

    // #then should preserve prerelease channel
    expect(result).toBe("oh-my-opencode@beta")
  })

  test("returns bare package name when npm returns non-ok response for stable version", async () => {
    // #given npm returns 404
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ) as unknown as typeof fetch

    // #when current version is 2.14.0
    const result = await getPluginNameWithVersion("2.14.0")

    // #then should fall back to bare package entry
    expect(result).toBe("oh-my-opencode")
  })

  test("prioritizes latest over other tags when version matches multiple", async () => {
    // #given version matches both latest and beta (during release promotion)
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ beta: "3.0.0", latest: "3.0.0", next: "3.1.0-alpha.1" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when current version matches both
    const result = await getPluginNameWithVersion("3.0.0")

    // #then should prioritize @latest
    expect(result).toBe("oh-my-opencode@latest")
  })
})

describe("fetchNpmDistTags", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test("returns dist-tags on success", async () => {
    // #given npm returns dist-tags
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ latest: "2.14.0", beta: "3.0.0-beta.3" }),
      } as Response)
    ) as unknown as typeof fetch

    // #when fetching dist-tags
    const result = await fetchNpmDistTags("oh-my-opencode")

    // #then should return the tags
    expect(result).toEqual({ latest: "2.14.0", beta: "3.0.0-beta.3" })
  })

  test("returns null on network failure", async () => {
    // #given network failure
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch

    // #when fetching dist-tags
    const result = await fetchNpmDistTags("oh-my-opencode")

    // #then should return null
    expect(result).toBeNull()
  })

  test("returns null on non-ok response", async () => {
    // #given npm returns 404
    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: false,
        status: 404,
      } as Response)
    ) as unknown as typeof fetch

    // #when fetching dist-tags
    const result = await fetchNpmDistTags("oh-my-opencode")

    // #then should return null
    expect(result).toBeNull()
  })
})

describe("generateOmoConfig - model fallback system", () => {
  test("resolves all agents via opencode provider when available", () => {
    // #given user has opencode zen
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: true,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then Sisyphus uses opencode/claude-opus-4-6 with max variant
    expect((result.agents as Record<string, { model: string; variant?: string }>).sisyphus.model).toBe("opencode/claude-opus-4-6")
    expect((result.agents as Record<string, { model: string; variant?: string }>).sisyphus.variant).toBe("max")
    // #then librarian uses opencode/claude-haiku-4-5
    expect((result.agents as Record<string, { model: string }>).librarian.model).toBe("opencode/claude-haiku-4-5")
    // #then manon-explorer uses opencode/claude-haiku-4-5
    expect((result.agents as Record<string, { model: string }>)["manon-explorer"].model).toBe("opencode/claude-haiku-4-5")
  })

  test("uses ultimate fallback when no providers configured", () => {
    // #given user has no providers
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then all agents get ultimate fallback
    expect(result.$schema).toBe("https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/dev/assets/oh-my-opencode.schema.json")
    expect((result.agents as Record<string, { model: string }>).sisyphus.model).toBe("opencode/glm-4.7-fp8")
    expect((result.agents as Record<string, { model: string }>).librarian.model).toBe("opencode/glm-4.7-fp8")
    expect((result.agents as Record<string, { model: string }>)["manon-explorer"].model).toBe("opencode/glm-4.7-fp8")
  })

  test("falls back to ultimate when only non-opencode providers available", () => {
    // #given user has Claude but not opencode zen
    const config: InstallConfig = {
      hasClaude: true,
      isMax20: true,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then librarian gets ultimate fallback (opencode provider not available)
    expect((result.agents as Record<string, { model: string }>).librarian.model).toBe("opencode/glm-4.7-fp8")
    // #then manon-explorer gets ultimate fallback
    expect((result.agents as Record<string, { model: string }>)["manon-explorer"].model).toBe("opencode/glm-4.7-fp8")
  })

  test("sisyphus not created when only non-opencode provider and no chain match", () => {
    // #given user has only copilot (not in opencode chain)
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: true,
      hasOpencodeZen: false,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then Sisyphus is not created (special sisyphus path has no else fallback)
    expect((result.agents as Record<string, { model: string }>).sisyphus).toBeUndefined()
    // #then librarian still gets ultimate fallback
    expect((result.agents as Record<string, { model: string }>).librarian.model).toBe("opencode/glm-4.7-fp8")
  })

  test("manon-explorer uses haiku via opencode provider", () => {
    // #given user has opencode zen
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: true,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then manon-explorer uses haiku (first in its chain)
    expect((result.agents as Record<string, { model: string }>)["manon-explorer"].model).toBe("opencode/claude-haiku-4-5")
  })

  test("only 3 agents generated (sisyphus, librarian, manon-explorer)", () => {
    // #given user has opencode zen
    const config: InstallConfig = {
      hasClaude: false,
      isMax20: false,
      hasOpenAI: false,
      hasGemini: false,
      hasCopilot: false,
      hasOpencodeZen: true,
      hasZaiCodingPlan: false,
      hasKimiForCoding: false,
    }

    // #when generating config
    const result = generateOmoConfig(config)

    // #then only 3 agents exist (no oracle, explore, hephaestus, etc.)
    const agentKeys = Object.keys(result.agents as Record<string, unknown>)
    expect(agentKeys).toEqual(expect.arrayContaining(["sisyphus", "librarian", "manon-explorer"]))
    expect(agentKeys).toHaveLength(3)
  })
})
