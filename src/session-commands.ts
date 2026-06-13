// ============================================================
// Session commands - Slack-side control of gateway session bindings
//
// Command names are Slack-facing and derive from the configured prefix, while
// the stored session model stays prefix-agnostic:
//
//   /<prefix>_sessions       list sessions tracked in memory/sessions.md
//   /<prefix>_resume N|<uuid> bind THIS scope to session N (or a specific UUID)
//   /<prefix>_new            drop this scope's binding (next msg starts fresh)
//   /<prefix>_current        show this scope's bound session
//   /<prefix>help            list commands
//
// Source of truth is sessionStore (memory/sessions.md) - no .jsonl reading.
// ============================================================

import { getWebClient } from "./slack-clients.js";
import { sessionStore, type SessionIdentity, formatIdentityKey } from "./session-store.js";

/** Normalize a command prefix for use in command names. */
export function normalizePrefix(raw: string): string {
  return raw
    .trim()
    .replace(/^\/+/, "")
    .replace(/_+$/, "")
    .toLowerCase();
}

/** Get the command prefix — reads env at call time, falls back to "cc". */
function defaultPrefix(): string {
  return normalizePrefix(process.env.GATEWAY_COMMAND_PREFIX || "cc");
}

function commandName(base: string, prefix?: string): string {
  const p = prefix ?? defaultPrefix();
  return `${p}_${base}`;
}

function slashCommand(base: string, prefix?: string): string {
  return `/${commandName(base, prefix)}`;
}

function slashHelpCommand(prefix?: string): string {
  return `/${commandName("help", prefix)}`;
}

/** Context for posting a command response. */
export interface ReplyContext {
  /** Channel to post the response in. */
  channel: string;
  /** Thread timestamp; omit for a channel-level reply (no thread). */
  threadTs?: string;
}

export type Command =
  | { kind: "sessions" }
  | { kind: "resume"; arg: string; projectDir?: string }
  | { kind: "new"; projectDir?: string }
  | { kind: "current" }
  | { kind: "help" };

/** Parse --project <dir> from command args. Returns the dir or undefined. */
function parseProjectFlag(args: string): { arg: string; projectDir?: string } {
  const m = args.match(/^(.*?)\s*--project\s+(.+)$/);
  if (m) {
    return { arg: m[1].trim(), projectDir: m[2].trim() };
  }
  return { arg: args };
}

/** Detect a session command from message text. Returns null if not a command.
 *  @param text  The message text to parse.
 *  @param prefix  Optional command prefix for this profile (e.g. "cc" or "codex"). */
export function detectCommand(text: string, prefix?: string): Command | null {
  const t = text.trim();
  if (!t.startsWith("/")) return null;
  const [raw, ...rest] = t.slice(1).split(/\s+/);
  const cmd = raw.toLowerCase();
  const args = rest.join(" ").trim();

  switch (cmd) {
    case commandName("sessions", prefix):
    case "sessions":
    case "list":
      return { kind: "sessions" };
    case commandName("resume", prefix):
    case "resume":
    case "switch": {
      const { arg, projectDir } = parseProjectFlag(args);
      return { kind: "resume", arg, projectDir };
    }
    case commandName("new", prefix):
    case "new":
    case "reset": {
      const { projectDir } = parseProjectFlag(args);
      return { kind: "new", projectDir };
    }
    case commandName("current", prefix):
    case "current":
    case "whoami":
      return { kind: "current" };
    case commandName("help", prefix):
    case "help":
      return { kind: "help" };
    default:
      return null;
  }
}

