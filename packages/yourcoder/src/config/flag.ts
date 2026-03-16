function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

function falsy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "false" || value === "0"
}

export namespace Flag {
  export const YC_AUTO_SHARE = truthy("YC_AUTO_SHARE")
  export const YC_GIT_BASH_PATH = process.env["YC_GIT_BASH_PATH"]
  export const YC_CONFIG = process.env["YC_CONFIG"]
  export declare const YC_TUI_CONFIG: string | undefined
  export declare const YC_CONFIG_DIR: string | undefined
  export const YC_CONFIG_CONTENT = process.env["YC_CONFIG_CONTENT"]
  export const YC_DISABLE_AUTOUPDATE = truthy("YC_DISABLE_AUTOUPDATE")
  export const YC_DISABLE_PRUNE = truthy("YC_DISABLE_PRUNE")
  export const YC_DISABLE_TERMINAL_TITLE = truthy("YC_DISABLE_TERMINAL_TITLE")
  export const YC_PERMISSION = process.env["YC_PERMISSION"]
  export const YC_DISABLE_DEFAULT_PLUGINS = truthy("YC_DISABLE_DEFAULT_PLUGINS")
  export const YC_DISABLE_LSP_DOWNLOAD = truthy("YC_DISABLE_LSP_DOWNLOAD")
  export const YC_ENABLE_EXPERIMENTAL_MODELS = truthy("YC_ENABLE_EXPERIMENTAL_MODELS")
  export const YC_DISABLE_AUTOCOMPACT = truthy("YC_DISABLE_AUTOCOMPACT")
  export const YC_DISABLE_MODELS_FETCH = truthy("YC_DISABLE_MODELS_FETCH")
  export const YC_DISABLE_CLAUDE_CODE = truthy("YC_DISABLE_CLAUDE_CODE")
  export const YC_DISABLE_CLAUDE_CODE_PROMPT =
    YC_DISABLE_CLAUDE_CODE || truthy("YC_DISABLE_CLAUDE_CODE_PROMPT")
  export const YC_DISABLE_CLAUDE_CODE_SKILLS =
    YC_DISABLE_CLAUDE_CODE || truthy("YC_DISABLE_CLAUDE_CODE_SKILLS")
  export const YC_DISABLE_EXTERNAL_SKILLS =
    YC_DISABLE_CLAUDE_CODE_SKILLS || truthy("YC_DISABLE_EXTERNAL_SKILLS")
  export declare const YC_DISABLE_PROJECT_CONFIG: boolean
  export const YC_FAKE_VCS = process.env["YC_FAKE_VCS"]
  export declare const YC_CLIENT: string
  export const YC_SERVER_PASSWORD = process.env["YC_SERVER_PASSWORD"]
  export const YC_SERVER_USERNAME = process.env["YC_SERVER_USERNAME"]
  export const YC_ENABLE_QUESTION_TOOL = truthy("YC_ENABLE_QUESTION_TOOL")

  // Experimental
  export const YC_EXPERIMENTAL = truthy("YC_EXPERIMENTAL")
  export const YC_EXPERIMENTAL_FILEWATCHER = truthy("YC_EXPERIMENTAL_FILEWATCHER")
  export const YC_EXPERIMENTAL_DISABLE_FILEWATCHER = truthy("YC_EXPERIMENTAL_DISABLE_FILEWATCHER")
  export const YC_EXPERIMENTAL_ICON_DISCOVERY =
    YC_EXPERIMENTAL || truthy("YC_EXPERIMENTAL_ICON_DISCOVERY")

  const copy = process.env["YC_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
  export const YC_EXPERIMENTAL_DISABLE_COPY_ON_SELECT =
    copy === undefined ? process.platform === "win32" : truthy("YC_EXPERIMENTAL_DISABLE_COPY_ON_SELECT")
  export const YC_ENABLE_EXA =
    truthy("YC_ENABLE_EXA") || YC_EXPERIMENTAL || truthy("YC_EXPERIMENTAL_EXA")
  export const YC_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS = number("YC_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS")
  export const YC_EXPERIMENTAL_OUTPUT_TOKEN_MAX = number("YC_EXPERIMENTAL_OUTPUT_TOKEN_MAX")
  export const YC_EXPERIMENTAL_OXFMT = YC_EXPERIMENTAL || truthy("YC_EXPERIMENTAL_OXFMT")
  export const YC_EXPERIMENTAL_LSP_TY = truthy("YC_EXPERIMENTAL_LSP_TY")
  export const YC_EXPERIMENTAL_LSP_TOOL = YC_EXPERIMENTAL || truthy("YC_EXPERIMENTAL_LSP_TOOL")
  export const YC_DISABLE_FILETIME_CHECK = truthy("YC_DISABLE_FILETIME_CHECK")
  export const YC_EXPERIMENTAL_PLAN_MODE = YC_EXPERIMENTAL || truthy("YC_EXPERIMENTAL_PLAN_MODE")
  export const YC_EXPERIMENTAL_MARKDOWN = !falsy("YC_EXPERIMENTAL_MARKDOWN")
  export const YC_MODELS_URL = process.env["YC_MODELS_URL"]
  export const YC_MODELS_PATH = process.env["YC_MODELS_PATH"]
  export const YC_DISABLE_CHANNEL_DB = truthy("YC_DISABLE_CHANNEL_DB")
  export const YC_SKIP_MIGRATIONS = truthy("YC_SKIP_MIGRATIONS")

  function number(key: string) {
    const value = process.env[key]
    if (!value) return undefined
    const parsed = Number(value)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

// Dynamic getter for YC_DISABLE_PROJECT_CONFIG
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "YC_DISABLE_PROJECT_CONFIG", {
  get() {
    return truthy("YC_DISABLE_PROJECT_CONFIG")
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for YC_TUI_CONFIG
// This must be evaluated at access time, not module load time,
// because tests and external tooling may set this env var at runtime
Object.defineProperty(Flag, "YC_TUI_CONFIG", {
  get() {
    return process.env["YC_TUI_CONFIG"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for YC_CONFIG_DIR
// This must be evaluated at access time, not module load time,
// because external tooling may set this env var at runtime
Object.defineProperty(Flag, "YC_CONFIG_DIR", {
  get() {
    return process.env["YC_CONFIG_DIR"]
  },
  enumerable: true,
  configurable: false,
})

// Dynamic getter for YC_CLIENT
// This must be evaluated at access time, not module load time,
// because some commands override the client at runtime
Object.defineProperty(Flag, "YC_CLIENT", {
  get() {
    return process.env["YC_CLIENT"] ?? "cli"
  },
  enumerable: true,
  configurable: false,
})
