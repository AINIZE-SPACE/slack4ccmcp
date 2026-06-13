# STORY-1: Agent Provider 抽象层

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P0

## 问题

当前 `reply-engine.ts` 硬编码了 `claude -p` 的 spawn 和 stream-json 解析逻辑。要支持 Codex，需要把"agent 执行"抽象出来。

## 方案

### Provider 接口

```typescript
interface AgentProvider {
  /** 标识符，用于 session store 和配置 */
  readonly id: string; // "claude" | "codex"
  
  /** CLI 可执行文件名 */
  readonly bin: string; // "claude" | "codex"
  
  /** 首次创建 session：spawn agent 并返回 session ID + 输出 */
  createSession(
    prompt: string,
    opts: CreateSessionOptions
  ): Promise<SessionOutput>;

  /** 续接已有 session */
  resumeSession(
    prompt: string, 
    sessionId: string,
    opts: ResumeSessionOptions
  ): Promise<SessionOutput>;

  /** 列出本机已有的 session */
  listSessions(projectDir?: string): Promise<AgentSessionInfo[]>;

  /** 生成 MCP config 文件，返回文件路径 */
  generateMCPConfig(): string;
}

interface CreateSessionOptions {
  cwd: string;
  timeoutMs: number;
  mcpConfigPath: string;
  permissionMode: string; // "bypassPermissions" | "acceptEdits" | "default"
  onProgress?: (label: string) => void;
  onSessionId?: (sessionId: string) => void; // Codex: thread_id (UUID) 从输出解析后回调
}

interface ResumeSessionOptions extends CreateSessionOptions {
  // sessionId 由 provider 内部使用
}

interface SessionOutput {
  text: string;
  sessionId: string; // CC: 预生成 UUID; Codex: 解析的 thread_id（UUID 格式，M0 已实测）
  ok: boolean;
  error?: string;
}
```

### 差异处理

| 维度 | Claude | Codex |
|------|--------|-------|
| 首次执行 | `claude -p --session-id <uuid>` | `codex exec <prompt> --json` |
| | UUID 预生成 → spawn | spawn → 解析 JSONL 拿到 `thread_id`（UUID 格式） |
| 续接执行 | `claude -p --resume <uuid>` | `codex exec resume <tid> <prompt> --json` |
| MCP 配置格式 | `.mcp.json` (JSON) | `config.toml` (TOML) 或 `--mcp-config` |
| 事件解析 | Claude stream-json (NDJSON, `type: "assistant"`) | Codex JSONL（M0 已实测：`thread.started`→`turn.started`→`item.completed`→`turn.completed`） |
| 权限标志 | `--permission-mode bypassPermissions` | Phase 1 不传 Codex 审批 flag；M0 实测 `codex exec` 不支持 `--ask-for-approval` |

### 解析器抽象

```typescript
interface EventParser {
  feed(line: string): void;
  onProgress?: (label: string) => void;
  onSessionId?: (sessionId: string) => void;
  getResultText(): string;
}
```

- `ClaudeEventParser`：现有 `toolLabel()` 逻辑迁移
- `CodexEventParser`：解析 `thread.started.thread_id` 和 `item.completed.item.type="agent_message"` / `item.text`

### 文件变更

| 文件 | 改动 |
|------|------|
| `src/providers/types.ts` | 新增，Provider 接口定义 |
| `src/providers/claude.ts` | 从 `reply-engine.ts` 提取 Claude spawn 逻辑 |
| `src/providers/codex.ts` | 新增，Codex spawn + JSONL 解析 |
| `src/reply-engine.ts` | 简化为调用 `agent.generateReply(prompt, opts)` |
| `src/event-parser.ts` | 新增，统一流事件解析接口 |

## 验收标准

- [ ] `ClaudeProvider` 能从任意 cwd spawn `claude -p`，和现有行为一致
- [ ] `CodexProvider` 能 spawn `codex exec --json`，正确解析 `thread_id`（UUID）和最终文本
- [ ] `reply-engine.ts` 通过 `AgentProvider` 接口调用，不依赖具体实现
- [ ] 现有 gateway 行为完全不变（向后兼容）