function fmtTime(ms: number): string {
  if (!ms) return "??";
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Handle a session command and post the response to Slack.
 *  @param id     The structured session identity for this scope.
 *  @param prefix Optional command prefix for this profile's help text.
 *  @param onSetProjectDir  Called when --project changes the working dir. */
export async function handleCommand(
  cmd: Command,
  id: SessionIdentity,
  ctx: ReplyContext,
  prefix?: string,
  onSetProjectDir?: (dir: string | undefined) => void,
): Promise<void> {
  const web = getWebClient();
  const post = (text: string): Promise<unknown> =>
    web.chat.postMessage({
      channel: ctx.channel,
      ...(ctx.threadTs ? { thread_ts: ctx.threadTs } : {}),
      text,
    });

  const scopeKey = formatIdentityKey(id);
  const bound = sessionStore.entries().find((e) => e.key === scopeKey);

  switch (cmd.kind) {
    case "help": {
      await post(
        [
          "*Available commands:*",
          `\`${slashCommand("sessions", prefix)}\` - list known sessions`,
          `\`${slashCommand("resume", prefix)} N\` or \`${slashCommand("resume", prefix)} <uuid>\` - bind this scope to a known session`,
          `\`${slashCommand("new", prefix)}\` - reset this scope so the next message starts fresh`,
          `\`${slashCommand("current", prefix)}\` - show the session currently bound to this scope`,
          `\`${slashHelpCommand(prefix)}\` - show this help`,
        ].join("\n"),
      );
      return;
    }

    case "current": {
      if (!bound) {
        await post(
          "This channel or DM is not bound to a session yet. The next message will create one automatically."
        );
      } else {
        await post(
          `Current bound session: \`${bound.sessionId}\`\n` +
            `Last used: ${fmtTime(bound.lastUsed)}`
        );
      }
      return;
    }

    case "new": {
      sessionStore.reset(id);
      if (cmd.projectDir && onSetProjectDir) {
        onSetProjectDir(cmd.projectDir);
      } else if (onSetProjectDir) {
        onSetProjectDir(undefined);
      }
      const dirNote = cmd.projectDir
        ? `\nProject directory set to \`${cmd.projectDir}\`.`
        : "";
      await post(
        "Reset the current session binding. The next message will start a fresh session." +
          dirNote,
      );
      return;
    }

    case "sessions": {
      const all = sessionStore.entries().sort((a, b) => b.lastUsed - a.lastUsed);
      if (all.length === 0) {
        await post(
          "No known sessions yet. Send a message and the gateway will create one automatically."
        );
        return;
      }
      const lines = all.map((s, i) => {
        const mark = bound && bound.sessionId === s.sessionId ? "  <- current" : "";
        return (
          `${i + 1}. \`${s.sessionId.slice(0, 8)}...\`` +
          `  ${fmtTime(s.lastUsed)}` +
          `  \`${s.key}\`` +
          mark
        );
      });
      await post(
        `*Known sessions (${all.length}):*\n\n` +
          lines.join("\n") +
          `\n\nUse \`${slashCommand("resume", prefix)} N\` to switch to one of them.`,
      );
      return;
    }

    case "resume": {
      if (!cmd.arg) {
        await post(
          `Usage: \`${slashCommand("resume", prefix)} N\` or \`${slashCommand("resume", prefix)} <session-uuid>\`.`,
        );
        return;
      }
      const all = sessionStore.entries().sort((a, b) => b.lastUsed - a.lastUsed);
      let target: (typeof all)[number] | undefined;

      if (/^\d+$/.test(cmd.arg)) {
        target = all[Number(cmd.arg) - 1];
      } else {
        const a = cmd.arg.toLowerCase();
        target = all.find((s) => s.sessionId === a || s.sessionId.startsWith(a));
      }

      if (!target) {
        await post(
          `No session matched \`${cmd.arg}\`. Use \`${slashCommand("sessions", prefix)}\` to see the available choices.`,
        );
        return;
      }
      sessionStore.setSession(id, target.sessionId);
      if (cmd.projectDir && onSetProjectDir) {
        onSetProjectDir(cmd.projectDir);
      }
      const dirNote = cmd.projectDir
        ? `\nProject directory: \`${cmd.projectDir}\`.`
        : "";
      await post(
        `Switched this scope to session \`${target.sessionId.slice(0, 8)}...\`.` +
          dirNote +
          "\nSubsequent messages will continue in that session.",
      );
      return;
    }
  }
}
