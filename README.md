# YourCoder

AI-powered development tool with multi-agent orchestration, built on a terminal-first architecture.

[简体中文](README.zh.md)

## Features

- **Multi-agent system** — Orchestrator agents delegate tasks to specialized sub-agents (exploration, coding, planning)
- **Terminal UI** — Full TUI built with SolidJS and [opentui](https://github.com/sst/opentui)
- **Provider-agnostic** — Works with Claude, OpenAI, Google, OpenRouter, or local models
- **Client/server architecture** — Headless server mode with API, drive it from TUI, web, or desktop
- **LSP integration** — Out-of-the-box language server support
- **Plugin system** — Extensible through `@yourcoder/plugin`

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

## Project Structure

```
packages/
  yourcoder/     Core engine — agents, tools, providers, hooks, TUI
  plugin/        Plugin SDK (@yourcoder/plugin)
  sdk/           Generated client SDK
  util/          Shared utilities
  script/        Build and release scripts
```

## Agents

YourCoder includes built-in agents you can switch between with `Tab`:

- **build** — Default full-access agent for development work
- **plan** — Read-only agent for analysis and code exploration

Use `@general` in messages to invoke the general sub-agent for complex searches.

## Configuration

YourCoder uses a JSON config file. See the `AGENTS.md` file for the style guide and coding conventions.

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

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, PR guidelines, and style conventions.

## License

[MIT](./LICENSE)
