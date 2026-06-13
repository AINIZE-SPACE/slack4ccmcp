// ============================================================
// Slack Auto-Reply Gateway — standing daemon
//
// Unlike the MCP server (src/index.ts), which is a passive tool that
// Claude Code calls, this is a long-running process that drives itself:
// it listens on Socket Mode and, for each incoming @mention or DM,
// generates a reply via `claude -p` and posts it back to Slack.
//
// RUN THIS IN YOUR OWN TERMINAL (not from a sandboxed shell): the spawned
// `claude -p` inherits this process's network/auth, and only the native
// environment can reach the configured ANTHROPIC_BASE_URL.
//
// Reuses the connection + send primitives from the MCP server modules.
// ============================================================

import { bootstrap } from "./bootstrap.js";
import type { ProfileConfig } from "./profile-config.js";

const profiles = bootstrap();

import { getWebClient } from "./slack-clients.js";
import {
  getSocketManager,
  enrichEvent,
  type SocketManager,
  type SlashCommand,
  type BlockAction,
} from "./socket-manager.js";
import { eventStore } from "./event-store.js";
import { generateReply, generateReplyStream } from "./reply-engine.js";
import { sessionStore } from "./session-store.js";
import {
  PermissionTracker,
  buildApprovalBlocks,
} from "./permission-tracker.js";
import { detectCommand, handleCommand } from "./session-commands.js";
import { type SessionIdentity, formatIdentityKey } from "./session-store.js";
import {
  ensureGatewayDir,
  getPidFile,
  getStatusFile,
  type GatewayStatus,
} from "./gateway-paths.js";
import { writeFileSync, rmSync } from "node:fs";
import type { StoredEvent } from "./types.js";

// ============================================================
// Config
const CLAUDE_CWD = process.env.GATEWAY_CLAUDE_CWD || process.cwd();
const REPLY_TIMEOUT_MS = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS || 180_000);
// Long-task timeout (e.g. channel summary, multi-tool chains). Set
// GATEWAY_REPLY_TIMEOUT_MS_LONG to override; defaults to 2× the normal timeout.
const REPLY_TIMEOUT_MS_LONG = Number(
  process.env.GATEWAY_REPLY_TIMEOUT_MS_LONG || REPLY_TIMEOUT_MS * 2
);
console.error(
  `[gateway] REPLY_TIMEOUT_MS/REPLY_TIMEOUT_MS_LONG: ${REPLY_TIMEOUT_MS}/${REPLY_TIMEOUT_MS_LONG}`
);
// Max concurrent `claude -p` replies. Excess events queue and run as slots free.
const maxConcurrentRaw = Number(process.env.GATEWAY_MAX_CONCURRENT || 3);
const MAX_CONCURRENT =
  Number.isFinite(maxConcurrentRaw) && maxConcurrentRaw > 0
    ? Math.floor(maxConcurrentRaw)
    : 3;
// Evict thread→session mappings idle longer than this (default 24h).
const SESSION_IDLE_MS = Number(
  process.env.GATEWAY_SESSION_IDLE_MS || 24 * 60 * 60 * 1000
);
// Live progress updates (placeholder message edited in place). Set
// GATEWAY_PROGRESS=0 to disable and just post the final reply.
const PROGRESS_ENABLED = process.env.GATEWAY_PROGRESS !== "0";
// Session scope: "channel" (default) = one session per channel/DM;
// "thread" = one session per thread (falls back to channel for slash commands).
const SESSION_SCOPE = (
  process.env.GATEWAY_SESSION_SCOPE || "channel"
) as "channel" | "thread";
// Permission mode for spawned claude processes.
const PERMISSION_MODE =
  process.env.CLAUDE_PERMISSION_MODE || "bypassPermissions";

// Interactive permission approval: when CLAUDE_PERMISSION_MODE is NOT
// "bypassPermissions" (i.e. "default" or "acceptEdits"), the gateway will
// intercept permission_request events and post Slack buttons for approve/deny.
// Set GATEWAY_INTERACTIVE_PERMISSIONS=0 to disable this behavior even when
// permission mode would otherwise trigger it.
const INTERACTIVE_PERMISSIONS =
  process.env.GATEWAY_INTERACTIVE_PERMISSIONS !== "0" &&
  PERMISSION_MODE !== "bypassPermissions";

