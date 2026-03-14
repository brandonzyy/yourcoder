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
- ✅ tsc 验证通过（84 → 84 错误，无变化）

## ✅ Phase B2: 删除死 hook 模块

- ✅ `hooks/atlas/`（3,147 行）— 不在 barrel，无消费者
- ✅ `hooks/prometheus-md-only/`（1,066 行）— 不在 barrel，无消费者
- ✅ `hooks/no-hephaestus-non-gpt/`（212 行）— 不在 barrel，无消费者
- ✅ `hooks/task-reminder/`（210 行）— 不在 barrel，无消费者
- ✅ `hooks/hashline-edit-diff-enhancer/`（106 行）— 不在 barrel，无消费者
- ✅ config schema 清理：hooks.ts 移除 3 个废弃名称，agent-overrides.ts 移除 atlas
- ✅ tsc 验证通过（84 → 82 错误，减少 2 个来自删除的测试文件）

---

## Phase C: config/ 精简

### C1. 删除 `config/config-manager/` 插件时代遗留（655 行）
消费者：`background-update-check.ts`（runBunInstall）、`native-plugin.ts`（initConfigContext）
- [ ] 评估 `initConfigContext` 是否仍需要
- [ ] 评估 `runBunInstall` 是否仍需要
- [ ] 将必要功能内联，删除目录

### C2. 精简 `config/plugin-schema/`（672 行）
所有 schema 文件都被 `oh-my-opencode-config.ts` barrel 导入。
- [ ] 确认哪些 schema 的配置项实际被运行时读取
- [ ] 删除未使用的 schema 文件
- [ ] 合并剩余为单文件

## Phase D: features/ 瘦身（有消费者，需谨慎）

### D1. `features/run-continuation-state/`（190 行，3 消费者）
- [ ] 内联到 `hooks/stop-continuation-guard/` 和 `hooks/todo-continuation-enforcer/`

### D2. `features/claude-code-*-loader/` 系列（1,532 行）
- [ ] `claude-code-command-loader`（192 行）→ 内联到 `builtin-commands`
- [ ] `claude-code-mcp-loader`（603 行）→ 内联到消费者
- [ ] `claude-code-plugin-loader`（737 行）→ 内联到 `plugin-command-discovery.ts`

### D3. `features/builtin-commands/`（1,558 行，1 消费者）
- [ ] 唯一消费者 `auto-slash-command/executor.ts`，评估精简

### D4. `features/builtin-skills/`（2,385 行，1 外部消费者）
- [ ] 精简为纯数据文件

### D5. `features/tmux-subagent/`（4,393 行，1 消费者）
- [ ] 唯一消费者 `plugin/create-managers.ts`，评估是否核心功能

## Phase E: plugin/ 原生化（最大重构，依赖 C-D 完成）

### E1. 分析 plugin/ 依赖图（4,199 行）
- [ ] 理解 native-plugin.ts 初始化流程
- [ ] 确定核心 handler vs 可删除 handler

### E2. 将核心 handler 移入 hooks/
- [ ] event.ts, chat-message.ts, tool-execute-before/after.ts, messages-transform.ts

### E3. 合并 hook creators
- [ ] 6 个 create-*-hooks.ts → 1 个 hook-registry.ts

### E4. 删除 plugin/ 目录

## Phase F: tool/ 精简

### F1. `tool/delegate-task/`（9,816 行）
两个版本并存：task/delegate.ts（简版，registry 用）和 tool/delegate-task/（全版，plugin 用）
- [ ] 评估能否统一为一个版本
- [ ] 精简全版到合理规模

### F2. `tool/hashline-edit/`（2,868 行）
- [ ] 确认是否有实际使用场景
- [ ] 如无使用，删除

### F3. `tool/look-at/`（1,697 行）
- [ ] 确认是否有实际使用场景
- [ ] 如无使用，删除

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
| **合计** | **~8,804** | |

tsc 错误：84 → 82（减少 2 个来自删除的测试文件，无新增）

## 验证方法

每个子步骤完成后：
1. `tsc --noEmit` — 无新增类型错误（当前基线：82 个 pre-existing 错误）
2. `grep` 确认无残留引用
