# v3 EPIC: 多 Agent 多项目 Slack 网关

> 状态：规划中 | 目标版本：v3.0.0

## 一句话目标

将 gateway 从"单 Claude Code Slack bot"扩展为"多 AI agent（CC + Codex）+ 多 Slack app + 多项目"的通用 IM→Agent 网关。

---

## EPIC 拆分

| Story | 标题 | 优先级 | 依赖 |
|-------|------|--------|------|
| [STORY-1](./v3-story-1-provider-abstraction.md) | Agent Provider 抽象层 | P0 | — |
| [STORY-2](./v3-story-2-codex-provider.md) | Codex Provider 实现 | P0 | STORY-1 |
| [STORY-3](./v3-story-3-multi-slack-app.md) | 多 Slack App Socket Mode | P0 | STORY-1 |
| [STORY-4](./v3-story-4-multi-project.md) | 会话级多项目支持 | P1 | STORY-1 |
| [STORY-5](./v3-story-5-session-model.md) | 统一 Session 模型（CC + Codex） | P0 | STORY-1, STORY-2 |
| [STORY-6](./v3-story-6-config-system.md) | 多 Agent/多 App 配置系统 | P0 | STORY-3, STORY-4 |
| [STORY-7](./v3-story-7-codex-slack-tools.md) | Codex Slack MCP Tools | P1 | STORY-2 |

---

## 里程碑

### M0：验证 Spike（评审新增）
- 真实运行 `codex exec <prompt> --json --ask-for-approval never`
- 固化 JSONL fixture（确认 `thread_id` 字段格式）
- 固化 resume fixture：`codex exec resume <tid> <prompt> --json`
- 固化 MCP tool-call fixture（含 tool_use 事件格式）
- 产物：`tests/fixtures/codex-*.jsonl`
- 详见 [#29](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/29)

### M1：双 Agent 核心（STORY-1, 2, 5）
- Per-profile Slack runtime 重构（拆单例）
- Provider 抽象层完成
- Claude Code provider（现有逻辑迁移）
- Codex provider（`codex exec` spawn，`thread_id` 解析）
- Session key 结构化改造（profileId + providerId + scopeKey + projectDir）

### M2：多 Slack App（STORY-3, 6）
- 多 SocketModeClient 实例
- `GATEWAY_PROFILES=cc,codex` 配置系统
- Per-profile token 注入 MCP config
- 每个 Slack app → 对应 provider

### M3：多项目 + Slack 工具（STORY-4, 7）
- 会话级 project cwd
- `/cc_new --project <dir>` 切换工作目录
- Codex Slack MCP Tools（gateway-only，MCP server 保持 CC first）

---

## 关键架构决策（待确认）

1. **一个 gateway 进程 vs 多进程**：统一进程多 provider（推荐，共享 Socket Mode 管理）
2. **Slack app → provider 映射**：1:1（一个 app 对应一个 agent），按 token 后缀区分
3. **多项目范围**：会话级（每个 session 可绑定不同 cwd），不引入 workspace 概念
4. **Codex session ID**：首次 `codex exec` 从 JSONL 解析 `thread.id`，回写 sessionStore
