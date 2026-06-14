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

`chorusgate-mcp` 固定为 Web API 工具服务：
- 不建立 Socket Mode / WebSocket 连接
- 不暴露实时事件 stream 或 pending 队列
- 可与 gateway 直接共存

**Why**: Slack 会把同一 app 的 Socket Mode 事件分发给任意一个活动连接。收事件职责固定在 gateway，MCP 就不抢连接。

---

## 配置

### 文件位置

Claude Code 读**项目根目录的 `.mcp.json`**（不是 `.claude/mcp.json`）。

通过 `claude mcp add --scope project` 命令创建：

```bash
claude mcp add --scope project chorusgate chorusgate-mcp
```

项目模板（可手动创建或通过命令生成）：

```json
{
  "mcpServers": {
    "chorusgate": {
      "type": "stdio",
      "command": "chorusgate-mcp",
      "args": [],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
        "SLACK_APP_TOKEN": "${SLACK_APP_TOKEN}"
      }
    }
  }
}
```

### 环境变量解析

Claude Code 对 `.mcp.json` 中 `${VAR}` 的解析链路：

```
settings.json env 字段  ──→  进程环境变量  ──→  .mcp.json ${VAR} 展开
```

**Claude Code 不会自动加载 `.env` 文件。** 必须通过以下途径之一注入变量：

| 场景 | 方式 | 位置 |
|------|------|------|
| **生产（系统服务）** | `settings.json` env 字段 | `~/.claude/settings.json` |
| **开发** | 终端 `source .env` 后启动 Claude Code | shell 环境 |
| **开发（备选）** | `settings.local.json` env 字段 | 项目 `.claude/settings.local.json` |

### 生产环境（推荐）

在 `~/.claude/settings.json` 的 `env` 块中加入 token：

```json
{
  "env": {
    "SLACK_BOT_TOKEN": "xoxb-...",
    "SLACK_APP_TOKEN": "xapp-..."
  }
}
```

这是**系统级/用户级**持久化方式——gateway 作为系统服务启动时，Claude Code 进程也能读到这些变量。`.env` 文件只适合开发终端，不适合后台服务。

### 开发环境

开发时如果已从终端 `source .env` 启动 Claude Code，变量已在进程环境中，`.mcp.json` 的 `${VAR}` 会自动解析。无需额外配置。

如需项目级隔离（不同项目用不同 token），在 `.claude/settings.local.json` 中设置（此文件已在 `.gitignore`）：

```json
{
  "env": {
    "SLACK_BOT_TOKEN": "xoxb-...",
    "SLACK_APP_TOKEN": "xapp-..."
  }
}
```

### 命令格式

```json
{
  "command": "chorusgate-mcp",
  "args": []
}
```

**不要**使用 `"command": "cmd", "args": ["/c", "chorusgate-mcp"]`——Claude Code 的 MCP launcher 直接调用可执行文件，不支持 shell 包装。

`chorusgate-mcp` 需在 PATH 上。安装方式：

```bash
cd <project-root>
npm install
npm link          # 注册 chorusgate-mcp 到全局 PATH
```

### 诊断

```bash
claude mcp list                    # 查看已加载的 MCP server
claude mcp add --scope project chorusgate chorusgate-mcp  # 添加
```

`/mcp` 面板显示警告时，按提示检查环境变量是否在 `settings.json` 或进程环境中。

---

## 与 Gateway 的边界

| 能力 | MCP server | Gateway |
|------|-----------|---------|
| 实时接收事件 | ❌ | ✅ |
| 自动回复 | ❌（需 Claude Code 手动触发）| ✅（全自动）|
| 持久 session | ❌（一次性调用）| ✅（channel/thread 绑定）|
| 主动发消息 | ✅ | ✅（通过 agent runtime 子进程）|
