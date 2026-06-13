# ChorusGate

[English](./README.md)

ChorusGate 是一个 local-first 的协作 channel gateway，用来把 coding agents 接入 Slack、飞书/Lark 等工作频道。
它最初是 Claude Code + Slack 桥接器，现在范围扩展为 Slack、飞书规划、Claude Code、Codex 和更多 agent runtime 的通用网关。

在 Slack 里 @mention 机器人或发 DM，ChorusGate 会把消息路由给配置的 agent runtime 并回帖。同时提供 MCP server，让 agent runtime 能主动读写频道上下文。

**特点：**

- **Local-first**：运行在自己的机器或私有服务器，token 不出本地
- **Channel-oriented**：Slack 已支持，飞书/Lark 在规划中
- **Agent-oriented**：Claude Code 已支持，Codex 和更多 runtime 在范围内
- **持久上下文**：每个频道/DM 可绑定一个长期 agent session

---

## 快速开始

### 前置要求

- Node.js >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)（`claude -p "say hi"` 能跑通）
- Slack workspace 管理员权限（创建 app 用）

### 1. 创建 Slack App

1. 打开 <https://api.slack.com/apps> → **Create New App** → **From a manifest**
2. 选择你的 workspace
3. 粘贴项目根目录的 [`manifest.json`](./manifest.json)?CC app?? [`manifest.cx.json`](./manifest.cx.json)?CX app? 内容
4. 点 **Create** → **Install to Workspace** → **Allow**

### 2. 获取 Token

- **OAuth & Permissions** → 复制 **Bot User OAuth Token**（`xoxb-…`）
- **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**
  - 名字随意（如 `socket`），scope 选 `connections:write`，生成
  - 复制 App-Level Token（`xapp-…`）

### 3. 配置 .env

`.env` 从两个位置加载（后者覆盖前者）：

1. `~/.gateway/.env` — 全局默认配置（所有项目共用）
2. `./.env` — 项目级覆盖（已 gitignore）

Shell 环境变量优先级最高，不会被 `.env` 文件覆盖。两个文件都是可选的，不存在也不会报错。

在项目根目录创建 `./.env`：

```env
SLACK_BOT_TOKEN=xoxb-你的-bot-token
SLACK_APP_TOKEN=xapp-你的-app-token
```

### 4. 安装依赖

```bash
npm install
npm link
```

> :warning: **不要跳过 `npm link`。** `npm install` 不会把 `chorusgate` 和 `chorusgate-mcp` 注册到 PATH。后面如果报 `command not found`，先回来跑 `npm link`。

### 5. 验证 Claude CLI

在**你自己的终端**（非沙箱）运行：

```bash
claude -p "say pong" --output-format text
```

输出 "pong" 说明 CLI 正常。Gateway 依赖这个环境，如果这里挂了，gateway 也无法生成回复。

### 6. 启动 Gateway

**前台模式**（首次调试推荐）：

```bash
npm run gateway        # 或 chorusgate run
```

**后台守护进程**（日常使用）：

```bash
chorusgate start    # 后台启动
chorusgate status   # 查看状态（pid、运行时长、活跃 session 数）
chorusgate stop     # 停止
chorusgate restart  # 重启
chorusgate list     # 列出 channel→session 映射
```

`npm run start|stop|restart|status|list` 是对应别名。日志写 `.gateway/gateway.log`。

### 7. 在 Slack 里使用

把机器人加入频道（`/invite @ChorusGate`），然后 @mention 它，或者直接发 DM。

---

## 两种运行模式

| 模式 | 文件 | 适合场景 |
|------|------|---------|
| **Gateway 守护进程** | `src/gateway.ts` | 自动回复，常驻后台，无需人工干预 |
| **MCP Server** | `src/index.ts` | agent runtime 主动调用 Slack 工具 |

> **不能同时建两个 Socket Mode 连接。** Slack 把事件负载均衡到同一 app 的所有连接，两个连接 = 事件分流丢失。
>
> 现在 `chorusgate-mcp` 固定只提供 Web API 工具，不再建立 Socket Mode。Gateway 负责收事件，agent runtime 可直接复用同一份 `.claude/mcp.json`。

