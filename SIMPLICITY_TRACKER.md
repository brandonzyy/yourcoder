# Opencode Simplicity Tracker

## Goal

Bring `packages/opencode` closer to `Simplicity is the ultimate sophistication` by shrinking default behavior, reducing hook sprawl, and keeping only the resilience paths that still protect core multi-agent orchestration.

## Findings

| ID | Area | Problem | Decision | Status |
| --- | --- | --- | --- | --- |
| S1 | Hook defaults | Native plugin enabled almost every built-in hook by default and relied on `disabled_hooks` as the only brake. This made patch hooks feel like core behavior. | Add an explicit hook policy. Keep core safety hooks on by default, move patch/UX hooks to explicit opt-in via `enabled_hooks`. | Done |
| S2 | Hook assembly | Session/tool/continuation/transform/skill hook builders repeated the same mount pattern dozens of times, adding branching noise. | Introduce one shared `mount()` helper and use it across hook builders. | Done |
| S3 | Session hook sprawl | `create-session-hooks.ts` had become the main complexity sink, mixing resilience, UX, notifications, and model-specific patches in one imperative block. | Keep the file as the assembly point, but collapse repeated hook wiring through the shared helper and classify optional hooks in policy instead of more inline conditionals. | Done |
| S4 | Patch-style UX hooks | `auto-update-checker`, `session-notification`, `agent-usage-reminder`, `start-work`, `task-resume-info`, `question-label-truncator`, `no-sisyphus-gpt`, `category-skill-reminder` behaved like additive nudges rather than core orchestration. | Disable by default and require explicit opt-in through `enabled_hooks`. | Done |
| S5 | Resilience sidecars | Recovery and fallback hooks looked patchy, but several still cover real provider/session failure modes that the orchestrator cannot ignore yet. | Keep `session-recovery`, `model-fallback`, `runtime-fallback`, `anthropic-context-window-limit-recovery`, `delegate-task-retry`, `edit-error-recovery`, `subagent-health-check`, `non-interactive-env` in the default path. Revisit only after telemetry proves they are redundant. | Done |
| S6 | Capability surface | Tool sources already converge cleanly through `capability/registry.ts`. | Keep as-is. This is simplification, not over-design. | Done |
| S7 | Background manager | Background task flow is large but matches essential orchestration concerns: queueing, concurrency, parent/child session tracking, polling, fallback, notification. | Keep current split. Refactor only when reducing behavior, not just moving code around. | Done |
| S8 | Session assembly | `create-session-hooks.ts` still read like one long capability ledger even after first-pass deduplication. | Rebuild it around three groups: `core`, `guard`, and `ux`, while preserving the same public shape. | Done |
| S9 | Core hook relay | `createCoreHooks` added one extra file and symbol but only forwarded to three builders and spread the results. | Inline the layer into `create-hooks.ts` and delete the relay file. | Done |
| S10 | Hook config symmetry | `enabled_hooks` was strict but `disabled_hooks` still accepted arbitrary strings, leaving the same concept with two validation models. | Use the same hook enum schema for both and verify partial parsing drops unknown leftovers. | Done |
| S11 | Hook legacy aliases | Hook config still kept a history-translation layer for removed or renamed hook names. | Remove hook alias migration entirely. Old hook names now fail validation instead of being silently rewritten. | Done |
| S12 | Agent and config legacy paths | Agent alias migration, old config file names, and old field aliases (`omo_agent`, `experimental.hashline_edit`) kept historical naming alive in runtime config loading. | Remove the alias migrations and old file-name fallback paths. Legacy agent keys and legacy config names are no longer accepted. | Done |
| S13 | Config auto-migration engine | Config loading still mutated parsed configs, wrote backup files, and silently upgraded model versions. | Remove config auto-migration entirely. Config loading now only parses, validates, and reports errors. | Done |
| S14 | Plugin test layout | Plugin tests were split between `src/plugin` and the package-level `test/` tree, which made the repo harder to scan and violated its own layout conventions. | Move plugin tests into `packages/opencode/test/plugin` and keep source tree focused on runtime code. | Done |

## Keep vs Remove

### Keep

- `session-recovery`: protects long-running sessions from losing continuity.
- `runtime-fallback` and `model-fallback`: still needed because provider failures are not solved at the model layer alone.
- `anthropic-context-window-limit-recovery`: still covers a real provider-specific failure mode.
- `delegate-task-retry`: protects parent/child agent orchestration from transient launch failure.
- `edit-error-recovery` and `json-error-recovery`: keep until tool outputs become structurally reliable.
- `non-interactive-env` and `subagent-health-check`: these are safety rails, not cosmetic patches.

### Disable By Default

- `auto-update-checker`
- `session-notification`
- `agent-usage-reminder`
- `start-work`
- `task-resume-info`
- `question-label-truncator`
- `no-sisyphus-gpt`
- `category-skill-reminder`

These are mostly reminders, nudges, or UX frosting. They increase the default concept count without being required for the orchestrator to function.

## Execution Order

1. Add explicit hook policy and `enabled_hooks`.
2. Disable non-core patch hooks by default while preserving opt-in.
3. Collapse hook mounting into one shared helper.
4. Keep resilience paths that still defend core orchestration.
5. Rebuild session hook assembly around grouped intent.
6. Validate targeted plugin and hook tests.
7. Remove no-value relay layers in hook assembly.

## Completion Note

This pass intentionally avoids deleting the resilience chain. The current evidence says those paths are compensating for real model/provider/runtime weaknesses, not just historical clutter. The simplification win comes from making them explicit and shrinking the default surface, not from removing guardrails blindly.
