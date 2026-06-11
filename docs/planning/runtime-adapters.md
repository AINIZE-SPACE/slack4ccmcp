# Agent Runtime Adapters

Status: planning

## Runtime Strategy

Claude Code remains the default because this repository already works through
`claude -p`. The next version should make that default explicit, then add other
runtimes only when they bring a real product advantage.

Runtime support should be capability-based. The gateway should not assume every
runtime can approve tool calls, stream tool events, cancel work, or resume a
session.

## Priority Tiers

### Tier 0: Claude Code

Why:

- Current implementation already depends on it.
- It is the baseline behavior existing users expect.
- It validates the runtime interface with minimal product risk.

Required capabilities:

- Start a turn with `claude -p`.
- Resume or create sessions.
- Stream progress from `stream-json`.
- Cancel spawned process.
- Report CLI availability and version.

### Tier 1: Claude Code Session Host

Why:

- Required for `/approve`, `/deny`, `/compress`, `/branch`, `/edit`, and other
  interactive controls.
- Reduces spawn overhead.
- Makes Slack/Feishu feel like a real remote console for an agent session.

Risks:

- More process management complexity.
- Requires careful stdin/stdout multiplexing and crash recovery.

### Tier 1: OpenClaw

Why:

- Strong fit for the broader product direction.
- Local evidence shows OpenClaw already has a strong Feishu/Lark plugin with
  channel registration, websocket monitoring, reactions, commands, cards,
  streaming, and broad work tools.
- OpenClaw can be either a runtime backend or a source of channel adapter
  patterns.

Recommended first step:

- Add an OpenClaw runtime spike that can start work, stream progress, and report
  health.
- Do not duplicate OpenClaw's Feishu tool surface inside gateway core.

### Tier 2: Codex

Why:

- Useful for users who want OpenAI/Codex-based coding workflows in the same
  channel gateway.
- Strengthens the "multi-agent gateway" position beyond the Claude ecosystem.
- Supplements the official Codex Slack app when the desired behavior is a
  local, always-on bot that can react to channel mentions or DMs through this
  gateway instead of creating cloud tasks only through the official Slack app.

Entry condition:

- A stable local CLI or API execution path is available for unattended turns.
- The runtime can provide enough progress/status information to be useful in a
  channel.
- Local execution is explicitly configured with sandbox and approval behavior
  suitable for unattended Slack/Feishu-triggered work.

Possible adapter paths:

- `codex exec --json`: simplest one-turn runtime adapter. Good for summaries,
  triage, diagnostics, and scripted tasks. It can stream JSONL events and print a
  final answer.
- `codex app-server`: richer integration path for conversations, approvals,
  streamed events, steering, interrupt, and thread lifecycle. Better for a
  serious channel runtime, but more complex than `codex exec`.

Not the same as:

- Official Codex Slack app behavior, which starts Codex cloud tasks from Slack
  mentions and posts task links/results according to workspace settings.

### Tier 2: OpenCode

Why:

- Good community/open-source complement to Claude Code.
- Useful for users who want a provider-flexible coding agent.

Entry condition:

- CLI supports non-interactive turn execution, workspace cwd, session continuity,
  and reasonable cancellation behavior.

### Tier 2: Custom Command Runtime

Why:

- Gives power users an escape hatch.
- Lets the gateway support local scripts, internal agents, or experimental CLIs
  without first-class code changes.

Shape:

- Config-driven command template.
- stdin prompt support.
- stdout/stderr streaming.
- optional JSON event protocol for richer progress.

### Tier 3: Other Agent CLIs

Candidates can include Gemini CLI, Aider, Qwen Code, or internal company agents.

Add them only when:

- There is a real user need.
- They can run locally or self-hosted.
- They support non-interactive execution.
- Their session and cancellation semantics can be mapped cleanly.

## Runtime Capability Matrix

| Runtime | Priority | Start turn | Resume | Stream progress | Cancel | Control commands | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code `claude -p` | Tier 0 | yes | yes | yes | process kill | no | Current default |
| Claude Code session host | Tier 1 | yes | yes | yes | yes | yes | Needed for approvals |
| OpenClaw | Tier 1 | spike | spike | spike | spike | spike | Also informs Feishu adapter |
| Codex | Tier 2 | research | research | research | research | research | Add if stable unattended path exists |
| OpenCode | Tier 2 | research | research | research | research | research | Provider-flexible candidate |
| Custom command | Tier 2 | yes | optional | stdout/stderr | process kill | optional | Generic escape hatch |
| Other CLIs | Tier 3 | case-by-case | case-by-case | case-by-case | case-by-case | case-by-case | Demand-driven |

## Runtime Adapter Contract

```ts
interface RuntimeCapabilities {
  resume: boolean;
  streaming: boolean;
  cancellation: boolean;
  controlCommands: Array<"approve" | "deny" | "compress" | "branch" | "edit">;
  fileContext: boolean;
  toolEvents: boolean;
}

interface RuntimeTurnInput {
  turnId: string;
  session: RuntimeSessionRef;
  cwd: string;
  prompt: string;
  attachments: RuntimeAttachment[];
  env: Record<string, string>;
}

type RuntimeEvent =
  | { kind: "started"; turnId: string; sessionId?: string }
  | { kind: "progress"; message: string }
  | { kind: "tool"; name: string; status: "started" | "done" | "failed" }
  | { kind: "output"; text: string; partial: boolean }
  | { kind: "completed"; text: string; sessionId?: string }
  | { kind: "failed"; message: string; retryable: boolean };
```

## Tracking

- Runtime adapters epic: #8
- Session host: #2
- Slack command controls: #6
- Feishu/Lark channel: #7
