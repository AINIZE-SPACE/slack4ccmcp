// ============================================================
// Session Store — maps a Slack scope to a persistent Claude session
//
// Each Slack scope (channel or thread) is bound to one Agent session
// UUID. The first turn creates the session (`claude -p --session-id <uuid>`);
// subsequent turns resume it (`claude -p --resume <uuid>`), so the model
// retains conversation context across messages.
//
// Persistence is a human-readable MARKDOWN TABLE at `memory/sessions.md`
// (git-tracked), NOT a database. This file holds ONLY routing metadata —
// the Slack scope → session UUID mapping. The actual conversation/memory
// lives in the Agent's own session storage (keyed by the UUID) and
// its memory md files; the gateway is a stateless meta router and never
// stores conversation content here.
//
// Cross-machine note: session UUIDs are local to the machine where Claude
// persisted them. If this map syncs to another machine via git, a `--resume`
// there won't find the UUID and gracefully starts a fresh session. That's
// fine — the map's value is versioning/audit/restart-durability on the host.
//
// STORY-4: Session key is now structured (SessionIdentity) to support
// multi-profile + multi-provider + multi-project isolation.
// ============================================================

import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const MEMORY_DIR = resolve(projectRoot, "memory");
const SESSIONS_MD = resolve(MEMORY_DIR, "sessions.md");

// ---- SessionIdentity (structured key, STORY-4) -------------------------------

/**
 * Structured session scope identity.
 *
 * Replaces the old flat string keys ("channel:C01") with a composite that
 * isolates sessions across profiles, providers, scopes, and projects.
 *
 * Serialised form (for Map keys and markdown):
 *   profileId:providerId:scopeType:scopeTarget[:threadTs][:projectDir]
 *
 * Examples:
 *   cc:claude:channel:C01
 *   cc:claude:thread:C01:1234.5678
 *   codex:codex:channel:C01
 */
export interface SessionIdentity {
  profileId: string;
  providerId: string;
  scopeType: "channel" | "thread";
  scopeTarget: string; // channel id
  threadTs?: string;
  projectDir?: string;
}

/** Serialize a SessionIdentity to a stable string key. */
export function formatIdentityKey(id: SessionIdentity): string {
  const parts = [
    id.profileId,
    id.providerId,
    id.scopeType,
    id.scopeTarget,
  ];
  if (id.threadTs) parts.push(id.threadTs);
  if (id.projectDir) parts.push(id.projectDir);
  return parts.join(":");
}

// Regex for parsing identity keys (backward compat with old flat keys).
const IDENTITY_RE =
  /^([^:]+):([^:]+):(channel|thread):([^:]+)(?::(\d+\.\d+))?(?::(.+))?$/;

/** Parse a serialised key back to SessionIdentity, or null for old-format keys. */
export function parseIdentityKey(key: string): SessionIdentity | null {
  // Old flat keys: "channel:XXX" or "XXX:thread_ts"
  const m = key.match(IDENTITY_RE);
  if (!m) return null;

  return {
    profileId: m[1],
    providerId: m[2],
    scopeType: m[3] as "channel" | "thread",
    scopeTarget: m[4],
    threadTs: m[5] || undefined,
    projectDir: m[6] || undefined,
  };
}

const MD_HEADER = `# Slack Scope → Session Map

每个 Slack scope（channel 或 thread）绑定一个持久 Agent session UUID。
gateway 用 \`claude -p --resume <uuid>\` 或 \`codex exec resume <tid>\` 续接。
本文件只存路由 meta —— 真正的对话/记忆在 Agent 自己的 session 存储里。
由 gateway 自动维护；可由 git 追踪。

| Profile | Provider | Scope Key | Session UUID | Project Dir | Started | Last Used |
|---------|----------|-----------|-------------|-------------|---------|-----------|
`;

export interface ThreadSession {
  /** Stable session UUID (CC: pre-generated UUID; Codex: codex-generated UUID). */
  sessionId: string;
  /** Structured identity for this session (STORY-4). */
  identity: SessionIdentity;
  /** Whether the first turn has run (decides --session-id vs --resume). */
  started: boolean;
  /** Epoch ms of last use, for idle eviction. */
  lastUsed: number;
}

export interface SessionStoreOptions {
  sessionsFile?: string;
  persistDebounceMs?: number;
}

export class SessionStore {
  private sessions = new Map<string, ThreadSession>();
  private persistTimer: NodeJS.Timeout | null = null;
  private readonly sessionsFile: string;
  private readonly memoryDir: string;
  private readonly persistDebounceMs: number;

