# ChorusGate Architecture

> 维护入口。先读这篇，再看各 feature 文档。

---

## 一句话定位

ChorusGate 是一个 local-first collaboration-channel gateway。

- `gateway` 负责 Slack 事件接入、路由、会话、命令和自动回复。
- agent runtime 负责执行 turn 并返回结果。
- `chorusgate-mcp` 负责给 Claude Code、Codex 等 runtime 提供 Slack Web API 工具。

MCP server 现在固定为 Web API 工具模式，不再承担 Socket Mode 收事件。

---

## 两种运行模式

### 模式 A：Gateway 守护进程

- 入口：`src/gateway.ts`
- 二进制：`chorusgate`
- 作用：常驻运行，自动回复 `@mention`、DM、slash command、interactive actions

### 模式 B：MCP Server

- 入口：`src/index.ts`
- 二进制：`chorusgate-mcp`
- 作用：按需提供 Slack 工具，供 agent runtime 主动读写频道上下文

---

## 关键边界

### Socket Mode 只有 gateway 持有

Slack 会把同一 app 的 Socket Mode 事件分发给任意一个活动连接。为了避免事件分流，ChorusGate 现在固定为：

- `gateway` 负责唯一的 Socket Mode 连接
- `chorusgate-mcp` 不建立 WebSocket，只走 Slack Web API

因此，`.claude/mcp.json` 可以直接同时服务于：

- 终端里的 Claude Code / Codex
- gateway spawn 出来的 `claude -p`

不再需要专门区分额外的 MCP 配置变体。

### 会话与对话内容分离

- gateway 只保存路由元数据，例如 `channel/thread -> session UUID`
- 真正的对话历史由 runtime 自己管理，例如 `claude -p --resume`

这样 gateway 是一个轻量的 meta router，而不是对话数据库。

---

## Gateway 数据流

```text
Slack user message
  -> Socket Mode
  -> socket-manager.ts
  -> gateway.ts
  -> reply-engine.ts
  -> spawned runtime (`claude -p`, `codex exec`, ...)
  -> Slack Web API reply
```

关键点：

- `socket-manager.ts` 负责 Slack ingress：message、mention、slash command、interactive action
- `gateway.ts` 负责 session scope、串行化、超时、进度消息、审批消息
- `reply-engine.ts` 负责选择 provider 并 spawn runtime
- provider 进程通过 `.claude/mcp.json` 获得 Slack Web API 工具能力

---

## 目录结构

```text
src/
  index.ts              MCP server 入口（Web API tools only）
  gateway.ts            Gateway 守护进程入口
  socket-manager.ts     Socket Mode 连接管理 + 事件分发
  reply-engine.ts       Runtime spawn / provider routing
  session-store.ts      Scope -> session 映射，持久化到 memory/sessions.md
  session-commands.ts   Slash command 处理
  event-store.ts        Gateway 内部事件辅助状态
  slack-clients.ts      Slack WebClient 初始化
  providers/            Claude / Codex provider 实现
  tools/                MCP tools

bin/
  chorusgate.mjs        gateway 控制入口
  chorusgate-mcp.mjs    MCP server 启动入口

memory/
  sessions.md           路由元数据持久化

.gateway/
  gateway.pid
  gateway.log
  status.json
```

---

## MCP 配置

项目 MCP 配置统一放在 `.claude/mcp.json`。

`chorusgate-mcp` 只提供这些能力：

- `slack_reply`
- `slack_send_message`
- `slack_add_reaction`
- `slack_channel_history`
- `slack_thread_replies`
- `slack_list_channels`
- `slack_get_user_info`

不再提供：

- pending event 轮询工具
- MCP resources / subscribe event stream
- 任何 Socket Mode 收事件能力

---

## 会话模型

默认情况下：

- `GATEWAY_SESSION_SCOPE=channel`：一个 channel / DM 共享一个 session
- `GATEWAY_SESSION_SCOPE=thread`：一个 thread 一个 session

无论哪种 scope，同一个 scope key 上的 turn 都会串行执行，避免两个并发 `--resume <same-session>` 污染状态。

---

## 设计取舍

### 为什么保留 event-store

`event-store.ts` 仍然保留，因为 gateway 内部还会用它做：

- handled 标记
- reply 工具后的 best-effort 状态收口
- 辅助去重和短期事件状态

但它不再是 MCP 的对外实时事件接口。

### 为什么统一 `.claude/mcp.json`

统一配置有三个好处：

1. Claude Code、Codex、gateway spawn 的 `claude -p` 走同一份工具定义
2. 避免 generated sender config 和项目配置长期漂移
3. Slack 中的写操作保持同一个 bot 身份，不会出现“gateway 一个身份、runtime 一个身份”的分裂体验

---

## 相关文档

- [INSTALL.md](../INSTALL.md)
- [docs/feature-mcp-server.md](./feature-mcp-server.md)
- [docs/feature-gateway-lifecycle.md](./feature-gateway-lifecycle.md)
- [docs/feature-auto-reply.md](./feature-auto-reply.md)
