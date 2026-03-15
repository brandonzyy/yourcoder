import type { PluginInput } from "../../plugin/sdk"

export type Client = PluginInput["client"] & {
  session: {
    promptAsync: (opts: {
      path: { id: string }
      body: { parts: Array<{ type: string; text: string }> }
      query: { directory: string }
    }) => Promise<unknown>
  }
  tui: {
    showToast: (opts: {
      body: {
        title: string
        message: string
        variant: string
        duration: number
      }
    }) => Promise<unknown>
  }
}
