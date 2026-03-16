import { join } from "node:path";
import {YC_STORAGE} from "../../../config/opencode-storage-paths"
export const RULES_INJECTOR_STORAGE = join(YC_STORAGE, "rules-injector");

export const PROJECT_MARKERS = [
  ".git",
  "pyproject.toml",
  "package.json",
  "Cargo.toml",
  "go.mod",
  ".venv",
];

export const PROJECT_RULE_SUBDIRS: [string, string][] = [
  [".github", "instructions"],
  [".cursor", "rules"],
  [".claude", "rules"],
  [".yac", "rules"],
];

export const PROJECT_RULE_FILES: string[] = [
  ".github/copilot-instructions.md",
];

export const GITHUB_INSTRUCTIONS_PATTERN = /\.instructions\.md$/;

export const USER_RULE_DIR = ".claude/rules";

export const RULE_EXTENSIONS = [".md", ".mdc"];
