# YourCoder

AI-powered multi-agent coding CLI, built on Bun with a terminal-first architecture.

[简体中文](README.zh.md)

## Features

- **Multi-agent orchestration** — Orchestrator delegates to specialized sub-agents (exploration, coding, search, planning) with background concurrency
- **Terminal UI** — Full TUI built with Ink, or headless server mode with REST API
- **Provider-agnostic** — Claude, OpenAI, Google Gemini, GitHub Copilot, OpenRouter, or local models
- **Autonomous loops** — Ralph Loop for iterative task execution with verification and auto-continuation
- **Self-healing** — Context window overflow recovery, model fallback chains, session error repair
- **Extensible** — Plugin system (`@yourcoder/plugin`), MCP servers, custom skills, Claude Code hooks compatibility

## Quick Start

```bash
# Install dependencies
bun install

# Run in development mode
bun dev

# Run against a specific directory
bun dev <directory>
```

Requires **Bun 1.3+**.

## Architecture

```
packages/
  yourcoder/     Core engine (see below)
  plugin/        Plugin SDK (@yourcoder/plugin)
  sdk/           Generated HTTP client SDK
  util/          Shared utilities
  script/        Build and release scripts
```

### Core Engine (`packages/yourcoder/src/`)

```
┌─ CLI ──────────────────── cli/           Terminal UI + 20 commands (run, serve, agent, mcp, pr, ...)
├─ Server ───────────────── server/        Embedded Bun HTTP server + REST API routes
├─ Session ──────────────── session/       Conversation lifecycle, prompt assembly, compaction
├─ Plugin ───────────────── plugin/        Plugin loading, hook/tool/manager registration
│
├─ Agent ────────────────── agent/         Agent definitions, background task manager
├─ Tool ─────────────────── tool/          25+ built-in tools (bash, edit, read, grep, delegate-task, ...)
├─ Skill ────────────────── skill/         Reusable prompt templates (git-master, playwright, ...)
├─ Provider ─────────────── provider/      LLM provider abstraction + GitHub Copilot adapter
│
├─ Continuation ─────────── continuation/  Ralph Loop (autonomous iteration) + TODO enforcer
├─ Error Recovery ───────── error-recovery/ Context window recovery, session repair, edit/JSON recovery
├─ Model Switching ──────── model-switching/ Runtime fallback, think-mode, model fallback chains
│
├─ Hooks ────────────────── hooks/         14 lightweight hook modules (context injection, guardrails,
│                                          keyword detection, notifications, update checker, ...)
│
├─ Config ───────────────── config/        Configuration management + plugin schema
├─ Storage ──────────────── storage/       SQLite persistence (Drizzle ORM)
├─ Capability ───────────── capability/    Permission system + tool access control
├─ MCP ──────────────────── mcp/           Model Context Protocol server integration
├─ LSP ──────────────────── lsp/           Language Server Protocol client
├─ ACP ──────────────────── acp/           Agent Communication Protocol
└─ Infra ────────────────── file/ project/ util/ control-plane/ model/
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Embedded HTTP server | TUI and headless mode share the same API layer |
| Plugin architecture | All features register through NativePlugin; external plugins use the same interface |
| Core engines as top-level modules | `continuation/`, `error-recovery/`, `model-switching/` are first-class modules, not hooks |
| SQLite persistence | Single-file database, ideal for local CLI deployment |
| Model fallback chains | Auto-detect availability, degrade gracefully across providers |

## Agents

YourCoder includes built-in agents, switch with `Tab`:

- **build** — Default full-access agent for development work
- **plan** — Read-only agent for analysis and code exploration

Use `@general` in messages to invoke the general sub-agent for complex searches.

## Configuration

YourCoder uses a YAML/JSON config file. See `AGENTS.md` for style guide and coding conventions.

## Development

```bash
# Start dev server
bun dev

# Type check
bun run typecheck

# Run tests (from package directory, not root)
cd packages/yourcoder && bun test

# Build standalone executable
./packages/yourcoder/script/build.ts --single
```

### Server Mode

```bash
# Start headless API server
bun dev serve

# Specify port
bun dev serve --port 8080
```

## Stats

| Metric | Value |
|--------|-------|
| Source files | 720 |
| Test files | 212 |
| Code lines | ~98K |
| Top-level modules | 23 |
| Built-in tools | 25+ |
| Built-in skills | 5 |
| CLI commands | 20 |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, PR guidelines, and style conventions.

## License

[MIT](./LICENSE)
