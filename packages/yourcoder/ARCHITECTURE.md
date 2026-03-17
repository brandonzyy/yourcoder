# YourCoder 架构与功能模块说明书

> 版本 1.3.0 | 2026-03-17

## 1. 项目定位

YourCoder 是一个 **AI 多智能体编程 CLI**，提供终端内的交互式 AI 对话体验，支持代码理解、编辑、搜索、任务委派、自主循环执行等能力。基于 TypeScript/Bun 运行时构建，采用插件化架构，支持多模型（Anthropic Claude、OpenAI GPT、Google Gemini、GitHub Copilot）接入。

## 2. Monorepo 结构

```
packages/
├── yourcoder/     # 主应用（本文档的重点）
├── plugin/        # @yourcoder/plugin — 插件 SDK 类型定义
├── sdk/           # @yourcoder/sdk — HTTP 客户端（由 OpenAPI 生成）
├── util/          # @yourcoder/util — 共享工具函数
└── script/        # @yourcoder/script — 构建/发布脚本
```

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                         CLI 层                               │
│   index.ts → yargs 命令路由                                   │
│   cli/cmd/ (run, serve, agent, mcp, github, pr, ...)         │
│   cli/cmd/tui/ (TUI 终端界面)                                 │
├─────────────────────────────────────────────────────────────┤
│                        Server 层                             │
│   server/ — Bun HTTP 服务（内嵌，非独立进程）                     │
│   server/routes/ — RESTful API 路由                           │
│   control-plane/ — 多工作区协调                                │
├─────────────────────────────────────────────────────────────┤
│                       Session 层                             │
│   session/ — 对话生命周期管理                                   │
│   session/prompt/ — System Prompt 构建                       │
│   session/message-v2/ — 消息模型                              │
├─────────────────────────────────────────────────────────────┤
│                    Plugin + Hooks 层                          │
│   plugin/ — 插件加载 / 注册 / 生命周期                          │
│   hooks/ — 14 个轻量钩子模块（横切关注点）                        │
├─────────────────────────────────────────────────────────────┤
│                     核心引擎层                                 │
│   continuation/ — 自主循环系统（Ralph Loop + TODO 续写）         │
│   error-recovery/ — 错误恢复引擎（上下文窗口 + 会话 + 编辑）      │
│   model-switching/ — 模型调度引擎（降级 + 思考模式 + 重试）       │
├─────────────────────────────────────────────────────────────┤
│                       Agent 层                               │
│   agent/ — Agent 定义 / 调度 / 后台任务                        │
│   agent/builtin/ — 内置 Agent 目录                            │
│   agent/background/ — 后台并发任务管理器                        │
├─────────────────────────────────────────────────────────────┤
│                       Tool 层                                │
│   tool/ — 25+ 内置工具（bash, edit, read, grep, ...）          │
│   tool/delegate-task/ — 子任务委派                             │
│   tool/interactive-bash/ — 交互式终端（tmux 集成）              │
├─────────────────────────────────────────────────────────────┤
│                      Skill 层                                │
│   skill/ — 技能发现 / 加载 / 合并                              │
│   skill/builtin/ — 内置技能（git-master, playwright, ...）     │
├─────────────────────────────────────────────────────────────┤
│                    Provider 层                                │
│   provider/ — 模型提供商抽象                                   │
│   provider/sdk/copilot/ — GitHub Copilot 适配器               │
│   model/ — 模型能力解析 / 可用性检测 / 降级                      │
├─────────────────────────────────────────────────────────────┤
│                    基础设施层                                  │
│   config/     — 配置管理（plugin-schema, flag, env）           │
│   storage/    — SQLite 持久化（Drizzle ORM）                   │
│   capability/ — 权限系统                                      │
│   mcp/        — MCP 服务器加载                                 │
│   lsp/        — LSP 客户端集成                                 │
│   acp/        — Agent Communication Protocol                 │
│   util/       — 日志 / 文件系统 / 总线 / ID 生成                │
│   file/       — 文件忽略规则 / 目录遍历                         │
│   project/    — 项目检测 / 实例管理                             │
└─────────────────────────────────────────────────────────────┘
```

## 4. 核心模块详解

### 4.1 CLI (`cli/`, 63 files, 9.7K lines)

入口点 `index.ts` 使用 yargs 注册所有命令。

| 命令 | 文件 | 功能 |
|------|------|------|
| `run` | cmd/run.ts | **主命令** — 启动 TUI 交互界面 |
| `serve` | cmd/serve.ts | 启动 HTTP 服务（headless 模式） |
| `agent` | cmd/agent.ts | Agent 管理 |
| `mcp` | cmd/mcp.ts | MCP 服务器配置管理 |
| `github` | cmd/github.ts | GitHub 集成（issue/PR 操作） |
| `pr` | cmd/pr.ts | PR 创建与审查 |
| `auth` | cmd/auth.ts | 认证管理 |
| `models` | cmd/models.ts | 查看可用模型 |
| `generate` | cmd/generate.ts | 非交互式生成 |

**TUI 子系统** (`cli/cmd/tui/`): 基于 Ink 的终端 UI，支持 attach（连接已有会话）、thread（多线程视图）、worker（后台工作进程）。

### 4.2 Server (`server/`, 18 files, 3.9K lines)

内嵌的 Bun HTTP 服务器，TUI 和外部客户端通过 REST API 与核心通信。

| 路由 | 功能 |
|------|------|
| session.ts | 会话 CRUD、消息发送、摘要、恢复 |
| provider.ts | 模型提供商管理 |
| config.ts | 配置读写 |
| permission.ts | 权限请求/授予 |
| file.ts | 文件操作 |
| mcp.ts | MCP 服务器状态 |
| tui.ts | TUI 状态同步（toast 通知等） |
| pty.ts | 伪终端管理 |
| workspace.ts | 工作区管理 |

### 4.3 Session (`session/`, 45 files, 7K lines)

会话是 YourCoder 的核心数据模型，管理用户与 AI 的完整对话生命周期。

| 子模块 | 功能 |
|--------|------|
| `index.ts` | 会话 CRUD、消息管理、摘要生成、分享 |
| `prompt/` | System Prompt 组装管线 |
| `message-v2/` | 消息数据模型（v2 格式） |
| `llm.ts` | LLM 调用封装（streaming） |
| `processor.ts` | 消息处理流水线 |
| `compaction.ts` | 上下文压缩（summarize） |
| `state/` | 运行时状态（subagent sessions、main session） |

### 4.4 Plugin (`plugin/`, 50 files, 4.2K lines)

插件系统是 YourCoder 的核心扩展机制。`NativePlugin` 是最重要的内置插件，负责注册所有 hooks、tools 和 managers。

| 子模块 | 功能 |
|--------|------|
| `native-plugin.ts` | **核心内置插件** — 组装所有功能模块 |
| `create-hooks.ts` | Hook 工厂注册中心 |
| `create-tools.ts` | Tool 工厂注册中心 |
| `plugin-config.ts` | 插件配置加载（YAML → zod 校验） |
| `handlers/` | **请求处理管线** — 消息转换、工具执行、事件分发 |

### 4.5 Continuation (`continuation/`, 30 files, 2.5K lines)

自主循环执行引擎，管理 AI 的持续迭代工作流。

| 子模块 | 功能 |
|--------|------|
| `ralph-loop/` | **Ralph Loop** — 自主迭代任务执行（14 files）：完成检测、验证失败处理、session 重置、prompt 注入 |
| `todo-enforcer/` | **TODO 续写器** — 检测未完成任务，自动注入续写 prompt（12 files）：idle 事件处理、倒计时、问题检测 |
| `stop-guard.ts` | 续写终止条件检测 |
| `background-notification.ts` | 后台任务完成通知 |
| `task-resume-info.ts` | 任务恢复信息注入 |
| `session-todo-status.ts` | 会话 TODO 状态查询 |

### 4.6 Error Recovery (`error-recovery/`, 24 files, 4.1K lines)

多策略错误恢复引擎，保障长会话的稳定性。

| 子模块 | 功能 |
|--------|------|
| `context-window/` | **上下文窗口溢出恢复**（13 files）：激进截断、摘要重试、去重裁剪、空消息修复 |
| `session/` | **会话级错误恢复**（9 files）：空消息修复、thinking 块修复、工具结果修复、不可用工具恢复 |
| `edit.ts` | 编辑工具错误恢复 |
| `json.ts` | JSON 解析错误恢复 |

**上下文窗口恢复策略**：
1. **激进截断** — 按大小排序截断工具输出
2. **摘要重试** — 压缩历史消息后重试
3. **去重恢复** — 检测重复工具调用并裁剪
4. **空内容修复** — 注入占位文本修复空消息

### 4.7 Model Switching (`model-switching/`, 15 files, 1.9K lines)

模型调度与降级引擎。

| 子模块 | 功能 |
|--------|------|
| `runtime-fallback/` | **运行时降级子系统**（11 files）：错误分类、自动重试、fallback 状态机、消息更新处理 |
| `think-mode.ts` | 检测"深度思考"意图，自动切换到高级模型变体 |
| `model-fallback.ts` | 模型不可用时自动降级到备选提供商 |
| `thinking-block-validator.ts` | thinking block 格式合规性验证 |
| `anthropic-effort.ts` | Anthropic reasoning effort 参数调整 |

### 4.8 Hooks (`hooks/`, 117 files, 13.3K lines)

轻量级钩子模块，覆盖对话生命周期的横切关注点。通过 `hooks/index.ts` 统一导出。

| Hook | 功能 |
|------|------|
| `context-injection/` | 上下文注入框架（AGENTS.md、规则文件、消息注入） |
| `agent-guardrails/` | Agent 守卫（输出截断、健康检查、使用量提醒、不稳定 Agent 监控） |
| `claude-code-hooks/` | Claude Code hooks 兼容层（`.claude/settings.json`） |
| `keyword-detector/` | 关键词检测（ultrawork 模式切换、search/analyze 模式） |
| `interactive-bash-session/` | 交互式 Bash 会话管理 |
| `auto-update-checker/` | 自动更新检查 + 启动任务 |
| `comment-checker/` | 代码注释质量检查 |
| `auto-slash-command/` | 自动斜杠命令检测与执行 |
| `session-notification/` | 桌面通知（macOS/Windows/Linux） |
| `read-image-resizer/` | 图片读取自动缩放 |
| `start-work/` | 工作启动流程（worktree 检测） |
| `non-interactive-env/` | 非交互环境适配 |
| `category-skill-reminder/` | Agent 类别技能提醒 |
| 单文件 hooks | 上下文窗口监控、预防性压缩、文件覆写保护、委派任务重试、hashline 读取增强 |

### 4.9 Agent (`agent/`, 41 files, 6.7K lines)

| 子模块 | 功能 |
|--------|------|
| `agent.ts` | Agent 命名空间 — 定义、配置 schema、System Prompt 构建 |
| `builtin/` | 内置 Agent（codereye 审查、coderhand 编写、codersearch 搜索、yc 元 Agent） |
| `background/` | **后台任务管理器** — 并发控制、轮询、错误分类、降级重试、优雅关闭 |

### 4.10 Tool (`tool/`, 104 files, 13K lines)

工具是 AI 与外部世界交互的接口。

| 分类 | 工具 |
|------|------|
| 文件操作 | `read` `write` `edit` `multiedit` `glob` `grep` `ls` `apply_patch` |
| 执行 | `bash` `interactive-bash/`（tmux 集成） |
| 高级 | `delegate-task/`（子任务委派）`hashline-edit/`（行哈希编辑）`look-at/`（截图分析） |
| 搜索 | `codesearch` `webfetch` `websearch` `lsp` |
| 管理 | `plan` `task` `todo` `question` `skill` `batch` |

### 4.11 Skill (`skill/`, 27 files, 3.9K lines)

可复用的提示词模板，支持多源发现、加载、合并。

内置技能：`git-master`（Git 操作）、`playwright`（浏览器自动化）、`frontend-ui-ux`（前端开发）、`dev-browser`（调试）。

### 4.12 Provider (`provider/`, 34 files, 7.3K lines)

模型提供商抽象层。核心：`provider.ts`（提供商 CRUD）、`transform.ts`（请求/响应转换）、`sdk/copilot/`（GitHub Copilot 适配器）。

**Model 子系统** (`model/`, 7 files)：模型 ID 标准化、别名解析、可用性检测、降级链、错误分类。

### 4.13 基础设施

| 模块 | 文件/行数 | 功能 |
|------|-----------|------|
| `config/` | 24f / 3.3K | 配置管理、plugin-schema（zod）、feature flags |
| `storage/` | 7f / 920 | SQLite + Drizzle ORM 持久化 |
| `capability/` | 7f / 1K | 权限系统、工具标签 |
| `mcp/` | 9f / 1.8K | MCP 服务器集成、OAuth |
| `lsp/` | 11f / 3.1K | LSP 客户端 |
| `acp/` | 10f / 1.8K | Agent Communication Protocol |
| `project/` | 9f / 2K | 项目检测、实例管理 |
| `file/` | 7f / 1.8K | .gitignore 解析、文件过滤 |
| `util/` | 49f / 2.5K | 日志、事件总线、ID 生成 |
| `control-plane/` | 10f / 488 | 多工作区协调 |

## 5. 数据流

### 用户消息处理流程

```
用户输入
  → CLI/TUI 捕获
  → HTTP POST /session/:id/prompt
  → Server 路由
  → Session.prompt()
  → Plugin handlers 管线:
      1. system-transform (System Prompt 注入)
      2. messages-transform (消息格式转换)
      3. chat-message (发送到 LLM)
      4. tool-execute-before → [工具执行] → tool-execute-after
      5. event (事件广播 → continuation, error-recovery, model-switching)
  → 流式响应返回 TUI
```

## 6. 量化概览

| 指标 | 数值 |
|------|------|
| 总源文件 | 720 |
| 测试文件 | 212 |
| 总代码行 | ~98K |
| 顶层模块 | 23 |
| Hook 模块 | 14 |
| 内置工具 | 25+ |
| 内置技能 | 5 |
| 内置 Agent | 4 |
| CLI 命令 | 20 |
| Server 路由 | 13 |
