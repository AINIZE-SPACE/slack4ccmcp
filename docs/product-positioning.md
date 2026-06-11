# Product Positioning

Status: planning

## One Sentence

slack4ccmcp is a local-first workspace gateway for coding agents.

It starts with Slack and Claude Code, but the product should not be limited to
"Slack support while Claude Code lacks it." The durable product is a small,
private, hackable gateway that connects work channels to agent runtimes.

## Target Shape

- Channels: Slack first, Feishu/Lark second, later other work systems.
- Agent runtimes: Claude Code first, then OpenClaw, Codex, OpenCode, and custom
  command runtimes where useful.
- Deployment: local-first, private by default, self-hostable, with readable
  Markdown state and explicit lifecycle commands.
- Operations: install, uninstall, doctor, status, logs, trace, update, and
  recoverable event handling.
- Extensibility: typed channel and runtime boundaries so new integrations do not
  fork the gateway core.

## Why This Survives Official Claude Code Slack Support

If Claude Code ships official Slack support, a Slack-only bridge becomes a
temporary workaround. This project should compete on a broader axis:

- Cross-channel: Slack plus Feishu/Lark, and eventually other enterprise IM or
  work platforms.
- Cross-agent: Claude Code plus other coding agents and CLI-based workers.
- Local-first control: credentials, state, logs, and agent execution stay on the
  user's machine or self-hosted environment.
- Deep operations: native channel commands, live progress, diagnostics,
  lifecycle install/uninstall, event replay, runtime switching, and transparent
  failure handling.
- Reference implementation: developers can inspect, adapt, and extend the
  gateway instead of waiting for a vendor-specific integration.

## Product Modes

### Personal Power Tool

Single user, one machine, one Slack or Feishu workspace, fast iteration. This is
the current origin and remains important.

### Team Local Gateway

A small team runs the gateway on a trusted machine or private server. It supports
shared channels, multiple profiles, audit-friendly logs, and explicit agent
permissions.

### Integration Reference

Developers use the codebase as a pattern for building channel adapters and agent
runtime adapters.

## Open Source Position

MIT is a good default if the project commits to the broader gateway identity.

Before public promotion:

- Add a root `LICENSE` file matching `package.json`.
- Add `SECURITY.md` with prompt-injection, token, workspace, and agent-permission
  warnings.
- Scrub docs, manifests, and state files for private IDs and local paths.
- Make unsafe defaults explicit, especially unattended permission modes.
- Document which integrations are first-party, adapter-based, or experimental.

## Non-Goals

- Become a full Slack or Feishu SDK.
- Replace OpenClaw's Feishu/Lark plugin ecosystem.
- Store full agent conversation history in the gateway.
- Require a hosted SaaS backend for the default use case.
- Hide runtime behavior behind opaque automation.

## Tracking

- Roadmap epic: #4
- Open source strategy: #10
- Channel abstraction: #5
- Feishu/Lark support: #7
- Runtime adapters: #8
- Lifecycle support: #9
