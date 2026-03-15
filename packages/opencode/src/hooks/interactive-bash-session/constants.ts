import { join } from "node:path";
import {OPENCODE_STORAGE} from "../../config/opencode-storage-paths"
export const INTERACTIVE_BASH_SESSION_STORAGE = join(
  OPENCODE_STORAGE,
  "interactive-bash-session",
);

export const OPENCODE_SESSION_PREFIX = "opencode-";

export function buildSessionReminderMessage(sessions: string[]): string {
  if (sessions.length === 0) return "";
  return `\n\n[System Reminder] Active opencode-* tmux sessions: ${sessions.join(", ")}`;
}
