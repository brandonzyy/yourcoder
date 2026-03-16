import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import z from "zod"
import { Tool } from "./tool"
import { Truncate } from "./truncation"

const out = mock(() =>
  Promise.resolve({
    content: "trimmed",
    truncated: true,
    outputPath: "/tmp/out.txt",
  })
)
let spy: ReturnType<typeof spyOn> | undefined

function ctx() {
  return {
    sessionID: "ses_1",
    messageID: "msg_1",
    agent: "coder",
    abort: new AbortController().signal,
    messages: [],
    metadata: mock(() => {}),
    ask: mock(() => Promise.resolve()),
  } as never
}

afterEach(() => {
  out.mockClear()
  spy?.mockRestore()
  spy = undefined
})

describe("Tool.define", () => {
  it("validates args and truncates tool output", async () => {
    spy = spyOn(Truncate, "output").mockImplementation(out)

    const tool = Tool.define("echo", {
      description: "echo text",
      parameters: z.object({ text: z.string() }),
      async execute(args) {
        return {
          title: "ok",
          metadata: {},
          output: args.text,
        }
      },
    })

    const info = await tool.init({ agent: { name: "a" } as never })
    const res = await info.execute({ text: "hello" }, ctx())

    expect(res.output).toBe("trimmed")
    expect(res.metadata).toEqual({
      truncated: true,
      outputPath: "/tmp/out.txt",
    })
    expect(out).toHaveBeenCalledWith("hello", {}, { name: "a" })
  })

  it("uses the custom validation formatter when parsing fails", async () => {
    spy = spyOn(Truncate, "output").mockImplementation(out)

    const tool = Tool.define("echo", {
      description: "echo text",
      parameters: z.object({ text: z.string().min(2) }),
      formatValidationError() {
        return "bad args"
      },
      async execute(args) {
        return {
          title: "ok",
          metadata: {},
          output: args.text,
        }
      },
    })

    const info = await tool.init()

    await expect(info.execute({ text: "" }, ctx())).rejects.toThrow("bad args")
    expect(out).not.toHaveBeenCalled()
  })

  it("skips truncation when the tool already handled it", async () => {
    spy = spyOn(Truncate, "output").mockImplementation(out)

    const tool = Tool.define("echo", {
      description: "echo text",
      parameters: z.object({ text: z.string() }),
      async execute(args) {
        return {
          title: "ok",
          metadata: {
            truncated: false,
          },
          output: args.text,
        }
      },
    })

    const info = await tool.init()
    const res = await info.execute({ text: "hello" }, ctx())

    expect(res.output).toBe("hello")
    expect(res.metadata).toEqual({ truncated: false })
    expect(out).not.toHaveBeenCalled()
  })
})