  constructor(options: SessionStoreOptions = {}) {
    this.sessionsFile = options.sessionsFile ?? SESSIONS_MD;
    this.memoryDir = dirname(this.sessionsFile);
    this.persistDebounceMs = options.persistDebounceMs ?? 1000;
    this.load();
  }

  // ---- convenience builders (backward compat) --------------------------------

  /** Build a channel-scope identity for a profile. */
  channelIdentity(
    profileId: string,
    providerId: string,
    channel: string,
    projectDir?: string,
  ): SessionIdentity {
    return {
      profileId,
      providerId,
      scopeType: "channel",
      scopeTarget: channel,
      projectDir,
    };
  }

  /** Build a thread-scope identity for a profile. */
  threadIdentity(
    profileId: string,
    providerId: string,
    channel: string,
    threadTs: string,
    projectDir?: string,
  ): SessionIdentity {
    return {
      profileId,
      providerId,
      scopeType: "thread",
      scopeTarget: channel,
      threadTs,
      projectDir,
    };
  }

  /** @deprecated Use channelIdentity() instead. */
  channelKey(channel: string): string {
    return formatIdentityKey({
      profileId: "default",
      providerId: "claude",
      scopeType: "channel",
      scopeTarget: channel,
    });
  }

  /** @deprecated Use threadIdentity() instead. */
  threadKey(channel: string, threadTs: string): string {
    return formatIdentityKey({
      profileId: "default",
      providerId: "claude",
      scopeType: "thread",
      scopeTarget: channel,
      threadTs,
    });
  }

  // ---- core operations -------------------------------------------------------

  /**
   * Get the session for a scope identity, creating a fresh UUID mapping
   * if absent. Touches lastUsed and schedules a persist.
   */
  getOrCreate(id: SessionIdentity): ThreadSession {
    const key = formatIdentityKey(id);
    let session = this.sessions.get(key);
    if (!session) {
      session = {
        sessionId: randomUUID(),
        identity: id,
        started: false,
        lastUsed: Date.now(),
      };
      this.sessions.set(key, session);
    } else {
      session.lastUsed = Date.now();
    }
    this.schedulePersist();
    return session;
  }

  /** Mark a scope's session as started (first turn succeeded). */
  markStarted(id: SessionIdentity): void {
    const key = formatIdentityKey(id);
    const session = this.sessions.get(key);
    if (session) {
      session.started = true;
      session.lastUsed = Date.now();
      this.schedulePersist();
    }
  }

  /**
   * Reset a scope's session so the next turn starts fresh.
   * Accepts SessionIdentity or a plain string key (backward compat).
   */
  reset(id: SessionIdentity | string): void {
    const key = typeof id === "string" ? id : formatIdentityKey(id);
    if (this.sessions.delete(key)) {
      this.schedulePersist();
    }
  }

  /**
   * Explicitly bind a scope to an existing session UUID.
   * Accepts SessionIdentity or a plain string key (backward compat).
   */
  setSession(id: SessionIdentity | string, sessionId: string): void {
    const key = typeof id === "string" ? id : formatIdentityKey(id);
    const identity: SessionIdentity = typeof id === "string"
      ? (parseIdentityKey(key) ?? {
          profileId: "default",
          providerId: "claude",
          scopeType: "channel",
          scopeTarget: key,
        })
      : id;
    this.sessions.set(key, {
      sessionId,
      identity,
      started: true,
      lastUsed: Date.now(),
    });
    this.schedulePersist();
  }

