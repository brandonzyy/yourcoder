# Test Recovery Plan

## Goal

Restore a trustworthy test workflow after the refactor, then repair failing suites in priority order until the active test surface is green.

## Status

- [done] Align test orchestration with the current workspace layout
- [done] Define stable test layers and package entrypoints
- [done] Repair high-risk test/type breakages in `packages/opencode`
- [done] Repair colocated `packages/opencode/src/**/*.test.ts` suites
- [done] Reassess remaining flaky or obsolete tests

## Phase 1: Orchestration

- Remove CI references to deleted packages
- Replace ambiguous workspace test entrypoints with explicit package commands
- Keep root `test` guarded, but expose explicit recovery commands

## Phase 2: Baseline

- Split commands into `test:unit`, `test:smoke`, and targeted domain runs
- Use `packages/opencode` as the primary repair target
- Track remaining domains after each repair batch

## Priority Domains

1. `config`, `session`, `tool`, `provider`, `project`, `server`
2. `file`, `permission`, `storage`, `control-plane`, `mcp`
3. `cli`, `agent`, `installation`, `ide`, `lsp`, `snapshot`

## Notes

- Bun is now installed locally and can be invoked via the user-level shim
- CI no longer points at deleted `packages/app`
- Verification now includes both TypeScript static checks and targeted Bun test runs

## Progress

- Added explicit root recovery commands: `test:unit`, `test:smoke`, `test:src`
- Replaced CI references to deleted `packages/app` with a package-local smoke stage
- Added turbo task entries for `test:unit` and `test:smoke`
- Fixed 23 stale `bun-types` references in colocated test files
- Fixed the first static type batch in background-agent, tmux-subagent, session notification, start-work, subagent-health-check, write-existing-file-guard, and shared HTTP API tests
- Static TypeScript baseline for `packages/opencode` is now clean
- Verified green targeted batches for:
  - `src/config/opencode-config-dir.test.ts`
  - `src/shared/agent-display-names.test.ts`
  - `src/shared/migration.test.ts`
  - `src/shared/agent-config-integration.test.ts`
  - `src/model/model-requirements.test.ts`
  - `src/features/tmux-subagent/action-executor.test.ts`
  - `src/hooks/no-sisyphus-gpt/index.test.ts`
  - `src/hooks/subagent-health-check/hook.test.ts`
  - `src/hooks/model-fallback/hook.test.ts`
  - `test/agent/agent.test.ts`
  - `src/tool/delegate-task/tools.test.ts`
  - `src/features/background-agent/manager.test.ts`
  - `src/features/tmux-subagent/shared/tmux-utils.test.ts`
  - `src/hooks/auto-update-checker/hook/background-update-check.test.ts`
  - `src/tool/delegate-task/category-resolver.test.ts`
  - `src/tool/delegate-task/sync-prompt-sender.test.ts`
- Updated agent/default-agent tests to match the current builtin registry:
  - `manon-explorer` replaces legacy `explore`
  - `sisyphus` is the default visible primary agent
  - hidden `plan` is no longer a valid default agent
- Updated delegate-task expectations to match current plan-family and model resolution behavior:
  - `prometheus` is no longer in `PLAN_FAMILY_NAMES`
  - `unspecified-high` normalizes to the resolved provider/model plus variant
  - missing subagent models no longer imply an injected fallback model
- Softened Windows-only `EBUSY` temp-dir cleanup in `packages/opencode/test/preload.ts` so teardown flakiness no longer marks passing test batches as failed
- Hardened `BackgroundManager.pollRunningTasks()` so mocks without `client.session.status()` no longer throw unhandled background errors between tests
- Fixed stale auto-update checker mocking so tests no longer fall through to the real `runBunInstall()` path
- Fixed Windows path handling in `rules-injector` scanning so `.github/instructions` filtering works correctly on `\`-separated paths
- Normalized multiple Windows-only test imports from `pathname` to `href` so dynamic module reload tests work under Bun on Windows
- Fixed stale `hook-message-injector` SQLite mock path and restored beta-backend coverage
- Hardened `write-existing-file-guard` `.sisyphus` detection for Windows paths
- Fixed `BashTool` external directory permission detection to use native path resolution instead of shelling out to `realpath`, restoring Windows coverage for `cd ../` and external file access
- Repaired cross-platform `comment-checker` CLI tests and semaphore coverage on Windows
- Repaired targeted Windows filesystem suites by making symlink/chmod assertions conditional on environment capability instead of assuming Unix semantics
- Fixed `src/shared/file-utils.test.ts` to tolerate Windows environments where symlink creation is unavailable instead of failing in `beforeAll`
- Fixed stale `tmux-subagent` test imports in `src/features/tmux-subagent/manager.test.ts` so full-suite execution no longer throws a module resolution error between tests
- Verified additional green targeted batches for:
  - `src/shared/skill-path-resolver.test.ts`
  - `src/hooks/todo-continuation-enforcer/todo-continuation-enforcer.test.ts`
  - `src/hooks/rules-injector/finder.test.ts`
  - `src/features/hook-message-injector/injector.test.ts`
  - `src/hooks/comment-checker/cli.test.ts`
  - `src/hooks/comment-checker/pending-calls.test.ts`
  - `src/hooks/write-existing-file-guard/index.test.ts`
  - `test/util/glob.test.ts`
  - `test/snapshot/snapshot.test.ts`
  - `test/tool/bash.test.ts`
  - `src/shared/file-utils.test.ts`
  - `src/features/tmux-subagent/manager.test.ts`
- Final package-wide verification is green:
  - `packages/opencode`: `3411 pass / 5 skip / 0 fail`
