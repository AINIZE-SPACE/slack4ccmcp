# STORY-2: Codex Provider 实现

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P0 | 依赖：STORY-1
> 评审决策：详见 [#23](https://github.com/AINIZE-SPACE/chorusgate/issues/23)、[#29](https://github.com/AINIZE-SPACE/chorusgate/issues/29)

## 问题

实现 `CodexProvider`，让 gateway 能通过 `codex exec --json` 生成 Slack 回复，并把 Codex 的 session id 写回统一 SessionStore。

## M0 实测契约

### Session ID 是后发现的

CC 模式：gateway 预生成 UUID → `claude -p --session-id <uuid>` → spawn → 回复。

Codex 模式：gateway spawn `codex exec <prompt> --json` → Codex 生成 UUID 格式 session id → gateway 从 JSONL 的 `thread.started.thread_id` 解析并回写 SessionStore。

首次执行 fixture：`tests/fixtures/codex-hello.jsonl`

```jsonl
{"type":"thread.started","thread_id":"019ebaf3-9be4-7661-be3f-b2a8790363b5"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Hello!"}}
{"type":"turn.completed","usage":{"input_tokens":16903,"cached_input_tokens":4480,"output_tokens":6,"reasoning_output_tokens":0}}
```

关键点：

- `thread_id` 是 canonical 顶层字段，当前为 UUID 格式字符串。
- 可兼容旧/其他版本的 `thread.id`，但实现不能只按 `thread.id`。
- assistant 文本来自 `item.completed.item.type === "agent_message"` 的 `item.text`。
- 当前实测没有 `done` 事件，`turn.completed` 表示本轮结束。

### CLI 参数

本机 M0 实测中，`codex exec` 不接受 `--ask-for-approval`：

```text
error: unexpected argument '--ask-for-approval' found
```

因此 Phase 1 不在 `codex exec` 命令行传审批 flag，也不使用已废弃的 `--full-auto` 作为主路径。先使用最小可运行命令，把无审批/沙箱策略作为后续 provider config 探测项处理。

```bash
# 初次执行
codex exec <prompt> --json

# 续接执行
codex exec resume <thread_id> <prompt> --json
```

对应 CC 的 `permissionMode` 映射先保持 provider 内部语义，不直接映射到 Codex CLI flag：

| CC flag | Codex Phase 1 behavior |
|---------|------------------------|
| `--permission-mode bypassPermissions` | 不传审批 flag；后续按本机 CLI/config 能力探测 |
| `--permission-mode default` | 不传审批 flag；后续按本机 CLI/config 能力探测 |

### 认证环境

Codex 使用本机已登录的 Codex/ChatGPT 凭据，或在支持的版本中使用 `CODEX_API_KEY`。Gateway 需确保 Codex 子进程继承必要认证环境，但不要把 `OPENAI_API_KEY` 当作 `codex exec` 的唯一契约。

```env
CODEX_API_KEY=...
```

## 事件解析

```typescript
class CodexEventParser implements EventParser {
  private resultText = "";

  feed(line: string): void {
    const evt = JSON.parse(line);
    switch (evt.type) {
      case "thread.started":
        // canonical: thread_id; compat: evt.thread?.id
        this.onSessionId?.(evt.thread_id || evt.thread?.id);
        break;
      case "turn.started":
        this.onProgress?.("Codex 思考中...");
        break;
      case "item.completed":
        if (evt.item?.type === "agent_message" && typeof evt.item.text === "string") {
          this.resultText += evt.item.text;
        }
        // Forward-compatible fallback for older/nested content shapes.
        for (const block of evt.item?.content || []) {
          if (block.type === "output_text") this.resultText += block.text;
          if (block.type === "tool_use") this.onProgress?.(toolLabel(block.name));
        }
        break;
      case "turn.completed":
        // Final event for the current fixture shape.
        break;
    }
  }

  getResultText(): string {
    return this.resultText.trim();
  }
}
```

## MCP 配置格式

Phase 1 Codex 是 gateway-only；Codex Slack MCP tools 不阻塞 provider/session 路径。后续如果启用 Codex MCP tools，使用 TOML 格式 `config.toml`，直接复用只含 Web API 工具的 `chorusgate-mcp`。

```toml
[mcp_servers.slack]
command = "node"
args = ["E:\\path\\to\\chorusgate-mcp.mjs"]
default_tools_approval_mode = "approve"

[mcp_servers.slack.env]
SLACK_BOT_TOKEN = "xoxb-..."
SLACK_APP_TOKEN = "xapp-..."
```

## 验收标准

- [ ] M0 spike: 真实 `codex exec --json` 输出固化 JSONL fixture（`thread_id` 顶层 UUID 字段确认）
- [ ] `codex exec "say hello" --json` 正确 spawn + 解析
- [ ] `codex exec resume <tid> "reply" --json` 正确续接
- [ ] Parser 优先解析 `thread_id`，兼容 `thread.id`
- [ ] Parser 从 `item.completed.item.type="agent_message"` 的 `item.text` 获取最终文本
- [ ] 当前 fixture 没有 `done` 事件，parser 不依赖 `done`
