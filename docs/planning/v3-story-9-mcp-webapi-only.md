# STORY-9: MCP 固定为 Web API 工具模式

> 状态：🟢 已实现 (2026-06-13) | Epic: [v3 EPIC](./v3-epic.md) | P1
> 跟踪: [#40](https://github.com/AINIZE-SPACE/ChorusGate/issues/40)
> 分支: `v3/story-8-claude-stream-json`

## 背景

当前仓库曾经同时支持两种 `chorusgate-mcp` 运行方式：

1. 带 Socket Mode 的“收事件 + 工具”模式
2. 通过 `MCP_SENDER_ONLY=1` 降级成只保留 Web API 的工具模式

这带来三类问题：

- 配置模型复杂：`.claude/mcp.json`、generated sender config、runtime 参数三处都要保持一致
- 行为模型分裂：同一个 MCP 名称在不同上下文下能力不同，难以维护
- Slack 身份与连接边界容易混淆：gateway 和 spawned runtime 可能因为不同配置再次争抢 Socket Mode

## 决策

把 `chorusgate-mcp` 固定为 **Web API tools only**：

- 不建立 Socket Mode / WebSocket
- 不提供 pending events / subscribe stream 资源接口
- 只提供 Slack Web API 工具：读历史、读 thread、发消息、回帖、加 reaction、查用户/频道

由此收敛出新的职责边界：

- `gateway` 是唯一的 Slack Socket Mode ingress
- agent runtime 统一通过 `.claude/mcp.json` 获得 Slack Web API 工具
- `claude -p`、`claude-stream`、Codex 不再需要 sender-only 的专用 MCP 变体

## 实现范围

- [x] `src/index.ts` 移除 Socket Mode 启动逻辑
- [x] `src/index.ts` 移除 MCP resources / subscribe / event stream 能力
- [x] 删除 `slack_check_events` MCP tool
- [x] 统一 `claude.ts` / `claude-stream.ts` 注释与配置模型
- [x] `codexProvider.generateMCPConfig()` 不再写入 `MCP_SENDER_ONLY`
- [x] README / INSTALL / architecture / gotchas / planning 文档统一改写
- [x] 新增测试覆盖新的 Codex MCP 配置约束

## 验收标准

- [x] `chorusgate-mcp` 启动后不再尝试建立 Socket Mode 连接
- [x] MCP tool 列表中不再包含 `slack_check_events`
- [x] `.claude/mcp.json` 可同时被本地 runtime 与 gateway spawn 的 runtime 复用
- [x] Codex 生成的 TOML 配置仍包含 token 与 `default_tools_approval_mode = "approve"`
- [x] Codex 生成的 TOML 配置不再包含 `MCP_SENDER_ONLY`
- [x] 文档不再把 `MCP_SENDER_ONLY` 作为主路径配置

## 测试

- `npm run typecheck`
- `npm test`
- `tests/codex-provider.test.ts`

## 后续影响

- 任何仍依赖 MCP 实时事件流的设计需要显式迁移到 gateway ingress 或新的专用控制面
- 旧的 sender-only/generated config 叙述保留在历史文档中时，应视为已过时
