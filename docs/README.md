# ChorusGate docs/

ChorusGate is the project formerly described as `chorusgate`: a local-first
gateway that connects collaboration channels such as Slack and Feishu/Lark to
coding agent runtimes such as Claude Code and Codex.

产品文档索引。所有文档中文撰写，面向后续维护者。

## 已实现功能

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 架构总览：两种模式、数据流、目录结构、核心决策 |
| [feature-auto-reply.md](./feature-auto-reply.md) | 自动回复：触发条件、回复流程、session 复用、并发控制、prompt 策略 |
| [feature-session-management.md](./feature-session-management.md) | Session 管理：slash command、sessions.md 存储、为什么不读 jsonl |
| [feature-live-progress.md](./feature-live-progress.md) | 实时进度提示：占位消息、心跳、stream-json 解析、工具标签 |
| [feature-gateway-lifecycle.md](./feature-gateway-lifecycle.md) | Gateway 生命周期：start/stop/restart/status/list、控制文件、idle eviction |
| [feature-mcp-server.md](./feature-mcp-server.md) | MCP server 模式：Web API tools、配置方式 |
| [gotchas.md](./gotchas.md) | 调试踩坑记录：13 个实测故障及修复方案 |
| [roadmap.md](./roadmap.md) | 版本规划方向 + 永久否决方案 |

## 规划中特性

> 以下文档描述尚未实现的规划。详见 [`planning/`](./planning/README.md)。

| 文档 | 内容 |
|------|------|
| [planning/feature-slack-commands.md](./planning/feature-slack-commands.md) | Slack command 增强：/stop /retry /model /agents /restart /update |
| [planning/feature-install-lifecycle.md](./planning/feature-install-lifecycle.md) | 安装生命周期：一键安装脚本、系统服务注册 |
| [planning/feature-feishu.md](./planning/feature-feishu.md) | 飞书支持：Platform 抽象层、飞书长连接接入 |
| [planning/architecture-boundaries.md](./planning/architecture-boundaries.md) | 架构边界分析 |
| [planning/product-positioning.md](./planning/product-positioning.md) | 产品定位文档 |
| [planning/runtime-adapters.md](./planning/runtime-adapters.md) | 运行时适配器方案 |
| [planning/tracking.md](./planning/tracking.md) | 追踪/日志方案 |
| [planning/version-planning-2026-06.md](./planning/version-planning-2026-06.md) | 版本规划（2026-06）|
