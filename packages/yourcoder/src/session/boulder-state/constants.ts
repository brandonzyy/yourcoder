/**
 * Plan state constants.
 *
 * The file name remains `boulder.json` to avoid breaking existing workspaces,
 * but the runtime API no longer uses the historical "boulder" label.
 */

export const STATE_DIR = ".yac"
export const STATE_FILE = "boulder.json"
export const STATE_PATH = `${STATE_DIR}/${STATE_FILE}`

export const NOTE_DIR = "notepads"
export const NOTE_PATH = `${STATE_DIR}/${NOTE_DIR}`

export const PLAN_DIR = ".yac/plans"
