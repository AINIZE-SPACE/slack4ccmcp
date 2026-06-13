// ============================================================
// ClaudeStreamProvider — 双向 stream-json 协议
//
// 使用 `claude -p --input-format stream-json --output-format stream-json`
// stdin 发送 JSON 消息（保持打开），stdout 解析 JSON 事件。
//
// 本模块导出两个 API：
//   1. claudeStreamProvider  — AgentProvider 接口实现（ONE-SHOT）：
//      createSession() / resumeSession() 是一次性的（spawn → stdin→end → 等结果）。
//      用于 GATEWAY_CLAUDE_MODE=stream + INTERACTIVE_PERMISSIONS=false 的简单模式。
//      与 legacy ClaudeProvider 语义一致：不保持 stdin 打开、不支持审批交互。
//
//   2. createStreamSession() — 双向会话（BIDIRECTIONAL）：
//      stdin 保持打开直到 close()，支持实时 sendPermissionResponse() 回写
//      approve/deny 响应。用于 GATEWAY_CLAUDE_MODE=stream + INTERACTIVE_PERMISSIONS=true
//      的完整审批流程。不要用 claudeStreamProvider 替代这个！！！
//
// 与单向 ClaudeProvider 的关键差异：
//   - stdin 不关闭（可回写 approve/deny）
//   - 解析 system.init 获取 session_id
//   - system.permission_request → 审批回调 → stdin 回写
//   - --replay-user-messages 回显用户消息（isReplay:true 忽略）
//
// MCP: `claude -p` 继承父进程环境，直接加载 `.claude/mcp.json`。
// ChorusGate MCP 固定为 Web API 工具集，不承担 Socket Mode 收事件。
//
// 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34)
// ============================================================

import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { ClaudeStreamParser } from "./claude-stream-parser.js";
import type {
  AgentProvider,
  CreateSessionOptions,
  ResumeSessionOptions,
  SessionOutput,
} from "./types.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// ---- env helper (per-profile token injection, STORY-7) -----------------------

function buildSpawnEnv(opts: CreateSessionOptions): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  if (opts.botToken) env.SLACK_BOT_TOKEN = opts.botToken;
  if (opts.appToken) env.SLACK_APP_TOKEN = opts.appToken;
  return env;
}

// ---- spawn helper ------------------------------------------------------------

interface StreamSpawnResult {
  child: ChildProcess;
  stdoutBuf: string;
  stderr: string;
  settled: boolean;
}

function spawnStream(
  args: string[],
  cwd: string,
  parser: ClaudeStreamParser,
  env?: Record<string, string | undefined>,
): StreamSpawnResult {
  const win = process.platform === "win32";
  const cmd = win
    ? `"${CLAUDE_BIN}" ${args
        .map((a) => (a.includes(" ") ? `"${a}"` : a))
        .join(" ")}`
    : CLAUDE_BIN;
  const spawnArgs = win ? [] : args;
  const opts: SpawnOptions = {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
    shell: win,
    windowsHide: true,
  };
  if (env) opts.env = env;
  const child = spawn(cmd, spawnArgs, opts);

  const result: StreamSpawnResult = {
    child,
    stdoutBuf: "",
    stderr: "",
    settled: false,
  };

  child.stdout!.on("data", (chunk) => {
    result.stdoutBuf += chunk.toString();
    const lines = result.stdoutBuf.split("\n");
    result.stdoutBuf = lines.pop() ?? "";
    for (const line of lines) parser.feed(line);
  });

  child.stderr!.on("data", (chunk) => {
    result.stderr += chunk.toString();
  });

  return result;
}

