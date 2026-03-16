import { MessageV2 } from "../message-v2"
import { Provider } from "../../provider/provider"

export async function lastModel(sessionID: string) {
  for await (const item of MessageV2.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
  return Provider.defaultModel()
}
