# Next Version Planning - 2026-06

## Positioning

slack4ccmcp should evolve from "Slack bridge for Claude Code" into a lightweight
workspace gateway for coding agents. Slack remains the first-class channel, but
the durable value is the channel/runtime boundary:

- Channels normalize events, commands, threads, reactions, files, and delivery.
- Agent runtimes normalize how work is started, resumed, approved, cancelled, and
  streamed back to the user.
- Lifecycle tooling makes the gateway installable, diagnosable, upgradeable, and
  removable without hand-editing every config file.

This keeps the project useful even if Claude Code later ships an official Slack
integration. The project can compete on cross-channel support, cross-agent
support, local/private deployment, hackable manifests, and transparent runtime
control.

Detailed docs:

- Product positioning: `docs/product-positioning.md`
- Channel/gateway/runtime boundaries: `docs/architecture-boundaries.md`
- Agent runtime adapter priorities: `docs/runtime-adapters.md`

## Reference Findings

- Hermes already models gateway lifecycle and channel directory state. Its
  useful lessons for this project are service install/uninstall, status
  reporting, channel inventory, pairing/approval state, and explicit gateway
  configuration.
- OpenClaw's Feishu/Lark support is strong. The local `openclaw-lark` extension
  registers a Feishu channel, websocket monitor, reactions, threads, native
  commands, interactive cards, streaming cards, and broad tool families for IM,
  docs, wiki, drive, task, calendar, sheets, and base.
- Therefore, Feishu support should start with an adapter/reuse strategy around
  OpenClaw channel concepts instead of rebuilding a full Feishu SDK inside this
  repository.

## Release Themes

### 1. Slack Command Depth

Goal: make Slack usable as an operator surface, not just a message pipe.

Initial commands:

- `/cchelp`, `/current`, `/sessions`, `/resume`, `/new` polish.
- `/status` for daemon/session/queue/agent health.
- `/cancel` for in-flight work.
- `/approve` and `/deny` once session-host/runtime command injection exists.
- `/handoff` to switch agent runtime or channel binding.
- `/trace` to inspect recent event/tool delivery for one Slack thread.
- `/config` read-only first, write support later behind confirmation.

### 2. Channel/Gateway Abstraction

Goal: split Slack-specific code from common gateway semantics.

Core interfaces:

- `ChannelProvider`: connect, disconnect, probe, list targets.
- `InboundEvent`: message, command, reaction, file, lifecycle.
- `OutboundAdapter`: send, update, reply, react, upload.
- `CommandRouter`: native platform commands plus text fallback.
- `SessionRouter`: channel/thread/user scope to agent session mapping.

### 3. Feishu/Lark Immediate Work Support

Goal: add Feishu as the second first-class channel.

Recommended path:

- Define a channel adapter boundary that can wrap OpenClaw-style channel
  plugins.
- Start with Feishu message receive/send/update/reply, reactions, thread/chat
  identity, cards for progress, and diagnostic commands.
- Treat docs/calendar/task/base access as agent tools exposed through the
  runtime, not as gateway core logic.

### 4. Multi-Agent Runtime Support

Goal: make Claude Code the default runtime but not the only runtime.

Runtimes:

- `claude-code`: current `claude -p` implementation.
- `claude-code-host`: long-running session host for approvals and console
  commands.
- `openclaw`: Tier 1 because it already has strong Feishu/Lark channel and tool
  patterns.
- `codex`: Tier 2 when there is a stable unattended local/API execution path.
- `opencode`: Tier 2 as a provider-flexible coding agent candidate.
- `custom-command`: Tier 2 as the generic escape hatch for internal agents and
  scripts.
- Other CLIs such as Gemini CLI, Aider, Qwen Code, or company-private agents are
  Tier 3 and should be demand-driven.

### 5. Install/Uninstall Lifecycle

Goal: move from "manual setup" to "managed local service".

Commands:

- `slack-gateway install`: create config, validate tokens/scopes, install
  daemon/scheduled service, optionally install Slack manifest.
- `slack-gateway uninstall`: stop service, unregister service, optionally keep
  config/session data.
- `slack-gateway doctor`: validate CLI, tokens, app scopes, Socket Mode,
  commands, file permissions, and runtime availability.
- `slack-gateway upgrade`: migrate config and manifests.

### 6. Open Source Readiness

Goal: be intentionally open source, not accidentally public.

Tasks:

- Add `LICENSE` with MIT text to match `package.json`.
- Add `SECURITY.md` and risk warnings for agent permissions and prompt
  injection.
- Add contribution guidelines and issue templates.
- Scrub docs/manifests for personal workspace names, tokens, channel IDs, and
  machine-local paths.
- Make the README positioning explicit: local/private workspace gateway for
  coding agents, starting with Slack and Claude Code.

## Product Answer To The "Official Support" Risk

If Claude Code official Slack support appears, this project should not compete as
"the missing Slack feature." It should compete as:

- A cross-platform gateway: Slack plus Feishu/Lark and later other work systems.
- A cross-agent gateway: Claude Code plus OpenClaw and other CLIs.
- A local-first/private deployment option with auditable Markdown state.
- A power-user automation layer with install lifecycle, diagnostics, native
  commands, progress streaming, and runtime switching.
- A reference implementation for people who want to own their workflow glue.

Personal stopgap remains valid for early development, but open source only makes
sense if the repo commits to this broader gateway identity.