---

## MCP Server 模式

在项目根创建 `.claude/mcp.json`（复用 `.claude` 体系，无需在根目录额外建 `mcp.json`）。可从 `.claude/mcp.json.example` 复制：

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

同一份配置既可单独使用，也可与 gateway 共存，因为 `chorusgate-mcp` 已不再建立 Socket Mode。

可用的 MCP tools：`slack_reply` / `slack_send_message` / `slack_add_reaction` / `slack_channel_history` / `slack_thread_replies` / `slack_list_channels` / `slack_get_user_info`

---

## Slash Commands

在 Slack 里直接控制 session：

| 命令 | 说明 |
|------|------|
| `/cc_sessions` | 列出所有已知 session |
| `/cc_resume N` 或 `/cc_resume <uuid>` | 切换当前频道绑定的 session |
| `/cc_new` | 重置 session（下条消息开新对话）|
| `/cc_current` | 显示当前绑定的 session |
| `/cchelp` | 帮助 |

> 在 DM 里使用 slash command，需要在 Slack App 管理页 **App Home** 里勾选 "Allow users to send Slash commands and messages from the messages tab"。

---

## 环境变量

> **放哪里：** Gateway 专有参数放 `.env`（从 `~/.gateway/.env` 和 `./.env` 加载）。
> 只有 `SLACK_BOT_TOKEN` 和 `SLACK_APP_TOKEN` 可能也出现在 `.claude/mcp.json` 的 `env` 块中（给 MCP server 用）。
> Shell 环境变量始终优先。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GATEWAY_MAX_CONCURRENT` | `3` | 最大并发 claude 进程数 |
| `GATEWAY_REPLY_TIMEOUT_MS` | `180000` | 单条回复超时（ms）|
| `GATEWAY_REPLY_TIMEOUT_MS_LONG` | `360000` | 续轮会话回复超时（ms）|
| `GATEWAY_SESSION_SCOPE` | `channel` | `channel`（频道共享）或 `thread`（每条线程独立）|
| `GATEWAY_SESSION_IDLE_MS` | `86400000` | session 映射 idle 多久后清理（ms）|
| `GATEWAY_PROGRESS` | `1` | 设为 `0` 关闭进度提示消息 |
| `GATEWAY_CLAUDE_CWD` | 项目根 | spawned claude 的工作目录 |
| `CLAUDE_BIN` | `claude` | claude CLI 路径 |
| `CLAUDE_PERMISSION_MODE` | `bypassPermissions` | headless 模式权限策略 |
---

## 常见问题

**事件丢失，机器人时而收不到消息**

同一 Slack app 只能有一个 Socket Mode 连接。多个连接会导致 Slack 分流事件。确保只有 gateway 建 Socket Mode 连接；`chorusgate-mcp` 已不再建第二条连接。

**Slash command 在 DM 里不工作**

Slack App 管理页 → App Home → 勾选 "Allow users to send Slash commands and messages from the messages tab"，重装 app。

**Windows 下 `claude -p` 报 exit code 3221225794**

`STATUS_DLL_INIT_FAILED`，同时创建了太多进程。调低 `GATEWAY_MAX_CONCURRENT`，或检查是否有空消息触发 spawn 风暴。

**占位消息卡在"发送中…" / 续轮超时 180s**

续轮会话使用 `GATEWAY_REPLY_TIMEOUT_MS_LONG`（默认 360s）。长任务超时就调大它。占位消息卡住的话重启 gateway —— 最新代码已修复进度队列排空顺序。

**`chorusgate: command not found`**

`npm install` 不会注册全局命令 — 跑一次 `npm link` 把 `chorusgate` 和 `chorusgate-mcp` 挂到 PATH。

更多见 [`docs/gotchas.md`](./docs/gotchas.md)。

---

## 文档

- [`INSTALL.md`](./INSTALL.md) — 详细安装向导
- [`docs/architecture.md`](./docs/architecture.md) — 架构总览
- [`docs/`](./docs/README.md) — 完整文档索引（含规划特性）

---

## License

MIT