// M2: Claude 双向 stream-json 控制面
// 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34)
const STREAM_MODE = process.env.GATEWAY_CLAUDE_MODE === "stream";

// ---- multi-profile routing ---------------------------------------------------
// Build a lookup map from profile id → ProfileConfig for O(1) routing.
const profileMap = new Map<string, ProfileConfig>();
for (const p of profiles) {
  profileMap.set(p.id, p);
}

// Per-scope project directory overrides (set by /cc_new --project).
const scopeProjectOverrides = new Map<string, string>();

/** Get the CLI working directory for a profile. */
function profileCwd(profileId: string): string {
  return profileMap.get(profileId)?.cwd || CLAUDE_CWD;
}

/** Get the command prefix for a profile. */
function profilePrefix(profileId: string): string {
  return profileMap.get(profileId)?.commandPrefix || "cc";
}

/** Get the provider id for a profile. */
function profileProvider(profileId: string): string {
  return profileMap.get(profileId)?.providerId || "claude";
}

// Rotating heartbeat phrases shown while the agent works with no tool activity.
const HEARTBEAT_PHRASES = [
  "🤔 正在思考…",
  "🔍 分析中…",
  "🧩 整理中…",
  "📊 汇总结果中…",
  "✅ 审核结果中…",
];
const TOOL_LABEL_STICKY_MS = 6000;

// ============================================================
// Reply decision
// ============================================================

/**
 * Compute the session identity for a channel+thread+profile combination.
 * - "channel" scope (default): one shared session per channel/DM,
 *   EXCEPT assistant threads in DMs — each new chat (distinct thread_ts)
 *   gets its own session so "新聊天" always starts fresh.
 * - "thread" scope: one session per thread everywhere.
 * Slash commands always use channel scope (they carry no thread_ts).
 */
function sessionIdentity(
  channel: string,
  profileId: string,
  providerId: string,
  threadTs?: string,
  channelType?: string,
  projectDir?: string,
): SessionIdentity {
  // Check for a per-scope project dir override (set by /cc_new --project).
  const useThread =
    (SESSION_SCOPE === "thread" && threadTs) ||
    (channelType === "im" && threadTs);

  const scopeKey = useThread
    ? `thread:${channel}:${threadTs}`
    : `channel:${channel}`;
  const effectiveProjectDir =
    scopeProjectOverrides.get(scopeKey) ?? projectDir;

  if (useThread) {
    return sessionStore.threadIdentity(
      profileId, providerId, channel, threadTs!, effectiveProjectDir,
    );
  }
  return sessionStore.channelIdentity(
    profileId, providerId, channel, effectiveProjectDir,
  );
}

/** Decide whether a stored event warrants an auto-reply. */
function shouldReply(event: StoredEvent): boolean {
  // Skip system events: edits, deletions, assistant_thread_started, etc.
  if (event.subtype) return false;
  // Skip empty messages (no text, or whitespace/mention-only after cleaning)
  if (!cleanText(event.text || "")) return false;

  // Always reply to explicit @mentions (any channel)
  if (event.type === "app_mention") return true;

  // Reply to direct messages (DMs). channel_type lives on the raw payload.
  if (event.type === "message") {
    const channelType = (event.raw as Record<string, unknown> | undefined)
      ?.channel_type as string | undefined;
    if (channelType === "im") return true;
  }

  // Ignore plain channel chatter (not addressed to the bot) and reactions.
  return false;
}

// ============================================================
// Prompt construction
// ============================================================

