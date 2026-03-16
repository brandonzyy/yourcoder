import { describe, expect, it } from "bun:test"
import { resolveModelForDelegateTask } from "./model-selection"

describe("resolveModelForDelegateTask", () => {
  it("prefers the explicit user model", () => {
    const res = resolveModelForDelegateTask({
      userModel: "openai/gpt-5.4",
      availableModels: new Set(["openai/gpt-5.4"]),
    })

    expect(res).toEqual({ model: "openai/gpt-5.4" })
  })

  it("uses the category default when available models are empty", () => {
    const res = resolveModelForDelegateTask({
      categoryDefaultModel: "anthropic/claude-sonnet-4-high",
      availableModels: new Set(),
    })

    expect(res).toEqual({ model: "anthropic/claude-sonnet-4-high" })
  })

  it("chooses the first matching fallback model and preserves variant", () => {
    const res = resolveModelForDelegateTask({
      availableModels: new Set(["openai/gpt-5.4"]),
      fallbackChain: [
        {
          model: "gpt-5.4",
          providers: ["openai"],
          variant: "high",
        },
      ],
    })

    expect(res).toEqual({ model: "openai/gpt-5.4", variant: "high" })
  })
})
