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