/** Strip the leading <@BOTID> mention from text for a cleaner prompt. */
function cleanText(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

/**
 * Build the prompt sent to `claude -p`.
 *
 * When `resume` is true the Claude session already holds this thread's
 * history, so we send just the new message (lean). On a fresh session we
 * include light thread context + a persona/format preamble.
 */
async function buildPrompt(
  event: StoredEvent,
  resume: boolean
): Promise<string> {
  const userMsg = cleanText(event.text || "");
  const who = event.user_name || event.user || "a user";

  // Resuming: the model remembers the thread; just relay the new turn.
  if (resume) {
    return `(channel ${event.channel}) ${who} wrote: "${userMsg}"`;
  }

  const web = getWebClient();
  const where = event.channel_name ? `#${event.channel_name}` : "a DM";

  let context = "";
  // First turn in a thread that already has prior messages: seed context.
  const threadTs = event.thread_ts;
  if (threadTs && threadTs !== event.ts) {
    try {
      const res = await web.conversations.replies({
        channel: event.channel,
        ts: threadTs,
        limit: 8,
      });
      const msgs = (res.messages || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((m: any) => {
          const u = (m.user as string) || "?";
          const t = cleanText((m.text as string) || "");
          return t ? `${u}: ${t}` : "";
        })
        .filter(Boolean)
        .join("\n");
      if (msgs) context = `\n\nThread context so far:\n${msgs}`;
    } catch {
      // ignore — context is best-effort
    }
  }

  return [
    `You are ChorusGate, an AI assistant replying in Slack (${where}).`,
    `Current channel ID: ${event.channel}.`,
    `${who} wrote: "${userMsg}"`,
    context,
    "",
    "You have Slack tools (mcp__slack__*): read channel history, thread replies,",
    "list channels, look up users, post/react. Use them when the request needs",
    "Slack data (e.g. summarizing a channel — call slack_channel_history with the",
    "channel ID above). Do NOT claim you cannot read Slack.",
    "Write a concise, helpful Slack reply. Use Slack mrkdwn formatting.",
    "Reply with ONLY the message text — no preamble, no quotes around it.",
  ]
    .filter((s) => s !== undefined)
    .join("\n");
}

// ============================================================
// Event handler — with dedup, concurrency cap, and correct handled-timing
// ============================================================

// Events currently being processed (keyed by event.ts) — guards against
// Slack redelivery / socket reconnect causing a duplicate reply.
const inFlight = new Set<string>();

// Simple counting semaphore to cap concurrent `claude -p` spawns.
let running = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiters.push(resolve));
}

function releaseSlot(): void {
  running = Math.max(0, running - 1);
  const next = waiters.shift();
  if (next) {
    running += 1;
    next();
  }
}

// Per-scope serial queues. A scope maps to ONE Claude session, so its
// turns must run sequentially — two concurrent `claude -p --resume <same uuid>`
// would corrupt session state. We chain each scope's work on a promise;
// different scopes still run in parallel (bounded by the global semaphore).
const threadChains = new Map<string, Promise<void>>();

// M2: Permission tracker for interactive approve/deny via Slack buttons
const permissionTracker = new PermissionTracker();

/** Handle a native Slack slash command for session control. */
function onSlash(slashCmd: SlashCommand): void {
  const id = sessionIdentity(
    slashCmd.channelId,
    slashCmd.profileId,
    profileProvider(slashCmd.profileId),
    undefined, // slash commands always channel scope
    undefined,
    profileCwd(slashCmd.profileId),
  );
  const sKey = formatIdentityKey(id);
  const prefix = profilePrefix(slashCmd.profileId);
  const command = detectCommand(
    slashCmd.command + (slashCmd.text ? ` ${slashCmd.text}` : ""),
    prefix,
  );
  if (!command) {
    console.error(
      `[gateway] unrecognized slash command: ${slashCmd.command}` +
        ` (profile: ${slashCmd.profileId})`,
    );
    return;
  }

  // Build a project dir setter for the scope override map.
  const scopeKey = `channel:${slashCmd.channelId}`;
  const onSetProjectDir = (dir: string | undefined) => {
    if (dir) scopeProjectOverrides.set(scopeKey, dir);
    else scopeProjectOverrides.delete(scopeKey);
  };

  // Run on the channel's serial chain to avoid races with concurrent messages.
  const prev = threadChains.get(sKey) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    try {
      await handleCommand(command, id, { channel: slashCmd.channelId }, prefix, onSetProjectDir);
    } catch (err) {
      console.error(
        "[gateway] slash command handler failed:",
        (err as Error).message,
      );
    }
  });
  threadChains.set(sKey, next);
  void next.finally(() => {
    if (threadChains.get(sKey) === next) threadChains.delete(sKey);
  });
}

