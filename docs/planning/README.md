# planning/

> 本目录存放尚未实现的规划文档，与 `docs/` 根目录下已实现功能文档明确区分。
> 每篇文档顶部有 `> 状态：规划中` 标注。

## 规划文档

| 文档 | 内容 | 优先级 |
|------|------|--------|
| [feature-slack-commands.md](./feature-slack-commands.md) | Slack command 增强：/stop /retry /model /agents /bg /restart /update /approve | 高 |
| [feature-install-lifecycle.md](./feature-install-lifecycle.md) | 安装生命周期：一键安装脚本、Claude CLI 检测、系统服务注册 | 高 |
| [feature-feishu.md](./feature-feishu.md) | 飞书支持：Platform 抽象层、FeishuPlatform、MCP Tools | 中 |
| [architecture-boundaries.md](./architecture-boundaries.md) | 架构边界分析    | 参考 |
| [product-positioning.md](./product-positioning.md) | 产品定位文档    | 参考 |
| [runtime-adapters.md](./runtime-adapters.md) | 运行时适配器方案 | 参考 |
| [tracking.md](./tracking.md) | 追踪/日志方案   | 参考 |
| [version-planning-2026-06.md](./version-planning-2026-06.md) | 版本规划（2026-06）| 参考 |

## 与已实现文档的关系

- 已实现功能文档在 [`../`](../) 根目录（`feature-*.md`）
- 当规划特性开发完成后，文档从本目录移到 `../`，去掉"规划中"标注
