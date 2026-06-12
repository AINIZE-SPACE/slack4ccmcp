# Feature: MCP Server（被动工具模式）

> 对应文件：`src/index.ts`、`src/tools/`、`src/event-store.ts`

---

## 功能描述

MCP server 是给 Claude Code 终端用的被动工具集。Claude Code 启动时加载它，之后可以在对话里直接调用 Slack 工具：读频道历史、发消息、订阅实时事件等。

这是"人在回路"的使用模式——Claude Code 用户自己决定何时读、何时发。

---

## MCP Tools

| 工具 | 说明 |
|------|------|
| `slack_check_events` | 获取未处理的 Slack 事件（pending 队列）|
| `slack_reply` | 在消息的 thread 里回复 |
| `slack_send_message` | 向频道发消息 |
| `slack_add_reaction` | 给消息加 emoji 反应 |
| `slack_channel_history` | 读取频道最近消息 |
| `slack_thread_replies` | 读取 thread 里的所有回复 |
| `slack_list_channels` | 列出 bot 加入的频道 |
| `slack_get_user_info` | 根据 user ID 获取用户信息 |

---

## MCP Resources

| URI | 说明 |
|-----|------|
| `slack://events/stream` | 实时事件流（subscribe 后有新事件会通知）|
| `slack://events/pending` | 未处理事件快照 |

---

## Event Store（内存环形缓冲）

`event-store.ts` 维护一个内存 Map，存 `StoredEvent`。特点：
- **Transient**：重启清空，不持久化
- **环形**：超过上限（默认 200）自动丢弃最旧的
- `markHandled(id)` 标记已处理，`slack_check_events` 只返回未处理的

**Why 不持久化**：MCP server 是 Claude Code 的实时"感官"，历史事件由 Slack 频道自己保存（`slack_channel_history` 可查）。内存缓冲只用于当前会话的"刚刚发生了什么"。

---

## sender-only 模式（MCP_SENDER_ONLY=1）

设 `MCP_SENDER_ONLY=1` 时：
- 跳过 Socket Mode 连接（不建 WebSocket）
- 只保留 Web API 工具（send/history/react 等）
- `slack_check_events` 返回空

**使用场景**：Gateway 运行时，让 Claude Code 终端也能主动发 Slack 消息，同时不抢事件连接。这是 gateway + MCP 共存的标准配置。

**Why 这么重要**：Slack 把事件负载均衡到同一 app 的所有 Socket Mode 连接，两个连接 = 事件被分流，各拿到约 50%。gateway 就会漏掉大量消息。

---

## 配置（.claude/mcp.json）

```json
{
  "mcpServers": {
    "slack-socket": {
      "command": "slack-socket-mcp",
      "args": []
    }
  }
}
```

位置是**项目根的 `.claude/mcp.json`**。Claude Code 会合并用户目录（`~/.claude/mcp.json`）和项目目录（`./.claude/mcp.json`）的配置，无需在根目录额外放一个 `mcp.json`。示例文件放在 `.claude/mcp.json.example`。

Gateway 共存时加 `MCP_SENDER_ONLY=1` 环境变量：

```json
{
  "mcpServers": {
    "slack-socket": {
      "command": "slack-socket-mcp",
      "args": [],
      "env": { "MCP_SENDER_ONLY": "1" }
    }
  }
}
```

---

## 与 Gateway 的边界

| 能力 | MCP server | Gateway |
|------|-----------|---------|
| 实时接收事件 | ✅（无 `MCP_SENDER_ONLY`）| ✅（始终）|
| 自动回复 | ❌（需 Claude Code 手动触发）| ✅（全自动）|
| 持久 session | ❌（一次性调用）| ✅（channel/thread 绑定）|
| 主动发消息 | ✅ | ✅（通过 sender-only 子进程）|
