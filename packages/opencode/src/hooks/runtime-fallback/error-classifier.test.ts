import { describe, expect, it } from "bun:test"
import {
  classifyErrorType,
  containsErrorContent,
  extractAutoRetrySignal,
  extractErrorName,
  extractStatusCode,
  getErrorMessage,
  isRetryableError,
} from "./error-classifier"

describe("runtime fallback error classifier", () => {
  it("extracts messages and status codes from nested error shapes", () => {
    const err = {
      status: 503,
      data: {
        error: {
          message: "Service unavailable",
          name: "UnknownError",
        },
      },
    }

    expect(getErrorMessage(err)).toBe("service unavailable")
    expect(extractStatusCode(err)).toBe(503)
    expect(extractErrorName(err)).toBe("UnknownError")
  })

  it("classifies missing API key and missing model errors", () => {
    expect(
      classifyErrorType({
        name: "LoadAPIError",
        message: "API key is missing from environment variable",
      }),
    ).toBe("missing_api_key")

    expect(
      classifyErrorType({
        name: "UnknownError",
        message: "Model not found",
      }),
    ).toBe("model_not_found")
  })

  it("detects auto retry signals and embedded error parts", () => {
    expect(
      extractAutoRetrySignal({
        status: "retrying in 10s",
        summary: "too many requests",
      }),
    ).toEqual({ signal: "retrying in 10s\ntoo many requests" })

    expect(
      containsErrorContent([
        { type: "text", text: "ok" },
        { type: "error", text: "boom" },
      ]),
    ).toEqual({ hasError: true, errorMessage: "boom" })
  })

  it("treats classified and retryable status errors as retryable", () => {
    expect(isRetryableError({ message: "429 Too Many Requests" }, [429])).toBe(true)
    expect(
      isRetryableError(
        { name: "LoadAPIError", message: "API key is missing from environment variable" },
        [429],
      ),
    ).toBe(true)
    expect(isRetryableError({ message: "fatal syntax error" }, [429])).toBe(false)
  })
})
