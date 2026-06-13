# Feature: MCP Server（被动工具模式）

> 对应文件：`src/index.ts`、`src/tools/`

---

## 功能描述

MCP server 是给 Claude Code 终端用的被动工具集。Claude Code 启动时加载它，之后可以在对话里直接调用 Slack 工具：读频道历史、发消息、查 thread、查用户等。

这是"人在回路"的使用模式——Claude Code 用户自己决定何时读、何时发。

---

## MCP Tools

| 工具 | 说明 |
|------|------|
| `slack_reply` | 在消息的 thread 里回复 |
| `slack_send_message` | 向频道发消息 |
| `slack_add_reaction` | 给消息加 emoji 反应 |
| `slack_channel_history` | 读取频道最近消息 |
| `slack_thread_replies` | 读取 thread 里的所有回复 |
| `slack_list_channels` | 列出 bot 加入的频道 |
| `slack_get_user_info` | 根据 user ID 获取用户信息 |
| `slack_get_skill_list` | 列出可用 ChorusGate skills 与触发说明 |

---

## 运行边界

`chorusgate-mcp` 现在固定为 Web API 工具服务：
- 不建立 Socket Mode / WebSocket 连接
- 不暴露实时事件 stream 或 pending 队列
- 可与 gateway 直接共存，复用同一份 `.claude/mcp.json`

**Why 这么重要**：Slack 会把同一 app 的 Socket Mode 事件分发给任意一个活动连接。把收事件职责固定在 gateway，MCP 就不会再和它抢连接。

---

## 配置（.claude/mcp.json）

```json
{
  "mcpServers": {
    "chorusgate": {
      "command": "cmd",
      "args": ["/c", "chorusgate-mcp"]
    }
  }
}
```

位置是**项目根的 `.claude/mcp.json`**。Claude Code 会合并用户目录（`~/.claude/mcp.json`）和项目目录（`./.claude/mcp.json`）的配置，无需在根目录额外放一个 `mcp.json`。示例文件放在 `.claude/mcp.json.example`。

这里展示的是 `chorusgate` 这一段最小配置片段。如果项目里还接了别的 MCP server，例如当前仓库示例中的 `trello`，请以 `.claude/mcp.json.example` 里的完整 server 列表为准。

在 Windows 上，当前项目示例使用 `cmd /c chorusgate-mcp` 这一层包装来调用 PATH 上的命令。非 Windows 环境如果已能直接解析 `chorusgate-mcp`，可改为：

```json
{
  "mcpServers": {
    "chorusgate": {
      "command": "chorusgate-mcp",
      "args": []
    }
  }
}
```

## 与 Gateway 的边界

| 能力 | MCP server | Gateway |
|------|-----------|---------|
| 实时接收事件 | ❌ | ✅ |
| 自动回复 | ❌（需 Claude Code 手动触发）| ✅（全自动）|
| 持久 session | ❌（一次性调用）| ✅（channel/thread 绑定）|
| 主动发消息 | ✅ | ✅（通过 agent runtime 子进程）|
