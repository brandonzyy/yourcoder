import { join } from "node:path";
import {YC_STORAGE} from "../../config/opencode-storage-paths"
export const INTERACTIVE_BASH_SESSION_STORAGE = join(
  YC_STORAGE,
  "interactive-bash-session",
);

export const YC_SESSION_PREFIX = "opencode-";

export function buildSessionReminderMessage(sessions: string[]): string {
  if (sessions.length === 0) return "";
  return `\n\n[System Reminder] Active opencode-* tmux sessions: ${sessions.join(", ")}`;
}