/** Entry point: enqueue an event onto its scope's serial chain. */
function onEvent(event: StoredEvent, profileId: string): void {
  if (!shouldReply(event)) {
    eventStore.markHandled(event.id);
    return;
  }

  // Dedup: skip Slack redelivery of an event we're already handling/queued.
  const dedupKey = event.ts || event.id;
  if (inFlight.has(dedupKey)) {
    eventStore.markHandled(event.id);
    return;
  }
  inFlight.add(dedupKey);

  const replyThreadTs = event.thread_ts || event.ts;
  const channelType = (event.raw as Record<string, unknown> | undefined)
    ?.channel_type as string | undefined;

  const providerId = profileProvider(profileId);
  const id = sessionIdentity(
    event.channel, profileId, providerId, replyThreadTs, channelType,
    profileCwd(profileId),
  );
  const tKey = formatIdentityKey(id);

  // Session commands bypass the
  // AI reply path — handle them directly, but still on the scope chain so
  // ordering/dedup stay consistent.
  const prefix = profilePrefix(profileId);
  const cmd = detectCommand(cleanText(event.text || ""), prefix);

  const prev = threadChains.get(tKey) ?? Promise.resolve();
  const next = prev
    .catch(() => {}) // a prior failure shouldn't break the chain
    .then(async () => {
      if (cmd) {
        const evtScopeKey = replyThreadTs
          ? `thread:${event.channel}:${replyThreadTs}`
          : `channel:${event.channel}`;
        const onSetProjectDir = (dir: string | undefined) => {
          if (dir) scopeProjectOverrides.set(evtScopeKey, dir);
          else scopeProjectOverrides.delete(evtScopeKey);
        };
        try {
          await handleCommand(cmd, id, {
            channel: event.channel,
            threadTs: replyThreadTs,
          }, prefix, onSetProjectDir);
        } catch (err) {
          console.error("[gateway] command failed:", (err as Error).message);
        } finally {
          eventStore.markHandled(event.id);
          inFlight.delete(dedupKey);
        }
        return;
      }
      return processEvent(event, id, tKey, replyThreadTs, profileId);
    });
  threadChains.set(tKey, next);
  // Clean up the map entry once this is the tail of the chain.
  void next.finally(() => {
    if (threadChains.get(tKey) === next) threadChains.delete(tKey);
  });
}

