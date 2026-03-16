// Stub for deleted plugin-handlers/config-handler
// The original was deleted in a previous commit; this provides a no-op replacement.
export function createConfigHandler(_args: {
  ctx: { directory: string; client: unknown }
  pluginConfig: unknown
  modelCacheState: unknown
}) {
  return async (_config: unknown) => {}
}
