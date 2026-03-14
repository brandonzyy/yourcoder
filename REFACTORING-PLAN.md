# 功能性重构计划

基于源码分析报告，按风险从低到高排序。每步完成后标记 ✅。

tsc 基线：源码 0 错误，测试文件 82 个 pre-existing 错误（待全面重写）。

---

## Phase 1: 单文件目录合并 — ⏸️ DEFERRED

122+ import 路径变更，收益低。等后续有需要时再做。

---

## Phase 2: 通知系统合并 — ✅ DONE

5 个平铺文件合并为 `hooks/session-notification/` 目录（notification.ts + index.ts）。

14 个单文件目录合并为 4 个逻辑分组。~3,000 行代码不变，只改 import 路径。

### 1A. 合入 `config/`
| 源 | 行数 | 说明 |
|---|---|---|
| `env/env.ts` | 28 | 环境变量 |
| `global/global.ts` | 54 | 全局状态 |
| `flag/flag.ts` | 116 | Feature flags |

### 1B. 合入 `util/`
| 源 | 行数 | 说明 |
|---|---|---|
| `id/id.ts` | 84 | ID 生成 |
| `bus/` | 158 | 事件总线 |
| `scheduler/scheduler.ts` | 61 | 调度器 |

### 1C. 合入 `terminal/`（新建）
| 源 | 行数 | 说明 |
|---|---|---|
| `shell/shell.ts` | 70 | Shell 检测 |
| `pty/pty.ts` | 317 | PTY 管理 |

### 1D. 合入 `project/`
| 源 | 行数 | 说明 |
|---|---|---|
| `auth/auth.ts` | 73 | 认证 |
| `ide/ide.ts` | 76 | IDE 检测 |
| `command/command.ts` | 150 | 命令定义 |
| `question/question.ts` | 171 | 问题工具 |
| `installation/installation.ts` | 261 | 安装管理 |

### 1E. 保持不动（有独立领域意义）
- `snapshot/` (297) — 快照系统
- `worktree/` (662) — Git worktree
- `patch/` (680) — Patch 应用

### 执行方式
每个分组：
1. 移动文件到目标目录
2. 批量替换所有 import 路径
3. 删除空目录
4. `tsc --noEmit` 验证

---

## Phase 2: 通知系统合并（低风险，内部模块）

5 个通知文件 → 2 个文件。当前 1,299 行（含测试）。

### 目标结构
```
hooks/session-notification/
  index.ts          — 主 hook（现 session-notification.ts）
  notification.ts   — 合并 sender + formatting + utils + scheduler
  types.ts
```

### 步骤
1. 创建 `hooks/session-notification/` 目录
2. 将 `session-notification.ts` 移入为 `index.ts`
3. 将 `session-notification-sender.ts` + `session-notification-formatting.ts` + `session-notification-utils.ts` + `session-notification-scheduler.ts` 合并为 `notification.ts`
4. 更新 barrel `hooks/index.ts`
5. 验证

---

## Phase 3: 模型解析管线合并 — ⏸️ DEFERRED

38 处直接 import 变更，文件都很小（8-30 行），职责分离清晰。合并收益有限，风险较高。

13 个源文件（1,243 行源码 + 3,310 行测试）→ 移入 `provider/model/`

### 当前文件和依赖链
```
model-resolver.ts (71) → model-resolution-pipeline.ts (216) → model-normalization.ts (8)
                                                             → model-availability.ts (294)
                                                             → provider-model-id-transform.ts (18)
model-error-classifier.ts (135)
model-requirements.ts (85)
model-format-normalizer.ts (20)
model-sanitizer.ts (12)
model-suggestion-retry.ts (192)
model-resolution-types.ts (30)
fallback-model-availability.ts (102)
session-model-state.ts (15)
```

### 目标结构
```
provider/model/
  resolver.ts       — 合并 model-resolver + model-resolution-pipeline + model-normalization
  availability.ts   — 合并 model-availability + fallback-model-availability
  requirements.ts   — model-requirements（不变）
  error.ts          — 合并 model-error-classifier + model-suggestion-retry
  types.ts          — 合并 model-resolution-types + model-format-normalizer + model-sanitizer
  transform.ts      — provider-model-id-transform（不变）
  state.ts          — session-model-state（不变）
```

13 文件 → 7 文件，从 shared/ 移入 provider/model/。

### 步骤
1. 创建 `provider/model/` 目录
2. 逐个合并文件
3. 在 `shared/` 创建 re-export shim（兼容期）
4. 批量替换 import 路径
5. 删除 shim
6. 移动测试文件
7. 验证

---

## Phase 4: 注入器模式统一（中风险，需创建抽象）

4 个注入器 hooks 共 2,907 行。`directory-agents-injector` 和 `directory-readme-injector` 结构完全相同（finder + injector + storage + hook + constants）。

### 目标
提取通用 `ContentInjector` 框架，各注入器只提供 finder 函数。