/** Send a JSON message on stdin and wait for the result. */
function streamToResult(
  spawnResult: StreamSpawnResult,
  timeoutMs: number,
): Promise<SessionOutput> {
  return new Promise((resolve) => {
    const { child, parser } = spawnResult as StreamSpawnResult & {
      parser: ClaudeStreamParser;
    };
    // parser is captured via closure below

    const timer = setTimeout(() => {
      if (spawnResult.settled) return;
      spawnResult.settled = true;
      child.kill("SIGKILL");
      resolve({
        ok: false, text: "", sessionId: (parser.init?.sessionId || ""),
        error: `claude stream timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.on("error", (err) => {
      if (spawnResult.settled) return;
      spawnResult.settled = true;
      clearTimeout(timer);
      resolve({
        ok: false, text: "", sessionId: "",
        error: `failed to spawn ${CLAUDE_BIN}: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      if (spawnResult.settled) return;
      spawnResult.settled = true;
      clearTimeout(timer);

      // flush trailing buffer
      if (spawnResult.stdoutBuf) parser.feed(spawnResult.stdoutBuf);

      const text = parser.getResultText();
      if (code === 0 && text) {
        resolve({ ok: true, text, sessionId: (parser.init?.sessionId || "") });
      } else if (code === 0 && !text) {
        resolve({
          ok: false, text: "", sessionId: (parser.init?.sessionId || ""),
          error: "claude stream exited 0 but produced no output",
        });
      } else {
        resolve({
          ok: false, text, sessionId: (parser.init?.sessionId || ""),
          error: `claude stream exited ${code}: ${spawnResult.stderr.trim().slice(0, 500)}`,
        });
      }
    });
  });
}

// ---- Provider ----------------------------------------------------------------

export const claudeStreamProvider: AgentProvider = {
  id: "claude-stream",
  bin: CLAUDE_BIN,

  async createSession(
    prompt: string,
    opts: CreateSessionOptions,
  ): Promise<SessionOutput> {
    // createSession is ALWAYS for new sessions (routed by generateReply).
    // Even if opts.sessionId is truthy (from sessionStore), use --session-id.
    const sessionId = opts.sessionId || crypto.randomUUID();
    const env = buildSpawnEnv(opts);
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--replay-user-messages",
      "--permission-mode", process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions",
      "--session-id", sessionId,
    ];

    const parser = new ClaudeStreamParser();
    parser.onProgress = opts.onProgress;
    parser.onSessionId = opts.onSessionId;

    const sr = spawnStream(args, opts.cwd, parser, env);

    // Send user prompt on stdin (keep pipe open for future approve/deny)
    const userMsg = JSON.stringify({
      type: "user",
      message: { role: "user", content: prompt },
    }) + "\n";
    sr.child.stdin?.write(userMsg);
    // NOTE: stdin NOT closed — open for approve/deny responses

    // Wait for result
    const result = await streamToResult(
      { ...sr, parser } as StreamSpawnResult & { parser: ClaudeStreamParser },
      opts.timeoutMs,
    );

    // Close stdin now that we have the result
    if (!sr.settled) sr.child.stdin?.end();

    return { ...result, sessionId: result.sessionId || sessionId };
  },

  async resumeSession(
    prompt: string,
    sessionId: string,
    opts: ResumeSessionOptions,
  ): Promise<SessionOutput> {
    const env = buildSpawnEnv(opts);
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--replay-user-messages",
      "--permission-mode", process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions",
      "--resume", sessionId,
    ];

    const parser = new ClaudeStreamParser();
    parser.onProgress = opts.onProgress;

    const sr = spawnStream(args, opts.cwd, parser, env);

    const userMsg = JSON.stringify({
      type: "user",
      message: { role: "user", content: prompt },
    }) + "\n";
    sr.child.stdin?.write(userMsg);

    const result = await streamToResult(
      { ...sr, parser } as StreamSpawnResult & { parser: ClaudeStreamParser },
      opts.timeoutMs,
    );

    if (!sr.settled) sr.child.stdin?.end();

    return { ...result, sessionId };
  },
};

// ---- StreamSession: bidirectional API for permission_request flow ----------

