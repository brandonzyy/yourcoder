import { describe, expect, it, mock } from "bun:test"
import { PageSemanticAdapterTool } from "./page_semantic_adapter"

function ctx() {
  return {
    sessionID: "ses_test",
    messageID: "msg_test",
    agent: "test-agent",
    abort: new AbortController().signal,
    messages: [],
    metadata: mock(() => {}),
    ask: mock(() => Promise.resolve()),
  } as never
}

describe("page_semantic_adapter", () => {
  it("extracts clickable elements with stable action_id ordering", async () => {
    const tool = await PageSemanticAdapterTool.init()

    const html = `
      <html>
        <head><title>Semantic Test</title></head>
        <body>
          <a href="/docs/start" aria-label="Start Docs">Read Docs</a>
          <button id="save-btn">Save</button>
          <div role="button" tabindex="0" aria-label="Open Panel"></div>
        </body>
      </html>
    `

    const res = await tool.execute({ html }, ctx())
    const elements = (res.metadata as any).elements as Array<any>

    expect(elements.length).toBeGreaterThanOrEqual(3)

    const actionable = elements.filter((e) => e.action_id !== undefined)
    expect(actionable.length).toBeGreaterThanOrEqual(3)

    expect(actionable[0].action_id).toBe(1)
    expect(actionable[1].action_id).toBe(2)
    expect(actionable[2].action_id).toBe(3)

    expect(actionable[0].role).toBe("link")
    expect(actionable[1].role).toBe("button")
    expect(actionable[2].role).toBe("button")
  })

  it("preserves collapsible/menu/form/dialog semantics in group stats", async () => {
    const tool = await PageSemanticAdapterTool.init()

    const html = `
      <html>
        <body>
          <details>
            <summary>Advanced</summary>
            <button>Expand Action</button>
          </details>

          <nav>
            <a href="/a">A</a>
          </nav>

          <form>
            <input type="text" name="q" value="abc" />
            <button type="submit">Submit</button>
          </form>

          <dialog open>
            <button>Confirm</button>
          </dialog>
        </body>
      </html>
    `

    const res = await tool.execute({ html }, ctx())
    const stats = (res.metadata as any).stats

    expect(stats.collapsible).toBeGreaterThan(0)
    expect(stats.menu).toBeGreaterThan(0)
    expect(stats.form).toBeGreaterThan(0)
    expect(stats.dialog).toBeGreaterThan(0)
  })

  it("captures role/name/state/value for form controls", async () => {
    const tool = await PageSemanticAdapterTool.init()

    const html = `
      <html>
        <body>
          <form>
            <input type="checkbox" checked aria-label="Enable Feature" />
            <input type="text" name="query" placeholder="Search..." value="hello" required />
            <select aria-label="Sort">
              <option value="new" selected>Newest</option>
            </select>
          </form>
        </body>
      </html>
    `

    const res = await tool.execute({ html }, ctx())
    const elements = (res.metadata as any).elements as Array<any>

    const checkbox = elements.find((e) => e.role === "checkbox")
    expect(checkbox).toBeTruthy()
    expect(checkbox.name).toContain("Enable Feature")
    expect(checkbox.state.checked).toBe(true)

    const textbox = elements.find((e) => e.role === "textbox")
    expect(textbox).toBeTruthy()
    expect(textbox.value).toBe("hello")
    expect(textbox.state.required).toBe(true)

    const option = elements.find((e) => e.role === "option")
    expect(option).toBeTruthy()
    expect(option.state.selected).toBe(true)
  })

  it("excludes hidden elements by default and includes when requested", async () => {
    const tool = await PageSemanticAdapterTool.init()

    const html = `
      <html>
        <body>
          <button aria-label="Visible Action">Visible</button>
          <button aria-label="Hidden Action" hidden>Hidden</button>
          <a href="/x" style="display:none">Invisible Link</a>
        </body>
      </html>
    `

    const resDefault = await tool.execute({ html }, ctx())
    const namesDefault = ((resDefault.metadata as any).elements as Array<any>).map((e) => e.name)
    expect(namesDefault).toContain("Visible Action")
    expect(namesDefault).not.toContain("Hidden Action")

    const resWithHidden = await tool.execute({ html, include_hidden: true }, ctx())
    const namesWithHidden = ((resWithHidden.metadata as any).elements as Array<any>).map((e) => e.name)
    expect(namesWithHidden).toContain("Visible Action")
    expect(namesWithHidden).toContain("Hidden Action")
  })
})
