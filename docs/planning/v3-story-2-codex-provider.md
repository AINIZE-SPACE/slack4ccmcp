# STORY-2: Codex Provider 实现

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P0 | 依赖：STORY-1
> 评审决策：详见 [#23](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/23)、[#29](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/29)

## 问题

实现 `CodexProvider`，让 gateway 能 spawn `codex exec` 生成回复。

## 关键差异点

### Session ID 是"后发现"的

CC 模式：gateway 预生成 UUID → `--session-id <uuid>` → spawn → 回复。

Codex 模式：gateway spawn `codex exec <prompt>` → Codex 内部生成 `thread_xxx` → gateway 从 JSONL 输出第一行解析 **`thread_id`**（canonical 字段）→ 回写 sessionStore。

**codex exec --json 的 JSONL 输出示例**（首次，参考官方手册）：
```jsonl
{"type":"thread.started","thread_id":"thread_abc123"}
{"type":"turn.started"}
{"type":"item.completed","content":[{"type":"output_text","text":"Hello world"}]}
{"type":"turn.completed"}
```

> :warning: **解析优先级**：`thread_id` 为 canonical 字段，兼容 `thread.id`。不要只按 `thread.id` 实现。

### 权限模式（已废弃 --full-auto）

`--full-auto` 已是 deprecated compatibility flag。新方案使用显式标志：

```bash
# 全自动（推荐）
codex exec <prompt> --json --sandbox workspace-write --ask-for-approval never

# 需要审批
codex exec <prompt> --json --ask-for-approval always
```

对应 CC 的 `--permission-mode` 映射：
| CC flag | Codex flag |
|---------|------------|
| `--permission-mode bypassPermissions` | `--ask-for-approval never` |
| `--permission-mode default` | `--ask-for-approval always` |

**session 续接** (resume)：
```bash
codex exec resume <thread_id> <prompt> --json --ask-for-approval never
```
注意：`resume` 是 `codex exec` 的**子命令**，提示词在 resume 之后。

### 权限模式

| 场景 | CC flag | Codex flag |
|------|---------|------------|
| 全自动 | `--permission-mode bypassPermissions` | `--ask-for-approval never` |
| 审批 | `--permission-mode default` | `--ask-for-approval always` |

### MCP 配置格式

Codex 使用 TOML 格式的 `config.toml`，不是 JSON 的 `.mcp.json`。

```toml
[mcp_servers.slack]
command = "node"
args = ["E:\\path\\to\\slack-socket-mcp.mjs"]

[mcp_servers.slack.env]
MCP_SENDER_ONLY = "1"
SLACK_BOT_TOKEN = "xoxb-..."
SLACK_APP_TOKEN = "xapp-..."

# 关键：headless 模式必须设这个，否则 MCP 工具被自动取消
default_tools_approval_mode = "approve"
```

**社区踩坑**：不加 `default_tools_approval_mode = "approve"`，headless `codex exec` 遇到 MCP 工具调用时自动 cancel，视为"用户取消了 MCP 工具调用"。

### 环境变量

Codex 需要 `OPENAI_API_KEY`（或 ChatGPT 登录 token）。Gateway 需确保这个变量能传到 codex 子进程。

```env
OPENAI_API_KEY=sk-...
```

### 事件解析

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
        this.onProgress?.("🤔 Codex 思考中…");
        break;
      case "item.completed":
        for (const block of evt.item.content || []) {
          if (block.type === "output_text") this.resultText += block.text;
          if (block.type === "tool_use") {
            this.onProgress?.(toolLabel(block.name));
          }
        }
        break;
      case "turn.completed":
        // 最终结果已收集完毕
        break;
    }
  }

  getResultText(): string { return this.resultText.trim(); }
}
```

## 验收标准

- [ ] M0 spike: 真实 `codex exec --json` 输出固化 JSONL fixture（thread_id 字段确认）
- [ ] `codex exec "say hello" --json --ask-for-approval never` 正确 spawn + 解析
- [ ] `codex exec resume <tid> "reply" --json --ask-for-approval never` 正确续接
- [ ] Parser 优先解析 `thread_id`，兼容 `thread.id`
- [ ] MCP config 生成 TOML 格式，含 `default_tools_approval_mode = "approve"`
- [ ] Codex MCP 工具调用不被自动取消