/**
 * 双向 stream-json session。
 *
 * 与 AgentProvider.createSession() 返回的 one-shot SessionOutput 不同，
 * ClaudeStreamSession 保持 stdin 打开，允许在 Claude 运行过程中通过
 * sendPermissionResponse() 回写 approve/deny 响应。
 *
 * 典型流程:
 *   const session = createStreamSession(prompt, opts);
 *   session.parser.onPermissionRequest = async (req) => {
 *     // Slack 发送审批按钮，用户点击后调用:
 *     session.sendPermissionResponse(req.requestId, true);
 *   };
 *   const result = await session.result;  // 等待最终结果
 *   session.close();
 */
export interface ClaudeStreamSession {
  /** session_id (从 system.init 解析或在 spawn 前预生成) */
  sessionId: string;
  /** 事件解析器 (可绑定 onPermissionRequest 等回调) */
  parser: ClaudeStreamParser;
  /** 最终结果 Promise */
  result: Promise<SessionOutput>;
  /** 发送权限响应回 Claude stdin */
  sendPermissionResponse(requestId: string, granted: boolean): void;
  /** 关闭 session (kill 进程 + 清理) */
  close(): void;
}

/**
 * 创建双向 stream-json session (stdin 保持打开)。
 *
 * 与 claudeStreamProvider.createSession() 不同:
 *   - 不等待最终结果即返回
 *   - stdin 保持打开直到 close() 调用
 *   - 可通过 sendPermissionResponse() 实时审批
 *   - onPermissionRequest 构造时绑定，避免 spawn 后竞态
 *
 * @param opts.onPermissionRequest 审批回调 — 必须在 spawn 前绑定，
 *   防止首条 permission_request 在回调注册前到达而丢失。
 */
export function createStreamSession(
  prompt: string,
  opts: CreateSessionOptions & {
    /** 审批回调 (构造时绑定以避免竞态) */
    onPermissionRequest?: (req: import("./claude-stream-parser.js").PermissionRequest) => void;
  },
): ClaudeStreamSession {
  // 区分新 session (--session-id) vs 续接已有 session (--resume)
  const isResume = !!opts.sessionId;
  const sessionId = opts.sessionId || crypto.randomUUID();
  const env = buildSpawnEnv(opts);
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--replay-user-messages",
    "--permission-mode", process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions",
    isResume ? "--resume" : "--session-id", sessionId,
  ];

  const parser = new ClaudeStreamParser();
  parser.onProgress = opts.onProgress;
  parser.onSessionId = opts.onSessionId;
  // P1-4 fix: 在 spawn 前绑定审批回调，消除竞态
  if (opts.onPermissionRequest) {
    parser.onPermissionRequest = opts.onPermissionRequest;
  }

  const sr = spawnStream(args, opts.cwd, parser, env);

  // Send user prompt on stdin (keep pipe open)
  const userMsg =
    JSON.stringify({
      type: "user",
      message: { role: "user", content: prompt },
    }) + "\n";
  if (sr.child.stdin) {
    sr.child.stdin.write(userMsg);
  } else {
    console.error("[claude-stream] WARNING: stdin is null, cannot write prompt");
  }

  const resultPromise = streamToResult(
    { ...sr, parser } as StreamSpawnResult & { parser: ClaudeStreamParser },
    opts.timeoutMs,
  );

  return {
    sessionId,
    parser,

    result: resultPromise,

    sendPermissionResponse(requestId: string, granted: boolean): void {
      if (sr.settled) {
        console.error(
          "[claude-stream] WARNING: session already settled, ignoring permission_response",
        );
        return;
      }
      const msg =
        JSON.stringify({
          type: "permission_response",
          request_id: requestId,
          granted,
        }) + "\n";
      if (sr.child.stdin) {
        sr.child.stdin.write(msg);
      } else {
        console.error(
          "[claude-stream] WARNING: stdin is null, cannot send permission_response",
        );
      }
    },

    close(): void {
      if (sr.settled) return;
      sr.settled = true;
      try {
        if (sr.child.stdin) sr.child.stdin.end();
      } catch {
        // ignore
      }
      sr.child.kill("SIGKILL");
    },
  };
}
