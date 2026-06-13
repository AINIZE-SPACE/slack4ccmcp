# ChorusGate Planning Tracking

Status: planning index

This file maps the next-version planning docs to GitHub issues.

## Core Decisions

| Topic | Document | Issue |
| --- | --- | --- |
| Next-version roadmap | `docs/version-planning-2026-06.md` | #4 |
| Product positioning and open source | `docs/product-positioning.md` | #10 |
| Channel/gateway/runtime boundaries | `docs/architecture-boundaries.md` | #5 |
| Agent runtime adapter priorities | `docs/runtime-adapters.md` | #8 |

## Feature Tracks

| Track | Document | Issue |
| --- | --- | --- |
| Slack command/control surface | `docs/feature-slack-commands.md` | #3, #6 |
| Feishu/Lark channel support | `docs/feature-feishu.md` | #7 |
| Install/uninstall lifecycle | `docs/feature-install-lifecycle.md` | #9 |
| Durable event state and retry | `docs/roadmap.md` | #1 |
| Claude Code session host | `docs/roadmap.md` | #2 |
| MCP Web API-only contract | `docs/planning/v3-story-9-mcp-webapi-only.md` | #40 |

## Runtime Priority Summary

| Tier | Runtime | Why |
| --- | --- | --- |
| Tier 0 | Claude Code `claude -p` | Current default and compatibility baseline |
| Tier 1 | Claude Code session host | Required for approvals, command injection, and lower latency |
| Tier 1 | OpenClaw | Strong Feishu/Lark ecosystem and good multi-agent positioning |
| Tier 2 | Codex | Adds OpenAI/Codex-based coding workflows when unattended execution is stable |
| Tier 2 | OpenCode | Provider-flexible coding-agent option |
| Tier 2 | Custom command | Generic bridge for internal agents and scripts |
| Tier 3 | Gemini CLI, Aider, Qwen Code, private CLIs | Demand-driven only |

## Boundary Summary

- Channel providers own platform I/O.
- Gateway core owns routing, sessions, queueing, retries, traces, and command
  orchestration.
- Runtime adapters own agent execution, progress, cancellation, and control
  commands.

See `docs/architecture-boundaries.md` for the source of truth.