  /** Evict mappings idle longer than maxAgeMs. Returns count removed. */
  evictIdle(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (session.lastUsed < cutoff) {
        this.sessions.delete(key);
        removed += 1;
      }
    }
    if (removed > 0) this.schedulePersist();
    return removed;
  }

  /** Number of tracked thread sessions. */
  size(): number {
    return this.sessions.size;
  }

  /** Snapshot of all tracked thread sessions (for status/list). */
  entries(): Array<{
    key: string;
    sessionId: string;
    identity: SessionIdentity;
    started: boolean;
    lastUsed: number;
  }> {
    return Array.from(this.sessions.entries()).map(([key, s]) => ({
      key,
      sessionId: s.sessionId,
      identity: s.identity,
      started: s.started,
      lastUsed: s.lastUsed,
    }));
  }

  // ---- persistence (markdown) ---------------------------------------------

  /** Load the mapping from memory/sessions.md (best effort). */
  load(): void {
    let text: string;
    try {
      text = readFileSync(this.sessionsFile, "utf8");
    } catch {
      return; // no file yet — start empty
    }
    try {
      for (const line of text.split("\n")) {
        const t = line.trim();
        // Table data rows start with "|" and aren't the header/separator.
        if (!t.startsWith("|")) continue;
        if (
          t.includes("Profile") ||
          t.includes("Scope Key") ||
          t.includes("Thread Key") ||
          t.includes("---")
        )
          continue;
        const cells = t
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
        if (cells.length < 4) continue;

        // New format (7 cols): Profile | Provider | Scope Key | Session UUID | Project Dir | Started | Last Used
        if (cells.length >= 7) {
          const [profileId, providerId, scopeKey, sessionId, projectDir, startedRaw, lastUsedRaw] = cells;
          if (!profileId || !sessionId) continue;
          // Parse the scope key back to identity components
          const identity = parseIdentityKey(scopeKey);
          const lastUsedMs = Date.parse(lastUsedRaw);
          this.sessions.set(scopeKey, {
            sessionId,
            identity: identity ?? {
              profileId,
              providerId,
              scopeType: "channel",
              scopeTarget: scopeKey,
              projectDir: projectDir || undefined,
            },
            started: startedRaw.toLowerCase() === "yes",
            lastUsed: Number.isNaN(lastUsedMs) ? Date.now() : lastUsedMs,
          });
          continue;
        }

        // Old format (6 cols): key | uuid | provider | projectDir | started | lastUsed
        if (cells.length >= 6) {
          const [oldKey, sessionId, provider, projectDir, startedRaw, lastUsedRaw] = cells;
          if (!oldKey || !sessionId) continue;
          const identity = parseIdentityKey(oldKey) ?? {
            profileId: "default",
            providerId: provider || "claude",
            scopeType: oldKey.startsWith("channel:") ? "channel" : "thread",
            scopeTarget: oldKey.replace(/^(channel:|[^:]+:\d+\.\d+$)/, "").split(":")[0] || oldKey,
            projectDir: projectDir || undefined,
          };
          // Rewrite old key to new structured format so getOrCreate() matches.
          const newKey = formatIdentityKey(identity);
          const lastUsedMs = Date.parse(lastUsedRaw);
          this.sessions.set(newKey, {
            sessionId,
            identity,
            started: startedRaw.toLowerCase() === "yes",
            lastUsed: Number.isNaN(lastUsedMs) ? Date.now() : lastUsedMs,
          });
          continue;
        }

        // Very old format (4 cols): key | uuid | started | lastUsed
        const [oldKey, sessionId, startedRaw, lastUsedRaw] = cells;
        if (!oldKey || !sessionId) continue;
        const identity = parseIdentityKey(oldKey) ?? {
          profileId: "default",
          providerId: "claude",
          scopeType: oldKey.startsWith("channel:") ? "channel" : "thread",
          scopeTarget: oldKey.replace("channel:", ""),
        };
        // Rewrite old key to new structured format so getOrCreate() matches.
        const newKey = formatIdentityKey(identity);
        const lastUsedMs = Date.parse(lastUsedRaw);
        this.sessions.set(newKey, {
          sessionId,
          identity,
          started: startedRaw.toLowerCase() === "yes",
          lastUsed: Number.isNaN(lastUsedMs) ? Date.now() : lastUsedMs,
        });
      }
    } catch (err) {
      console.error(
        "[session-store] WARNING: failed to parse memory/sessions.md, " +
          "starting with empty map:",
        (err as Error).message,
      );
      this.sessions.clear();
    }
  }

  /** Debounced persist — coalesces bursts of mutations into one write. */
  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, this.persistDebounceMs);
    this.persistTimer.unref?.();
  }

  /** Render the in-memory map to memory/sessions.md as a markdown table. */
  persist(): void {
    try {
      mkdirSync(this.memoryDir, { recursive: true });
      const rows = Array.from(this.sessions.entries())
        .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
        .map(([key, s]) => {
          const started = s.started ? "yes" : "no";
          const lastUsed = new Date(s.lastUsed).toISOString();
          const id = s.identity;
          const profileId = id.profileId || "default";
          const providerId = id.providerId || "claude";
          const scopeKey = key;
          const projectDir = id.projectDir || "";
          return `| ${profileId} | ${providerId} | ${scopeKey} | ${s.sessionId} | ${projectDir} | ${started} | ${lastUsed} |`;
        });
      writeFileSync(this.sessionsFile, MD_HEADER + rows.join("\n") + "\n");
    } catch (err) {
      console.error(
        "[session-store] WARNING: failed to write memory/sessions.md:",
        (err as Error).message
      );
    }
  }
}

/** Singleton session store. */
export const sessionStore = new SessionStore();
