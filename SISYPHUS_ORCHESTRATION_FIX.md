# Sisyphus 编排修复 + 前端乱码修复

## 修改概览

修复了两个独立问题：
1. **Sisyphus 不编排**：作为主编排器应该委派任务，但分析完后自己执行代码修改
2. **前端乱码**：`fn.ts` 的 `console.trace()` 污染 TUI 终端渲染

---

## Issue 1: Sisyphus 编排强制

### 根因
- Sisyphus capabilities 包含 `"edit"` tag，拥有 edit/write/apply_patch/hashline_edit 工具
- `buildParallelDelegationSection()` 的强制委派指令仅对非 Claude 模型生效（`if (!isNonClaude || !hasDelegationCategory) return ""`）
- `agent-usage-reminder` hook 仅监控 search/fetch 工具，不监控执行工具

### 修改

#### 1. `packages/opencode/src/oh-my-openagent/agents/sisyphus.ts`
移除 `"edit"` tag，在 `deny` 中添加执行工具：
```typescript
capabilities: {
  include: ["core", "search", "delegation", "skill", "lsp", "ast", "session", "meta", "mcp", "interactive", "media"],
  deny: ["call_omo_agent", "edit", "write", "apply_patch", "hashline_edit"],
}
```
两处修改（L477 GPT-5.4 分支 + L529 通用分支）

#### 2. `packages/opencode/src/oh-my-openagent/agents/dynamic-agent-prompt-builder.ts`
移除 `isNonClaude` 检查，让 Claude 模型也获得强制委派指令：
```typescript
export function buildParallelDelegationSection(model: string, categories: AvailableCategory[]): string {
  const hasDelegationCategory = categories.some(c => c.name === 'deep' || c.name === 'unspecified-high')
  if (!hasDelegationCategory) return ""
  // 移除了 isNonClaude 检查
```

#### 3. `packages/opencode/src/oh-my-openagent/hooks/agent-usage-reminder/constants.ts`
添加 `EXECUTION_TOOLS` 和专用提醒消息：
```typescript
export const EXECUTION_TOOLS = new Set([
  "edit",
  "write",
  "apply_patch",
  "hashline_edit",
  "bash",
]);

export const EXECUTION_REMINDER_MESSAGE = `
[Orchestrator Enforcement Reminder]

You called an execution tool (edit/write/bash) directly. As an orchestrator, you MUST delegate implementation to subagents.
...
`;
```

#### 4. `packages/opencode/src/oh-my-openagent/hooks/agent-usage-reminder/hook.ts`
扩展 hook 监控执行工具：
```typescript
import { TARGET_TOOLS, AGENT_TOOLS, REMINDER_MESSAGE, EXECUTION_TOOLS, EXECUTION_REMINDER_MESSAGE } from "./constants";

// 在 toolExecuteAfter 中：
if (!TARGET_TOOLS.has(toolLower) && !EXECUTION_TOOLS.has(toolLower)) {
  return;
}

const message = EXECUTION_TOOLS.has(toolLower) ? EXECUTION_REMINDER_MESSAGE : REMINDER_MESSAGE;
output.output += message;
```

#### 5. `packages/opencode/src/oh-my-openagent/agents/dynamic-agent-prompt-builder.test.ts`
更新测试用例，Claude 模型现在也返回委派指令：
```typescript
it("#given Claude model with deep category #when building #then returns delegation section", () => {
  const result = buildParallelDelegationSection("anthropic/claude-opus-4-6", [deepCategory])
  expect(result).toContain("DECOMPOSE AND DELEGATE")
  expect(result).toContain("NOT AN IMPLEMENTER")
})
```

---

## Issue 2: 前端乱码

### 根因
`packages/opencode/src/util/fn.ts:9` 的 `console.trace()` 从 Worker 线程直接写入 stderr，污染 TUI 终端渲染。

### 修改

#### `packages/opencode/src/util/fn.ts`
替换 `console.trace` 为结构化日志：
```typescript
import { z } from "zod"
import { Log } from "./log"

export function fn<T extends z.ZodType, Result>(schema: T, cb: (input: z.infer<T>) => Result) {
  const result = (input: z.infer<T>) => {
    let parsed
    try {
      parsed = schema.parse(input)
    } catch (e) {
      try {
        Log.Default.error("schema validation failure", {
          stack: new Error().stack,
        })
      } catch {
        // Log not initialized, silently skip trace
      }
      throw e
    }
    return cb(parsed)
  }
  result.force = (input: z.infer<T>) => cb(input)
  result.schema = schema
  return result
}
```

---

## 验证

### Issue 1 验证
1. 启动 opencode TUI，选择 Sisyphus agent
2. 要求实现多步骤任务（如"重构 X 模块"）
3. ✅ 确认 Sisyphus 使用 `task()` 委派而非直接 edit/write
4. ✅ 确认 Sisyphus 无法调用 edit/write 工具（工具列表中不可见）
5. ✅ 如果 Sisyphus 尝试调用执行工具，会收到 `EXECUTION_REMINDER_MESSAGE`

### Issue 2 验证
1. 触发 schema validation failure（发送不合规数据到 session API）
2. ✅ 确认 TUI 不再出现 raw stack trace 文本
3. ✅ 确认错误被记录到日志文件（`~/.opencode/logs/`）

### 测试
```bash
cd packages/opencode
bun test src/oh-my-openagent/agents/dynamic-agent-prompt-builder.test.ts
# ✅ 18 pass, 0 fail
```

---

## 影响范围

### 破坏性变更
- **Sisyphus 行为变更**：不再能直接修改代码，必须委派
- **其他编排器**（atlas, hephaestus, prometheus）也受 `agent-usage-reminder` hook 影响，会收到执行工具提醒

### 兼容性
- 子 agent（explore, librarian, oracle）不受影响（hook 仅针对 `ORCHESTRATOR_AGENTS`）
- 非编排器 agent 不受影响
- 用户自定义 agent 如果声明了 `"edit"` tag 仍可使用执行工具

---

## 设计决策

### 为什么不直接在 prompt 中禁止？
Prompt 指令可被模型忽略。Capabilities 是硬约束，从工具列表中移除工具，模型无法调用。

### 为什么保留 `bash` 工具？
Sisyphus 需要 `bash` 运行测试/验证（如 `bun test`），但不应该用 `bash` 写文件（如 `echo > file.txt`）。Hook 会提醒不当使用。

### 为什么分离 `EXECUTION_TOOLS` 和 `TARGET_TOOLS`？
两者需要不同的提醒消息：
- `TARGET_TOOLS`（search/fetch）→ "use explore/librarian agents"
- `EXECUTION_TOOLS`（edit/write）→ "delegate implementation to subagents"

### 为什么 `fn.ts` 用 try-catch 包裹 Log？
`fn.ts` 作为工具函数可能在 Log 未初始化时被调用（如 CLI 命令）。Fallback 确保不会因日志失败而崩溃。
