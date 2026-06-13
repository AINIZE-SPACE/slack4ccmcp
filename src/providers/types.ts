// ============================================================
// AgentProvider 接口 + 事件解析器抽象
//
// 让 gateway 能驱动多个 AI agent runtime（Claude Code、Codex 等），
// 不再硬编码 `claude -p` spawn 逻辑。
//
// 参见: docs/planning/v3-story-1-provider-abstraction.md
// 跟踪: [#22](https://github.com/AINIZE-SPACE/chorusgate/issues/22)
// ============================================================

// ---- Provider 接口 -----------------------------------------------------------

export interface CreateSessionOptions {
  cwd: string;
  timeoutMs: number;
  mcpConfigPath: string;
  permissionMode: string;
  /** 预分配的 session ID（CC: UUID，Codex: 留空，由 spawn 输出 thread_id 回填） */
  sessionId?: string;
  /** Per-profile Slack tokens for MCP config generation (STORY-7). */
  botToken?: string;
  appToken?: string;
  onProgress?: (label: string) => void;
  /** session ID 确定后回调（CC: spawn 前已知；Codex: spawn 后从 JSONL 回填） */
  onSessionId?: (sessionId: string) => void;
}

export interface ResumeSessionOptions extends CreateSessionOptions {
  // sessionId 由 provider 内部使用（CC: --resume, Codex: exec resume）
}

export interface SessionOutput {
  text: string;
  sessionId: string;
  ok: boolean;
  error?: string;
}

export interface AgentSessionInfo {
  sessionId: string;
  mtime: number;
  snippet: string;
}

export interface AgentProvider {
  /** 标识符: "claude" | "codex" */
  readonly id: string;

  /** CLI 可执行文件名 */
  readonly bin: string;

  /**
   * 首次创建 session：spawn agent，返回 session ID + 输出。
   * CC: 预生成 UUID → --session-id <uuid> → spawn
   * Codex: spawn → 从 JSONL thread.started.thread_id 解析 UUID
   */
  createSession(
    prompt: string,
    opts: CreateSessionOptions,
  ): Promise<SessionOutput>;

  /**
   * 续接已有 session。
   * CC: --resume <uuid>
   * Codex: codex exec resume <thread_id>
   */
  resumeSession(
    prompt: string,
    sessionId: string,
    opts: ResumeSessionOptions,
  ): Promise<SessionOutput>;

  /** 列出本机已有 session（用于 /sessions 等命令，暂未实现） */
  listSessions?(projectDir?: string): Promise<AgentSessionInfo[]>;

  /** 生成 MCP config 文件，返回文件路径 */
  generateMCPConfig?(): string;
}

// ---- EventParser 接口 --------------------------------------------------------

/** 流式事件解析器。每个 provider 实现自己的解析器，处理不同的 JSONL 格式。 */
export interface EventParser {
  /** 喂入一行 JSON 数据 */
  feed(line: string): void;

  /** 工具调用进度回调（如 "📖 读取频道消息中…"） */
  onProgress?: (label: string) => void;

  /** session ID 回调（Codex: thread_id 解析后回调；CC: 预生成后直接回调） */
  onSessionId?: (sessionId: string) => void;

  /** 获取最终回复文本 */
  getResultText(): string;
}

// ---- 工具标签映射（从 reply-engine.ts 提取，各 provider 共用）----------------

/** 将 MCP 工具名映射到中文进度标签。 */
export function toolLabel(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("channel_history") || n.includes("thread_replies"))
    return "📖 读取频道消息中…";
  if (n.includes("send_message") || n.endsWith("slack_reply"))
    return "✍️ 发送消息中…";
  if (n.includes("search")) return "🔍 搜索 Slack 中…";
  if (n.includes("list_channels") || n.includes("get_user"))
    return "📇 查询信息中…";
  if (n.includes("add_reaction")) return "👍 添加反应中…";
  if (n === "read" || n === "grep" || n === "glob")
    return "📂 查阅资料中…";
  if (n === "bash") return "⚙️ 执行命令中…";
  if (n === "websearch" || n === "webfetch") return "🌐 联网检索中…";
  if (n === "write" || n === "edit") return "📝 整理内容中…";
  const short = name.replace(/^mcp__[^_]+__/, "");
  return `🛠️ 处理中（${short}）…`;
}

// ---- 兼容类型（reply-engine.ts 旧接口）----------------------------------------

/** Legacy reply engine options (compat with gateway.ts) */
export interface ReplyEngineOptions {
  timeoutMs?: number;
  cwd?: string;
  sessionId?: string;
  resume?: boolean;
  /** Per-profile tokens (STORY-7). */
  botToken?: string;
  appToken?: string;
  onProgress?: (label: string) => void;
}

/** Legacy reply result */
export interface ReplyResult {
  ok: boolean;
  text: string;
  error?: string;
}