### 目标结构
```
hooks/content-injector/
  framework.ts      — 通用 ContentInjector 类（finder + storage + inject 逻辑）
  agents-injector.ts — finder 配置
  readme-injector.ts — finder 配置
  index.ts
hooks/compaction-context-injector/ — 保持不变（189 行，逻辑不同）
hooks/rules-injector/             — 保持不变（1,907 行，复杂度高，独立领域）
```

合并 `directory-agents-injector` (404) + `directory-readme-injector` (407) → `content-injector/` (~400)。
节省 ~400 行。

### 步骤
1. 分析两个 injector 的 finder/injector/storage 差异
2. 提取通用框架
3. 将两个 injector 改为配置式
4. 更新 barrel 和 hook creators
5. 删除旧目录
6. 验证

---

## Phase 5: 恢复/容错 hooks 合并（高风险，核心逻辑）

7 个 hooks 共 10,755 行。

### 分析
| Hook | 行数 | 触发时机 | 核心逻辑 |
|------|------|----------|----------|
| runtime-fallback | 3,515 | session.error | 运行时模型不可用 → 切换备选模型 |
| model-fallback | 515 | chat.message | 模型错误 → 按 fallback chain 切换 |
| anthropic-context-window-limit-recovery | 3,472 | session.error | 上下文溢出 → 压缩/切换模型 |
| session-recovery | 2,520 | session.error | 会话崩溃 → 恢复策略 |
| delegate-task-retry | 267 | tool.after | 子任务失败 → 重试 |
| json-error-recovery | 260 | tool.after | JSON 解析错误 → 提示修复 |
| edit-error-recovery | 206 | tool.after | 编辑工具错误 → 提示修复 |

### 合并方案

#### 5A. 模型降级合并：runtime-fallback + model-fallback → `model-fallback/`
两者都是"模型不可用时切换备选"，区别在于触发时机（session.error vs chat.message）。
合并后保留两个入口函数，共享 fallback chain 逻辑。
预计 3,515 + 515 → ~2,500 行。

#### 5B. 会话恢复合并：anthropic-context-window-limit-recovery + session-recovery → `session-recovery/`
两者都处理会话级错误恢复。context-window-limit 是 session-recovery 的特化场景。
合并后 session-recovery 作为主框架，context-window-limit 作为策略之一。
预计 3,472 + 2,520 → ~3,500 行。

#### 5C. 工具错误保持独立
delegate-task-retry (267)、json-error-recovery (260)、edit-error-recovery (206) 各自独立，逻辑简单，不值得合并。

### 步骤
1. 分析 runtime-fallback 和 model-fallback 的 fallback chain 实现差异
2. 提取共享 fallback engine
3. 合并为统一 model-fallback/
4. 分析 session-recovery 和 context-window-limit-recovery 的恢复策略差异
5. 合并为统一 session-recovery/
6. 更新 hook creators 和 barrel
7. 验证

---

## Phase 6: delegate-task 精简（高风险，核心工具）

31 个源文件，3,041 行源码（不含测试）。同时 `task/delegate.ts` (93 行) 是精简版。

### 分析
delegate-task 的核心流程：
1. 解析任务参数 → category-resolver, skill-resolver, subagent-resolver
2. 构建 prompt → prompt-builder
3. 选择模型 → model-selection, available-models
4. 执行任务 → sync-task (同步) / background-task (异步) / unstable-agent-task
5. 轮询结果 → sync-session-poller, sync-result-fetcher
6. 处理续接 → sync-continuation, background-continuation

### 合并方案
```
tool/delegate-task/
  index.ts
  tools.ts           — 主入口（保持）
  types.ts           — 类型（保持）
  constants.ts       — 常量（精简，654→~200）
  resolver.ts        — 合并 category-resolver + skill-resolver + subagent-resolver + sisyphus-junior-agent
  prompt.ts          — 合并 prompt-builder + model-selection + available-models
  executor.ts        — 合并 executor + executor-types
  sync.ts            — 合并 sync-task + sync-session-creator + sync-prompt-sender + sync-session-poller + sync-result-fetcher + sync-task-deps + sync-continuation-deps
  background.ts      — 合并 background-task + background-continuation
  unstable.ts        — unstable-agent-task（保持）
  util.ts            — 合并 time-formatter + timing + token-limiter + error-formatting + parent-context-resolver + metadata-await(删除)
```

31 文件 → 12 文件。删除 `task/delegate.ts`（已被 tool/delegate-task 完全替代）。

### 步骤
1. 分析各文件间的调用关系
2. 按上述分组逐步合并
3. 删除 task/delegate.ts
4. 验证

---

## 验证方法

每个 Phase 完成后：
1. `tsc --noEmit` — 不超过 82 个错误
2. `grep` 确认无残留引用
3. 测试文件同步更新

## 执行顺序

Phase 1 → 2 → 3 → 4 → 5 → 6

Phase 1-2 可以一天内完成（纯文件移动）。
Phase 3-4 需要仔细处理 import 路径。
Phase 5-6 需要理解业务逻辑，逐步合并。
