# YourCoder

AI 驱动的开发工具，支持多智能体协作，基于终端优先架构构建。

[English](README.md)

## 特性

- **多智能体系统** — 编排器智能体将任务委派给专业子智能体（探索、编码、规划）
- **终端 UI** — 基于 SolidJS 和 [opentui](https://github.com/sst/opentui) 构建的完整 TUI
- **供应商无关** — 支持 Claude、OpenAI、Google、OpenRouter 或本地模型
- **客户端/服务器架构** — 无头服务器模式提供 API，可通过 TUI、Web 或桌面端驱动
- **LSP 集成** — 开箱即用的语言服务器支持
- **插件系统** — 通过 `@yourcoder/plugin` 扩展

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

## 项目结构

```
packages/
  yourcoder/     核心引擎 — 智能体、工具、供应商、钩子、TUI
  plugin/        插件 SDK (@yourcoder/plugin)
  sdk/           生成的客户端 SDK
  util/          共享工具库
  script/        构建和发布脚本
```

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

## 贡献

参见 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解开发设置、PR 规范和代码风格。

## 许可证

[MIT](./LICENSE)
