# YourCoder

AI 驱动的多智能体编程 CLI，基于 Bun 构建，终端优先架构。

[English](README.md)

## 特性

- **多智能体协作** — 编排器将任务委派给专业子智能体（探索、编码、搜索、规划），支持后台并发
- **终端 UI** — 基于 Ink 的完整 TUI，或无头服务器模式 + REST API
- **供应商无关** — Claude、OpenAI、Google Gemini、GitHub Copilot、OpenRouter 或本地模型
- **自主循环** — Ralph Loop 自主迭代任务执行，支持验证和自动续写
- **自愈能力** — 上下文窗口溢出恢复、模型降级链、会话错误修复
- **可扩展** — 插件系统 (`@yourcoder/plugin`)、MCP 服务器、自定义技能、Claude Code hooks 兼容

## 快速开始

```bash
# 安装依赖
bun install

# 开发模式运行
bun dev

# 指定目录运行
bun dev <directory>
```

需要 **Bun 1.3+**。

## 架构

```
packages/
  yourcoder/     核心引擎（见下方）
  plugin/        插件 SDK (@yourcoder/plugin)
  sdk/           生成的 HTTP 客户端 SDK
  util/          共享工具库
  script/        构建和发布脚本
```

### 核心引擎 (`packages/yourcoder/src/`)

```
┌─ CLI ──────────────────── cli/           终端 UI + 20 个命令 (run, serve, agent, mcp, pr, ...)
├─ Server ───────────────── server/        内嵌 Bun HTTP 服务器 + REST API 路由
├─ Session ──────────────── session/       对话生命周期、Prompt 组装、上下文压缩
├─ Plugin ───────────────── plugin/        插件加载、Hook/Tool/Manager 注册
│
├─ Agent ────────────────── agent/         Agent 定义、后台任务管理器
├─ Tool ─────────────────── tool/          25+ 内置工具 (bash, edit, read, grep, delegate-task, ...)
├─ Skill ────────────────── skill/         可复用提示词模板 (git-master, playwright, ...)
├─ Provider ─────────────── provider/      LLM 提供商抽象 + GitHub Copilot 适配器
│
├─ Continuation ─────────── continuation/  Ralph Loop（自主迭代）+ TODO 续写
├─ Error Recovery ───────── error-recovery/ 上下文窗口恢复、会话修复、编辑/JSON 错误恢复
├─ Model Switching ──────── model-switching/ 运行时降级、思考模式、模型切换链
│
├─ Hooks ────────────────── hooks/         14 个轻量 Hook 模块（上下文注入、守卫、
│                                          关键词检测、通知、更新检查等）
│
├─ Config ───────────────── config/        配置管理 + 插件 Schema
├─ Storage ──────────────── storage/       SQLite 持久化 (Drizzle ORM)
├─ Capability ───────────── capability/    权限系统 + 工具访问控制
├─ MCP ──────────────────── mcp/           Model Context Protocol 服务器集成
├─ LSP ──────────────────── lsp/           Language Server Protocol 客户端
├─ ACP ──────────────────── acp/           Agent Communication Protocol
└─ 基础设施 ─────────────── file/ project/ util/ control-plane/ model/
```

### 关键设计决策

| 决策 | 理由 |
|------|------|
| 内嵌 HTTP 服务器 | TUI 和无头模式共享同一 API 层 |
| 插件架构 | 所有功能通过 NativePlugin 注册；外部插件使用相同接口 |
| 核心引擎独立为顶层模块 | `continuation/`、`error-recovery/`、`model-switching/` 是一等模块，不是 hooks |
| SQLite 持久化 | 单文件数据库，适合本地 CLI 部署 |
| 模型降级链 | 自动检测可用性，跨提供商优雅降级 |

## 智能体

YourCoder 内置多个智能体，使用 `Tab` 键切换：

- **build** — 默认全功能智能体，用于开发工作
- **plan** — 只读智能体，用于分析和代码探索

在消息中使用 `@general` 可调用通用子智能体执行复杂搜索。

## 开发

```bash
# 启动开发服务器
bun dev

# 类型检查
bun run typecheck

# 运行测试（从包目录运行，不要在根目录）
cd packages/yourcoder && bun test

# 构建独立可执行文件
./packages/yourcoder/script/build.ts --single
```

### 服务器模式

```bash
# 启动无头 API 服务器
bun dev serve

# 指定端口
bun dev serve --port 8080
```

## 数据概览

| 指标 | 数值 |
|------|------|
| 源文件 | 720 |
| 测试文件 | 212 |
| 代码行数 | ~98K |
| 顶层模块 | 23 |
| 内置工具 | 25+ |
| 内置技能 | 5 |
| CLI 命令 | 20 |

## 贡献

参见 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解开发设置、PR 规范和代码风格。

## 许可证

[MIT](./LICENSE)
