# slack4ccmcp

[中文文档](./README_CN.md)

A self-hosted gateway that connects Claude Code (`claude -p`) to Slack. @mention the bot in a channel or send it a DM — it automatically routes to Claude and posts the reply back. Also ships an MCP server so Claude Code in your terminal can actively read and write Slack.

**Highlights:**

- **No public URL**: Uses Slack Socket Mode (outbound WebSocket), no ngrok or public IP required
- **Persistent context**: Each channel/DM binds to a long-lived Claude session — conversation continues across messages
- **Self-hosted**: Your tokens never leave your machine

---

## Quick Start

### Prerequisites

- Node.js >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — verify with `claude -p "say hi"`
- Slack workspace admin access (to create an app)

### 1. Create the Slack App

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**
2. Select your workspace
3. Paste the contents of [`manifest.json`](./manifest.json) from this repo
4. Click **Create** → **Install to Workspace** → **Allow**

### 2. Collect Tokens

- **OAuth & Permissions** → copy the **Bot User OAuth Token** (`xoxb-…`)
- **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**
  - Give it a name (e.g. `socket`), add scope `connections:write`, generate
  - Copy the App-Level Token (`xapp-…`)

### 3. Configure .env

`.env` is loaded from two locations (later overrides earlier):

1. `~/.gateway/.env` — global defaults, shared across projects
2. `./.env` — project-specific overrides (gitignored)

Shell environment variables have the highest priority — they will never be overwritten by `.env` files. Both files are optional; missing ones are silently skipped.

Create `./.env` in the project root:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

### 4. Install Dependencies

```bash
npm install
npm link
```

> :warning: **Don't skip `npm link`.** `npm install` alone won't register the `slack-gateway` and `slack-socket-mcp` commands on your PATH. If you get `command not found` later, re-run `npm link`.

### 5. Verify Claude CLI

Run this in **your own terminal** (not a sandbox):

```bash
claude -p "say pong" --output-format text
```

If it prints "pong", you're good. The gateway spawns `claude -p` and inherits this environment — if the CLI doesn't work here, it won't work in the gateway either.

### 6. Start the Gateway

**Foreground** (good for first run / debugging):

```bash
npm run gateway        # or: slack-gateway run
```

**Background daemon** (recommended for ongoing use):

```bash
slack-gateway start    # start in the background
slack-gateway status   # check status (pid, uptime, active sessions)
slack-gateway stop     # stop
slack-gateway restart  # restart
slack-gateway list     # list channel→session mappings
```

`npm run start|stop|restart|status|list` are aliases. Logs go to `.gateway/gateway.log`.

### 7. Use It in Slack

Invite the bot to a channel (`/invite @ClaudeCodeApp`), then @mention it or send it a DM. Replies are automatic.

---

## Two Modes

| Mode | Entry point | When to use |
|------|-------------|-------------|
| **Auto-reply gateway** | `src/gateway.ts` | Fully automatic replies, runs as a daemon |
| **MCP server** | `src/index.ts` | Claude Code terminal calls Slack tools on demand |

> **Only one Socket Mode connection at a time.** Slack load-balances each event to exactly one open connection per app — two connections means events get split and lost.
>
> To run the gateway for receiving AND keep Claude Code able to proactively send messages, add `"MCP_SENDER_ONLY": "1"` to the MCP server config. It skips Socket Mode and uses Web API only.

---

## MCP Server Mode

Create `.claude/mcp.json` in your project root (reuses the `.claude` system — no need for a separate root `mcp.json`). You can start from `.claude/mcp.json.example`:

**Standalone (no gateway)**:

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

**Alongside gateway** (must add `MCP_SENDER_ONLY=1`):

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

Available MCP tools: `slack_check_events` / `slack_reply` / `slack_send_message` / `slack_add_reaction` / `slack_channel_history` / `slack_thread_replies` / `slack_list_channels` / `slack_get_user_info`

---

## Slash Commands

Control sessions directly from Slack:

| Command | Description |
|---------|-------------|
| `/cc_sessions` | List all known sessions |
| `/cc_resume N` or `/cc_resume <uuid>` | Switch the current channel to a specific session |
| `/cc_new` | Reset the current session (next message starts fresh) |
| `/cc_current` | Show the currently bound session |
| `/cchelp` | Show help |

> To use slash commands in DMs: Slack App settings → **App Home** → enable "Allow users to send Slash commands and messages from the messages tab".

---

## Environment Variables

> **Where to put them:** Gateway-specific variables go in `.env` (loaded from `~/.gateway/.env` and `./.env`).
> Only `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` may also appear in `.claude/mcp.json`'s `env` block (for the MCP server).
> Shell environment variables always take precedence.

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_MAX_CONCURRENT` | `3` | Max simultaneous `claude -p` processes |
| `GATEWAY_REPLY_TIMEOUT_MS` | `180000` | Per-reply timeout (ms) |
| `GATEWAY_REPLY_TIMEOUT_MS_LONG` | `360000` | Per-reply timeout for resume turns (ms) |
| `GATEWAY_SESSION_SCOPE` | `channel` | `channel` (shared per channel) or `thread` (isolated per thread) |
| `GATEWAY_SESSION_IDLE_MS` | `86400000` | Idle time before a session mapping is evicted (ms) |
| `GATEWAY_PROGRESS` | `1` | Set to `0` to disable live progress messages |
| `GATEWAY_CLAUDE_CWD` | project root | Working directory for spawned claude processes |
| `CLAUDE_BIN` | `claude` | Path to the Claude CLI binary |
| `CLAUDE_PERMISSION_MODE` | `bypassPermissions` | Permission mode for headless claude |
| `MCP_SENDER_ONLY` | — | Set to `1` to use Web API tools only, no Socket Mode connection |

---

## Troubleshooting

**Bot randomly misses messages**

Only one Socket Mode connection per app is allowed. Multiple connections split events. Make sure only the gateway opens a Socket Mode connection; add `MCP_SENDER_ONLY=1` to the MCP server config.

**Slash commands don't work in DMs**

Slack App settings → **App Home** → check "Allow users to send Slash commands and messages from the messages tab", then reinstall the app.

**Windows: `claude -p` exits with code 3221225794**

`STATUS_DLL_INIT_FAILED` — too many processes spawned at once. Lower `GATEWAY_MAX_CONCURRENT`, or check that empty messages aren't bypassing the `shouldReply` filter.

**Placeholder stuck on "Sending..." / timed out after 180s**

Long resume turns use `GATEWAY_REPLY_TIMEOUT_MS_LONG` (default 360s). If you see timeouts on long tasks, increase it. If the placeholder message is stuck on a tool label, restart the gateway — the latest code fixes drain-queue ordering.

**`slack-gateway: command not found`**

`npm install` doesn't register global commands — run `npm link` to wire `slack-gateway` and `slack-socket-mcp` onto your PATH.

More in [`docs/gotchas.md`](./docs/gotchas.md).

---

## Documentation

- [`INSTALL.md`](./INSTALL.md) — Detailed installation guide
- [`docs/architecture.md`](./docs/architecture.md) — Architecture overview
- [`docs/`](./docs/README.md) — Full documentation index (including planned features)

---

## License

MIT
