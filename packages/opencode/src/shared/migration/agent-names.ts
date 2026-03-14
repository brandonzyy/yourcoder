export const AGENT_NAME_MAP: Record<string, string> = {
  // Sisyphus variants → "sisyphus"
  omo: "sisyphus",
  OmO: "sisyphus",
  Sisyphus: "sisyphus",
  sisyphus: "sisyphus",

  // Sisyphus-Junior → "sisyphus-junior"
  "Sisyphus-Junior": "sisyphus-junior",
  "sisyphus-junior": "sisyphus-junior",

  // Librarian → "librarian"
  librarian: "librarian",

  // Manon-Explorer (replaces explore) → "manon-explorer"
  explore: "manon-explorer",
  "manon-explorer": "manon-explorer",

  // Already lowercase - passthrough
  build: "build",
}

export const BUILTIN_AGENT_NAMES = new Set([
  "sisyphus",
  "librarian",
  "manon-explorer",
  "build",
])

export function migrateAgentNames(
  agents: Record<string, unknown>
): { migrated: Record<string, unknown>; changed: boolean } {
  const migrated: Record<string, unknown> = {}
  let changed = false

  for (const [key, value] of Object.entries(agents)) {
    const newKey = AGENT_NAME_MAP[key.toLowerCase()] ?? AGENT_NAME_MAP[key] ?? key
    if (newKey !== key) {
      changed = true
    }
    migrated[newKey] = value
  }

  return { migrated, changed }
}
