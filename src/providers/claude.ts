// ============================================================
// ClaudeProvider — spawn `claude -p` via stdin, parse stream-json
//
// 从 reply-engine.ts 原有逻辑迁移，实现 AgentProvider 接口。
//
// MCP: `claude -p` 继承父进程环境，直接加载 `.claude/mcp.json`。
// ChorusGate MCP 只提供 Web API 工具，不再承担 Socket Mode 收事件。
// 因此 gateway 和 spawned claude 可以共享同一份 MCP 配置。
//
// 跟踪: [#22](https://github.com/AINIZE-SPACE/chorusgate/issues/22)
// ============================================================

import { spawn, type SpawnOptions } from "node:child_process";
import { ClaudeEventParser } from "./claude-parser.js";
import type {
  AgentProvider,
  CreateSessionOptions,
  ResumeSessionOptions,
  SessionOutput,
} from "./types.js";

const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";

// ---- spawn helper ------------------------------------------------------------

/** Build spawn env, injecting per-profile tokens when provided (STORY-7). */
function buildSpawnEnv(opts: CreateSessionOptions): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  // Per-profile: override tokens so spawned claude picks up the right Slack app.
  if (opts.botToken) env.SLACK_BOT_TOKEN = opts.botToken;
  if (opts.appToken) env.SLACK_APP_TOKEN = opts.appToken;
  return env;
}

function spawnClaude(
  bin: string,
  args: string[],
  prompt: string,
  cwd: string,
  timeoutMs: number,
  parser: ClaudeEventParser,
  env?: Record<string, string | undefined>,
): Promise<SessionOutput> {
  return new Promise<SessionOutput>((resolve) => {
    const win = process.platform === "win32";
    const cmd = win
      ? `"${bin}" ${args
          .map((a) => (a.includes(" ") ? `"${a}"` : a))
          .join(" ")}`
      : bin;
    const spawnArgs = win ? [] : args;
    const opts: SpawnOptions = {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      shell: win,
      windowsHide: true,
    };
    if (env) opts.env = env;

    const child = spawn(cmd, spawnArgs, opts);

    child.stdin!.write(prompt);
    child.stdin!.end();

    let stdoutBuf = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({
        ok: false,
        text: "",
        sessionId: "",
        error: `claude -p timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout!.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split("\n");
      stdoutBuf = lines.pop() ?? "";
      for (const line of lines) parser.feed(line);
    });

    child.stderr!.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        text: "",
        sessionId: "",
        error: `failed to spawn ${CLAUDE_BIN}: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (stdoutBuf) parser.feed(stdoutBuf);

      const text = parser.getResultText();
      if (code === 0 && text) {
        resolve({ ok: true, text, sessionId: "" });
      } else if (code === 0 && !text) {
        resolve({
          ok: false,
          text: "",
          sessionId: "",
          error: "claude -p exited 0 but produced no output",
        });
      } else {
        resolve({
          ok: false,
          text,
          sessionId: "",
          error: `claude -p exited ${code}: ${stderr.trim().slice(0, 500)}`,
        });
      }
    });
  });
}

// ---- Provider ----------------------------------------------------------------

export const claudeProvider: AgentProvider = {
  id: "claude",
  bin: CLAUDE_BIN,

  async createSession(
    prompt: string,
    opts: CreateSessionOptions,
  ): Promise<SessionOutput> {
    const sessionId = opts.sessionId || crypto.randomUUID();
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode",
      process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions",
      "--session-id", sessionId,
    ];

    const parser = new ClaudeEventParser();
    parser.onProgress = opts.onProgress;
    parser.onSessionId = opts.onSessionId;

    const env = buildSpawnEnv(opts);
    return spawnClaude(CLAUDE_BIN, args, prompt, opts.cwd, opts.timeoutMs, parser, env).then(
      (r) => ({ ...r, sessionId: r.sessionId || sessionId }),
    );
  },

  async resumeSession(
    prompt: string,
    sessionId: string,
    opts: ResumeSessionOptions,
  ): Promise<SessionOutput> {
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--permission-mode",
      process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions",
      "--resume", sessionId,
    ];

    const parser = new ClaudeEventParser();
    parser.onProgress = opts.onProgress;

    const env = buildSpawnEnv(opts);
    return spawnClaude(CLAUDE_BIN, args, prompt, opts.cwd, opts.timeoutMs, parser, env).then(
      (r) => ({ ...r, sessionId }),
    );
  },
};