/** Process one event: reply via the scope's reused Claude session. */
async function processEvent(
  event: StoredEvent,
  id: SessionIdentity,
  tKey: string,
  replyThreadTs: string,
  profileId: string,
): Promise<void> {
  const web = getWebClient();
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let progressDone = false;
  let progressChain = Promise.resolve();
  let placeholderTs: string | undefined;

  // Use the long timeout for resume turns (established sessions tend to be
  // longer tasks — the user has already context-built). Fresh sessions get
  // the normal timeout. Both are configurable via env vars.
  const isResume = sessionStore.getOrCreate(id).started;
  // 动态读取 process.env 而非模块常量——ESM 导入链中可能有模块
  // 在 bootstrap()/loadEnv() 之前已读取默认值 180000。
  const _replyTimeoutMs = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS || 180_000);
  const _replyTimeoutMsLong = Number(process.env.GATEWAY_REPLY_TIMEOUT_MS_LONG || _replyTimeoutMs * 2);
  const timeoutMs = isResume ? _replyTimeoutMsLong : _replyTimeoutMs;

  // Wait for a global concurrency slot (queues if MAX_CONCURRENT reached).
  await acquireSlot();

  /** Stop heartbeat + wait for the progress update queue to drain. */
  const stopProgress = async (): Promise<void> => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    progressDone = true;
    await progressChain;
  };

  try {
    await enrichEvent(event); // resolve user_name / channel_name (best effort)

    const session = sessionStore.getOrCreate(id);
    const resume = session.started;
    console.error(
      `[gateway] reply (${running}/${MAX_CONCURRENT} slots, timeout ${timeoutMs / 1000}s) ` +
        `${resume ? "resume" : "new"} session ${session.sessionId.slice(0, 8)} ` +
        `for ${event.type} from ${event.user_name || event.user} in ` +
        `${event.channel_name || event.channel}`
    );

    const prompt = await buildPrompt(event, resume);

    // --- live progress: post a placeholder, then edit it in place ---
    let lastUpdate = 0;
    let lastLabel = "";
    let lastToolAt = 0;
    let hbIndex = 0;

    if (PROGRESS_ENABLED) {
      try {
        const ph = await web.chat.postMessage({
          channel: event.channel,
          thread_ts: replyThreadTs,
          text: HEARTBEAT_PHRASES[0],
        });
        placeholderTs = ph.ts as string | undefined;
      } catch {
        placeholderTs = undefined; // fall back to plain post at the end
      }
    }

    // Throttled in-place update of the placeholder message.
    const updatePlaceholder = (text: string, force = false): void => {
      if (!placeholderTs || progressDone) return;
      const now = Date.now();
      if (!force && now - lastUpdate < 1500) return; // throttle to dodge rate limits
      lastUpdate = now;
      progressChain = progressChain
        .then(async () => {
          if (progressDone || !placeholderTs) return;
          await web.chat.update({ channel: event.channel, ts: placeholderTs, text });
        })
        .catch(() => {});
    };

    // Heartbeat: rotate generic phrases so pure-reasoning turns still move.
    if (placeholderTs) {
      heartbeatTimer = setInterval(() => {
        hbIndex = (hbIndex + 1) % HEARTBEAT_PHRASES.length;
        const recentlyUsedTool = Date.now() - lastToolAt < TOOL_LABEL_STICKY_MS;
        updatePlaceholder(
          recentlyUsedTool && lastLabel ? lastLabel : HEARTBEAT_PHRASES[hbIndex]
        );
      }, 6000);
      heartbeatTimer.unref?.();
    }

    const profile = profileMap.get(profileId);
    const replyOpts = {
      timeoutMs,
      cwd: profileCwd(profileId),
      sessionId: session.sessionId,
      resume,
      profileId,
      botToken: profile?.botToken,
      appToken: profile?.appToken,
      onProgress: (label: string) => {
        lastLabel = label;
        lastToolAt = Date.now();
        updatePlaceholder(label, true);
      },
    };

    console.error(`[gateway] generating reply — timeoutMs=${timeoutMs} isResume=${isResume} replyOpts.timeoutMs=${replyOpts.timeoutMs}`);
    const result = INTERACTIVE_PERMISSIONS
      ? await generateReplyStream(prompt, {
          ...replyOpts,
          onPermission: async (req) => {
            // Post Slack interactive message with Approve/Deny buttons
            if (placeholderTs) {
              // Update the placeholder to show the permission request
              await stopProgress();
            }
            const blocks = buildApprovalBlocks(
              req.toolName,
              req.toolInput,
              req.requestId,
              event.user,             // P0-3: requesterUserId for auth
              REPLY_TIMEOUT_MS_LONG,  // P1-2: dynamic timeout text
            );
            try {
              await web.chat.postMessage({
                channel: event.channel,
                thread_ts: replyThreadTs,
                blocks,
                text: `Claude 请求执行 \`${req.toolName}\` — 需要你的批准`,
              });
            } catch (err) {
              console.error(
                "[gateway] failed to post approval message:",
                (err as Error).message,
              );
            }

            // Wait for user response (auto-denies after timeout)
            const granted = await permissionTracker.waitForApproval(
              req.requestId,
              {
                toolName: req.toolName,
                toolInput: req.toolInput,
                channel: event.channel,
                threadTs: replyThreadTs,
                requesterUserId: event.user,  // P0-3: store for auth check
              },
            );
            console.error(
              `[gateway] permission ${req.requestId} (${req.toolName}): ` +
                `${granted ? "approved" : "denied"}`,
            );
            return granted;
          },
        })
      : await generateReply(prompt, replyOpts);

    await stopProgress();

    if (result.ok) {
      sessionStore.markStarted(id);
    } else if (!resume) {
      sessionStore.reset(id);
    }

    const text = result.ok
      ? result.text
      : `:warning: 抱歉，我暂时无法生成回复（${result.error}）。`;

    if (placeholderTs) {
      await web.chat.update({
        channel: event.channel,
        ts: placeholderTs,
        text,
      });
    } else {
      await web.chat.postMessage({
        channel: event.channel,
        thread_ts: replyThreadTs,
        text,
      });
    }

    console.error(
      `[gateway] ${result.ok ? "replied" : "posted error notice"} to ` +
        `${event.channel} (thread ${replyThreadTs})`
    );
  } catch (err) {
    console.error("[gateway] reply failed:", (err as Error).message);
    // Drain the progress queue first so the placeholder is in a stable state,
    // then overwrite it with the error (rather than leaving it stuck on the
    // last tool label forever).
    await stopProgress();
    try {
      const errText = `:warning: 回复时出错：${(err as Error).message}`;
      if (placeholderTs) {
        await web.chat.update({
          channel: event.channel,
          ts: placeholderTs,
          text: errText,
        });
      } else {
        await web.chat.postMessage({
          channel: event.channel,
          thread_ts: replyThreadTs,
          text: errText,
        });
      }
    } catch {
      // give up
    }
  } finally {
    progressDone = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    eventStore.markHandled(event.id);
    inFlight.delete(event.ts || event.id);
    releaseSlot();
  }
}

