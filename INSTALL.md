# ChorusGate Installation Guide

Set up the ChorusGate Slack bot from the provided manifest, then run the
auto-reply gateway. ChorusGate is the local-first collaboration-channel gateway
for coding agents; Slack + Claude Code is the first supported path, with
Feishu/Lark and Codex in scope.

## 1. Create the Slack app from the manifest

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**.
2. Pick your workspace.
3. Paste the contents of [`manifest.json`](./manifest.json) for a Claude Code
   style app, or [`manifest.cx.json`](./manifest.cx.json) for a Codex style
   app. These are starter manifests with different slash-command prefixes. Each
   manifest pre-configures Socket Mode, native slash commands, required bot
   scopes, and bot events - including `reaction_added`.
4. Review and click **Create**.

> The manifest sets `socket_mode_enabled: true`, so no public request URL is
> needed — the gateway connects out over a WebSocket.

## 2. Install to the workspace & collect tokens

1. **Install App** → **Install to Workspace** → **Allow**.
2. **OAuth & Permissions** → copy the **Bot User OAuth Token** (`xoxb-…`).
3. **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**:
   - Name it (e.g. `socket`), add scope **`connections:write`**, **Generate**.
   - Copy the token (`xapp-…`).

## 3. Configure `.env`

Create `.env` in the project root (gitignored):

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

## 4. Install dependencies & link the CLI

```bash
npm install
npm link        # registers `chorusgate-mcp` and `chorusgate` on PATH
```

## 5. Verify headless Claude works in YOUR terminal

```bash
claude -p "say pong" --output-format text     # should print "pong" in seconds
```

If this hangs or errors, the gateway can't generate replies — fix your Claude
CLI auth/network first. (Run it in your **native terminal**, not a sandbox: the
gateway spawns `claude -p` and inherits this environment's network/auth.)

## 6. Run the gateway

**Foreground** (blocks the terminal, good for first run / debugging):

```bash
npm run gateway          # or: chorusgate run
# → "[gateway] listening — will auto-reply to @mentions and DMs."
```

**Background daemon** (recommended for ongoing use):

```bash
chorusgate start      # start in the background
chorusgate status     # running? pid, uptime, active sessions
chorusgate list       # active channel/thread → session mappings
chorusgate restart    # restart
chorusgate stop        # stop
```

(`npm run start|stop|restart|status|list` work too — `npm start` ≡ `chorusgate start`.)
Logs go to `.gateway/gateway.log`. Only one daemon runs at a time (single Socket
Mode connection); `start` refuses if one is already running — use `restart`.

Then, in Slack: invite the bot to a channel (`/invite @ChorusGate`),
@mention it, or DM it. Replies are automatic.

---

## 7. Set up MCP server (Claude Code IDE integration)

> 如果只在 gateway 自动回复模式下使用 ChorusGate，可跳过此步骤。

要让 Claude Code IDE 对话中直接调用 Slack 工具（发消息、读频道等），需配置 MCP server。

### 注册

```bash
claude mcp add --scope project chorusgate chorusgate-mcp
```

这会创建项目根的 `.mcp.json`。也可以直接复制模板：

```bash
cp .claude/mcp.json.example .mcp.json
```

### 环境变量

Claude Code **不会自动读 `.env` 文件**。`.mcp.json` 中的 `${SLACK_BOT_TOKEN}` 从以下来源解析：

| 场景 | 方式 |
|------|------|
| **生产（系统服务）** | 在 `~/.claude/settings.json` 的 `env` 块设置 `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` |
| **开发** | 在终端 `source .env` 后启动 Claude Code |
| **开发（备选）** | 在项目 `.claude/settings.local.json` 的 `env` 块设置 |

### 验证

```bash
claude mcp list          # 查看是否加载成功
```

`/mcp` 面板显示 chorusgate 即成功。

---

## Gotchas (learned the hard way)

- **One Socket Mode connection only.** Slack load-balances each event to exactly
  ONE open connection. Don't run the gateway AND a Claude Code MCP server that
  connects Socket Mode at the same time — events scatter and get lost. To let
  Claude Code still *send* proactively while the gateway owns receiving, use
  the current `chorusgate-mcp`, which stays on Slack Web API tools only.
- **`reaction_added` needs both the event subscription AND the `reactions:read`
  scope.** The manifest includes both. If you edit scopes/events later, you must
  **reinstall** the app.
- **Adding a reaction ≠ typing an emoji.** To trigger `reaction_added`, hover a
  message → click the 😊 icon → pick an emoji. Typing `:smile:` in the box just
  sends a normal message.
- **Sessions are reused per channel/DM by default.** Each channel or DM maps to
  a persistent Claude session, so the bot behaves like a long-lived room
  assistant. Set `GATEWAY_SESSION_SCOPE=thread` if you prefer per-topic
  isolation. Idle mappings are evicted after 24h (configurable via
  `GATEWAY_SESSION_IDLE_MS`).

## Tuning (optional `.env` knobs)

| Var | Default | Meaning |
|-----|---------|---------|
| `GATEWAY_MAX_CONCURRENT` | 3 | Max simultaneous `claude -p` replies |
| `GATEWAY_REPLY_TIMEOUT_MS` | 180000 | Per-reply timeout |
| `GATEWAY_SESSION_SCOPE` | `channel` | `channel` or `thread` session scope |
| `GATEWAY_COMMAND_PREFIX` | `cc` | Slash-command prefix for this app profile; used only for Slack command names |
| `GATEWAY_SESSION_IDLE_MS` | 86400000 | Idle time before a scope mapping is evicted |
| `GATEWAY_CLAUDE_CWD` | project root | Working dir for the spawned claude |
| `CLAUDE_BIN` | `claude` | Path to the Claude CLI |

For multiple assistants owned by one human:

- One Claude Code assistant plus one Codex assistant can map cleanly to two
  Slack apps.
- If the same human wants multiple Claude Code roles such as dev, test, and
  manager, model them as multiple Slack apps or app profiles rather than one
  app with overloaded behavior.
- The hard constraint is that slash commands are unique across a workspace, so
  `GATEWAY_COMMAND_PREFIX` exists to keep those namespaces from colliding.
