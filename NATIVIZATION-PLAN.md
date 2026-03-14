# Nativization 精简计划

基于源码分析报告，按影响面排序执行。每步完成后标记 ✅。

---

## ✅ Phase 0: 合并 background-agent 双重实现

- ✅ `registry.ts` import 改为 `features/background-agent`，构造函数适配
- ✅ `task/delegate.ts` import 改为 `features/background-agent`
- ✅ `task/index.ts` 移除 background re-exports
- ✅ `src/task/background/` 7 个文件已删除（704 行）
- ✅ `createSimpleDelegateTask` 死代码已删除
- ✅ tsc 验证通过

## ✅ Phase A: 删除零消费者死代码

- ✅ `features/claude-tasks/`（1,162 行）— 已删除
- ✅ `features/mcp-oauth/`（2,112 行）— 已删除
- ✅ tsc 验证通过

## ✅ Phase B: plugin-tools.ts stub 清理

- ✅ `native-plugin.ts`：改为直接 import `interactive-bash`
- ✅ `event.ts`：删除 lspManager 空 stub 调用
- ✅ `create-session-hooks.ts`：sessionExists 替换为 `false`
- ✅ `tool-registry.ts`：删除所有空 stub 调用，直接 import 实际工具
- ✅ `plugin-tools.ts` 已删除
- ✅ tsc 验证通过

## ✅ Phase B2: 删除死 hook 模块

- ✅ `hooks/atlas/`（3,147 行）— 不在 barrel，无消费者
- ✅ `hooks/prometheus-md-only/`（1,066 行）— 不在 barrel，无消费者
- ✅ `hooks/no-hephaestus-non-gpt/`（212 行）— 不在 barrel，无消费者
- ✅ `hooks/task-reminder/`（210 行）— 不在 barrel，无消费者
- ✅ `hooks/hashline-edit-diff-enhancer/`（106 行）— 不在 barrel，无消费者
- ✅ config schema 清理：hooks.ts 移除 3 个废弃名称，agent-overrides.ts 移除 atlas
- ✅ tsc 验证通过（84 → 82 错误，减少 2 个来自删除的测试文件）

## ✅ Phase C: config/ 精简

### ✅ C1. 删除 `config/config-manager/` 死文件（~530 行）
- ✅ 12 个死文件已删除，保留 `config-context.ts` 和 `bun-install.ts`
- ✅ `config-manager.ts` barrel 精简为只导出 2 个文件
- ✅ `config/model-fallback.ts` 已删除
- ✅ `config/types.ts` 已删除

### C2. 精简 `config/plugin-schema/`（672 行）— 跳过
所有 24 个导出类型有外部消费者，schema 文件是活跃代码。

## ✅ Phase D: features/ 瘦身

### ✅ D1. `features/run-continuation-state/`（190 行）
- ✅ 合并为 `hooks/shared/continuation-state.ts` 单文件
- ✅ 更新 2 个消费者 import 路径

### ✅ D2. `features/claude-code-command-loader/`（192 行）
- ✅ `types.ts` 移至 `builtin-commands/command-types.ts`
- ✅ `loader.ts`（144 行死代码）已删除
- ✅ 更新 12 个 import 路径

### D2b. `claude-code-mcp-loader`（603 行）、`claude-code-plugin-loader`（737 行）— 跳过
两者都有实际功能代码被消费者使用，不是纯类型/死代码。

### D3-D5. builtin-commands / builtin-skills / tmux-subagent — 跳过
全部有活跃消费者，是功能性代码，非死代码。

## ✅ Phase E: plugin/ 死代码清理

### ✅ E1. 删除死 plugin 文件
- ✅ `plugin/codex.ts`（626 行）— 0 消费者，已删除
- ✅ `plugin/copilot.ts`（328 行）— 0 消费者，已删除
- ✅ `test/plugin/codex.test.ts`（123 行）— 已删除
- ✅ `plugin/index.ts` 移除 CodexAuthPlugin/CopilotAuthPlugin import
- ✅ tsc 验证通过（82 错误，无变化）

### E2-E4. plugin/ 结构重构 — 延后
plugin/ 剩余文件（~2,600 行）全部有活跃消费者，是核心运行时代码。
结构重构（移动 handler 到 hooks/、合并 hook creators）属于代码组织优化，非死代码清理。

## Phase F: tool/ 精简 — 延后

### F1. `tool/delegate-task/`（9,816 行）
核心任务委派系统，1 个外部消费者（tool-registry.ts）。内部文件全部活跃。
需要功能性重构而非简单删除。

### F2. `tool/hashline-edit/`（2,868 行）
1 个消费者（tool-registry.ts），功能性工具。

### F3. `tool/look-at/`（1,697 行）
1 个消费者（tool-registry.ts），功能性工具。

---

## 已删除统计

| 模块 | 行数 | 状态 |
|------|------|------|
| `task/background/` | 704 | ✅ |
| `task/delegate.ts` createSimpleDelegateTask | ~30 | ✅ |
| `features/claude-tasks/` | 1,162 | ✅ |
| `features/mcp-oauth/` | 2,112 | ✅ |
| `tool/plugin-tools.ts` + stub 调用清理 | ~50 | ✅ |
| `hooks/atlas/` | 3,147 | ✅ |
| `hooks/prometheus-md-only/` | 1,066 | ✅ |
| `hooks/no-hephaestus-non-gpt/` | 212 | ✅ |
| `hooks/task-reminder/` | 210 | ✅ |
| `hooks/hashline-edit-diff-enhancer/` | 106 | ✅ |
| config schema 废弃条目 | ~5 | ✅ |
| `config/config-manager/` 死文件 | ~530 | ✅ |
| `config/model-fallback.ts` + `types.ts` | ~80 | ✅ |
| `features/run-continuation-state/` | 190 | ✅ |
| `features/claude-code-command-loader/` | 192 | ✅ |
| `plugin/codex.ts` | 626 | ✅ |
| `plugin/copilot.ts` | 328 | ✅ |
| `test/plugin/codex.test.ts` | 123 | ✅ |
| **合计** | **~10,873** | |

tsc 错误：始终保持 82 个 pre-existing 错误，无新增

## 结论

死代码清理已完成。剩余模块（features/、plugin/、tool/）全部有活跃消费者，属于功能性代码。
进一步优化需要功能性重构（代码组织、模块合并），而非简单删除。