// ============================================================
// Startup / shutdown
// ============================================================

async function main(): Promise<void> {
  console.error("[gateway] starting Slack auto-reply gateway...");
  console.error(`[gateway] claude cwd: ${CLAUDE_CWD}`);

  // Write PID file so the control commands (status/stop/restart) find us.
  ensureGatewayDir();
  const startedAt = Date.now();
  try {
    writeFileSync(getPidFile(), String(process.pid));
  } catch (err) {
    console.error(
      "[gateway] WARNING: could not write PID file:",
      (err as Error).message
    );
  }

  // Periodically write a runtime snapshot for `status` / `list`.
  const writeStatus = (): void => {
    const snapshot: GatewayStatus = {
      pid: process.pid,
      startedAt,
      updatedAt: Date.now(),
      activeSlots: running,
      maxConcurrent: MAX_CONCURRENT,
      sessions: sessionStore.entries(),
    };
    try {
      writeFileSync(getStatusFile(), JSON.stringify(snapshot, null, 2));
    } catch {
      // best effort
    }
  };
  writeStatus();
  const statusTimer = setInterval(writeStatus, 5000);
  statusTimer.unref?.();

  // Periodically evict idle thread→session mappings to bound memory.
  const evictTimer = setInterval(() => {
    const removed = sessionStore.evictIdle(SESSION_IDLE_MS);
    if (removed > 0) {
      console.error(
        `[gateway] evicted ${removed} idle session mapping(s); ` +
          `${sessionStore.size()} active`
      );
    }
  }, 30 * 60 * 1000);
  // Don't keep the process alive just for the eviction timer.
  evictTimer.unref?.();

  const socketManager = getSocketManager();
  socketManager.setEventCallback((event, profileId) => {
    // onEvent enqueues onto the thread's serial chain (non-blocking).
    onEvent(event, profileId);
  });
  socketManager.setSlashCallback(onSlash);
  if (INTERACTIVE_PERMISSIONS) {
    socketManager.setBlockActionCallback(async (action) => {
      // P0-3: 校验按钮点击者是否为审批发起者
      const result = permissionTracker.handleAction(action.actionValue);
      if (!result.handled) return;

      if (action.userId !== result.requesterUserId) {
        console.error(
          `[gateway] permission block_action from non-requester: ` +
          `${action.userId} (expected ${result.requesterUserId}), ignoring`,
        );
        return;
      }

      // P0-2: 替换审批按钮为"Approved/Denied by @user"，防止幽灵按钮
      const statusText = result.granted
        ? `✅ *Approved* by <@${action.userId}>`
        : `❌ *Denied* by <@${action.userId}>`;
      try {
        const webClient = getWebClient();
        await webClient.chat.update({
          channel: action.channelId,
          ts: action.messageTs,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: statusText },
            },
          ],
          text: statusText,
        });
      } catch (err) {
        console.error(
          "[gateway] failed to update approval message:",
          (err as Error).message,
        );
      }
    });
  }

  // Start all profiles — one Socket Mode connection per Slack app.
  await socketManager.startAll(profiles);

  console.error(
    "[gateway] listening on " +
      `${profiles.length} Slack app(s) — ` +
      `will auto-reply to @mentions and DMs. ` +
      `Sessions are reused per ${SESSION_SCOPE} scope. Ctrl+C to stop.`
  );
}

async function shutdown(): Promise<void> {
  console.error("[gateway] shutting down...");
  const socketManager = getSocketManager();
  await socketManager.stopAll();
  // Clean up control-plane files so `status` reports stopped.
  try {
    rmSync(getPidFile(), { force: true });
    rmSync(getStatusFile(), { force: true });
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[gateway] fatal:", (err as Error).message);
  process.exit(1);
});
