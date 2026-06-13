// ============================================================
// Socket Mode Connection Manager — multi-profile support
//
// SocketManager manages one SocketModeClient per Slack app profile.
// Each profile gets independent tokens, WebClient, bot identity,
// and event routing so two Slack apps (e.g. CC + Codex) can run
// concurrently without event leakage.
//
// Backward compat: startSocketMode() / stopSocketMode() are kept
// as convenience wrappers for single-profile callers (MCP server).
//
// 跟踪: [#24](https://github.com/AINIZE-SPACE/chorusgate/issues/24)
// 跟踪: [#30](https://github.com/AINIZE-SPACE/chorusgate/issues/30)
// ============================================================

import { SocketModeClient, LogLevel } from "@slack/socket-mode";
import { eventStore } from "./event-store.js";
import {
  createSlackClientSet,
  type SlackClientSet,
} from "./slack-clients.js";
import type { ProfileConfig } from "./profile-config.js";
import type { StoredEvent, SlackEventType } from "./types.js";

// ---- callbacks (profile-aware) ----------------------------------------------

/** Called for every stored Slack event.  profileId tells the gateway which app. */
export type EventCallback = (event: StoredEvent, profileId: string) => void;

/** A Slack slash command received over Socket Mode. */
export interface SlashCommand {
  command: string;
  text: string;
  channelId: string;
  userId: string;
  userName?: string;
  /** Which profile (Slack app) received this command. */
  profileId: string;
}
export type SlashCallback = (cmd: SlashCommand) => void | Promise<void>;

/** A block_actions interaction (e.g. Approve/Deny button click). */
export interface BlockAction {
  type: "block_actions";
  channelId: string;
  userId: string;
  actionValue: string;
  actionId: string;
  messageTs: string;
  /** Which profile (Slack app) received this action. */
  profileId: string;
}
export type BlockActionCallback = (
  action: BlockAction,
) => void | Promise<void>;

// ---- internal per-profile state ---------------------------------------------

interface RunningProfile {
  config: ProfileConfig;
  clients: SlackClientSet;
  socket: SocketModeClient;
  botUserId: string | null;
}

// ---- SocketManager ----------------------------------------------------------

export class SocketManager {
  private profiles = new Map<string, RunningProfile>();

  private onEvent: EventCallback | null = null;
  private onSlash: SlashCallback | null = null;
  private onBlockAction: BlockActionCallback | null = null;

  // ---- configuration --------------------------------------------------------

  /** Set the global event callback (called for all profiles). */
  setEventCallback(cb: EventCallback): void {
    this.onEvent = cb;
  }

  /** Set the global slash-command callback. */
  setSlashCallback(cb: SlashCallback): void {
    this.onSlash = cb;
  }

  /** Set the global block-action callback. */
  setBlockActionCallback(cb: BlockActionCallback): void {
    this.onBlockAction = cb;
  }

  // ---- lifecycle ------------------------------------------------------------

  /** Start a single profile — create SocketModeClient, register handlers. */
  async startProfile(config: ProfileConfig): Promise<void> {
    if (this.profiles.has(config.id)) {
      console.error(
        `[socket-manager] profile '${config.id}' already running, skipping`,
      );
      return;
    }

    const clients = createSlackClientSet({
      botToken: config.botToken,
      appToken: config.appToken,
    });

    // Resolve our own bot user ID to filter self-messages
    let botUserId: string | null = null;
    try {
      const auth = await clients.web.auth.test();
      botUserId = auth.user_id ?? null;
      console.error(
        `[socket-manager] profile '${config.id}': bot user ID = ${botUserId}`,
      );
    } catch (err) {
      console.error(
        `[socket-manager] profile '${config.id}': failed to resolve bot user ID, ` +
          `self-message filtering disabled: ${(err as Error).message}`,
      );
    }

    const socket = new SocketModeClient({
      appToken: clients.appToken,
      logLevel: LogLevel.INFO,
    });

    const rp: RunningProfile = { config, clients, socket, botUserId };
    this.profiles.set(config.id, rp);

    // Wire Socket Mode lifecycle events
    socket.on("connecting", () => {
      console.error(
        `[socket-manager] profile '${config.id}': connecting to Slack...`,
      );
    });
    socket.on("connected", () => {
      console.error(
        `[socket-manager] profile '${config.id}': Socket Mode connected`,
      );
    });
    socket.on("ready", () => {
      console.error(
        `[socket-manager] profile '${config.id}': ready, listening for events`,
      );
    });
    socket.on("disconnecting", () => {
      console.error(
        `[socket-manager] profile '${config.id}': disconnecting...`,
      );
    });
    socket.on("reconnecting", () => {
      console.error(
        `[socket-manager] profile '${config.id}': reconnecting...`,
      );
    });
    socket.on("error", (error) => {
      console.error(
        `[socket-manager] profile '${config.id}': Socket Mode error: ` +
          (error as Error).message,
      );
    });

    // ---- Slack event handlers (profile-scoped) ----------------------------

    const pid = config.id;

    socket.on("app_mention", async ({ event, ack }) => {
      await this.handleSlackEvent("app_mention", event, pid, clients, botUserId);
      await ack();
    });

    socket.on("message", async ({ event, ack }) => {
      // Skip messages from our own bot
      if (botUserId && (event as Record<string, unknown>).user === botUserId) {
        await ack();
        return;
      }
      // Skip bot_message subtypes from other bots
      const subtype = (event as Record<string, unknown>).subtype as
        | string
        | undefined;
      if (subtype === "bot_message") {
        await ack();
        return;
      }
      await this.handleSlackEvent("message", event, pid, clients, botUserId);
      await ack();
    });

    socket.on("reaction_added", async ({ event, ack }) => {
      await this.handleSlackEvent(
        "reaction_added",
        event,
        pid,
        clients,
        botUserId,
      );
      await ack();
    });

    // Slash commands — ack immediately (3s timeout), then dispatch
    socket.on("slash_commands", async ({ body, ack }) => {
      await ack();
      if (this.onSlash) {
        const cmd: SlashCommand = {
          command: (body.command as string) || "",
          text: ((body.text as string) || "").trim(),
          channelId: (body.channel_id as string) || "",
          userId: (body.user_id as string) || "",
          userName: (body.user_name as string) || undefined,
          profileId: pid,
        };
        try {
          await this.onSlash(cmd);
        } catch (err) {
          console.error(
            `[socket-manager] profile '${pid}': slash command handler error: ` +
              (err as Error).message,
          );
        }
      }
    });

    // Interactive messages (block_actions)
    socket.on("interactive", async ({ body, ack }) => {
      const payload = body as Record<string, unknown>;
      if (payload.type !== "block_actions") {
        await ack();
        return;
      }
      await ack();
      if (!this.onBlockAction) return;

      const actions = payload.actions as Array<Record<string, unknown>> | undefined;
      if (!actions || actions.length === 0) return;

      for (const action of actions) {
        const ch = payload.channel as Record<string, unknown> | undefined;
        const usr = payload.user as Record<string, unknown> | undefined;
        const msg = payload.message as Record<string, unknown> | undefined;
        const container = payload.container as Record<string, unknown> | undefined;
        const blockAction: BlockAction = {
          type: "block_actions",
          channelId: ((ch?.id || payload.channel_id || "") as string),
          userId: ((usr?.id || payload.user_id || "") as string),
          actionValue: (action.value as string) || "",
          actionId: (action.action_id as string) || "",
          messageTs: ((msg?.ts || container?.message_ts || "") as string),
          profileId: pid,
        };
        try {
          await this.onBlockAction(blockAction);
        } catch (err) {
          console.error(
            `[socket-manager] profile '${pid}': block_action handler error: ` +
              (err as Error).message,
          );
        }
      }
    });

    await socket.start();
  }

  /** Start all profiles from a parsed config list. */
  async startAll(configs: ProfileConfig[]): Promise<void> {
    const results = await Promise.allSettled(
      configs.map((c) => this.startProfile(c)),
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        console.error(
          `[socket-manager] profile '${configs[i].id}': failed to start — ` +
            (r.reason as Error).message,
        );
      }
    }
    const started = [...this.profiles.keys()];
    if (started.length === 0) {
      throw new Error("No profiles could be started. Check your configuration.");
    }
    console.error(
      `[socket-manager] ${started.length} profile(s) started: ${started.join(", ")}`,
    );
  }

  /** Stop a single profile. */
  async stopProfile(id: string): Promise<void> {
    const rp = this.profiles.get(id);
    if (!rp) return;
    await rp.socket.disconnect();
    this.profiles.delete(id);
    console.error(`[socket-manager] profile '${id}': stopped`);
  }

  /** Stop all running profiles. */
  async stopAll(): Promise<void> {
    const ids = [...this.profiles.keys()];
    await Promise.all(ids.map((id) => this.stopProfile(id)));
  }

  /** Number of running profiles. */
  get profileCount(): number {
    return this.profiles.size;
  }

  /** Get the bot user ID for a profile. */
  getBotUserId(profileId: string): string | null {
    return this.profiles.get(profileId)?.botUserId ?? null;
  }

  // ---- event conversion ------------------------------------------------------

  private async handleSlackEvent(
    type: SlackEventType,
    rawEvent: unknown,
    profileId: string,
    _clients: SlackClientSet,
    _botUserId: string | null,
  ): Promise<void> {
    try {
      const evt = rawEvent as Record<string, unknown>;
      const item = evt.item as Record<string, unknown> | undefined;

      const stored = eventStore.push({
        type,
        subtype: evt.subtype as string | undefined,
        channel:
          (evt.channel as string) || (item?.channel as string) || "",
        user: (evt.user as string) || "",
        text: (evt.text as string) || "",
        ts: (evt.ts as string) || (evt.event_ts as string) || "",
        thread_ts: evt.thread_ts as string | undefined,
        reaction: evt.reaction as string | undefined,
        reaction_user: evt.user as string | undefined,
        reaction_item_channel: item?.channel as string | undefined,
        reaction_item_ts: item?.ts as string | undefined,
        user_name: undefined,
        channel_name: undefined,
        profileId,
        raw: rawEvent,
      });

      console.error(
        `[socket-manager] profile '${profileId}': event stored — ` +
          `${stored.type} from ${stored.user} in ${stored.channel} (id: ${stored.id})`,
      );

      if (this.onEvent) {
        this.onEvent(stored, profileId);
      }
    } catch (err) {
      console.error(
        `[socket-manager] profile '${profileId}': error handling event: ` +
          (err as Error).message,
      );
    }
  }
}

// ---- singleton (multi-profile gateway uses one instance) ---------------------

let _instance: SocketManager | null = null;

/** Get or create the shared SocketManager instance. */
export function getSocketManager(): SocketManager {
  if (!_instance) {
    _instance = new SocketManager();
  }
  return _instance;
}

// ---- backward-compat wrappers (MCP server mode) -----------------------------

// 注意：以下函数仅为 MCP server 模式（src/index.ts）保留向后兼容。
// Gateway 模式应使用 SocketManager 多 profile API。

let _legacySocket: SocketModeClient | null = null;

/** Resolve user/channel names for a stored event (best effort). */
export async function enrichEvent(event: StoredEvent): Promise<StoredEvent> {
  // MCP server mode uses the legacy singleton web client.
  const { getWebClient } = await import("./slack-clients.js");
  const web = getWebClient();

  if (event.channel && !event.channel_name) {
    try {
      const info = await web.conversations.info({ channel: event.channel });
      if (info.channel) {
        event.channel_name =
          (info.channel as Record<string, unknown>).name as string | undefined;
      }
    } catch {
      // Channel info not available
    }
  }

  if (event.user && !event.user_name) {
    try {
      const info = await web.users.info({ user: event.user });
      if (info.user) {
        event.user_name =
          (info.user as Record<string, unknown>).real_name as
            | string
            | undefined;
      }
    } catch {
      // User info not available
    }
  }

  return event;
}

/**
 * Start a single Socket Mode connection (MCP server backward compat).
 *
 * For multi-profile use, create a SocketManager and call startProfile() /
 * startAll() instead.
 */
export async function startSocketMode(
  onEvent: (event: StoredEvent) => void,
  onSlash?: SlashCallback,
  onBlockAction?: BlockActionCallback,
): Promise<void> {
  const { getAppToken, getWebClient } = await import("./slack-clients.js");
  const appToken = getAppToken();

  let botUserId: string | null = null;
  try {
    const web = getWebClient();
    const auth = await web.auth.test();
    botUserId = auth.user_id ?? null;
    console.error(`[chorusgate-mcp] Bot user ID: ${botUserId}`);
  } catch (err) {
    console.error(
      "[chorusgate-mcp] Failed to resolve bot user ID, " +
        "self-message filtering disabled:",
      (err as Error).message,
    );
  }

  _legacySocket = new SocketModeClient({
    appToken,
    logLevel: LogLevel.INFO,
  });

  _legacySocket.on("connecting", () => {
    console.error("[chorusgate-mcp] Connecting to Slack via Socket Mode...");
  });
  _legacySocket.on("connected", () => {
    console.error("[chorusgate-mcp] Socket Mode connected");
  });
  _legacySocket.on("ready", () => {
    console.error("[chorusgate-mcp] Socket Mode ready, listening for events");
  });
  _legacySocket.on("disconnecting", () => {
    console.error("[chorusgate-mcp] Socket Mode disconnecting...");
  });
  _legacySocket.on("reconnecting", () => {
    console.error("[chorusgate-mcp] Socket Mode reconnecting...");
  });
  _legacySocket.on("error", (error) => {
    console.error(
      "[chorusgate-mcp] Socket Mode error:",
      (error as Error).message,
    );
  });

  // --- event handlers (delegate to the same internal conversion) ---

  const pushEvent = (type: SlackEventType, rawEvent: unknown): StoredEvent => {
    const evt = rawEvent as Record<string, unknown>;
    const item = evt.item as Record<string, unknown> | undefined;
    return eventStore.push({
      type,
      subtype: evt.subtype as string | undefined,
      channel:
        (evt.channel as string) || (item?.channel as string) || "",
      user: (evt.user as string) || "",
      text: (evt.text as string) || "",
      ts: (evt.ts as string) || (evt.event_ts as string) || "",
      thread_ts: evt.thread_ts as string | undefined,
      reaction: evt.reaction as string | undefined,
      reaction_user: evt.user as string | undefined,
      reaction_item_channel: item?.channel as string | undefined,
      reaction_item_ts: item?.ts as string | undefined,
      user_name: undefined,
      channel_name: undefined,
      raw: rawEvent,
    });
  };

  _legacySocket.on("app_mention", async ({ event, ack }) => {
    const stored = pushEvent("app_mention", event);
    await ack();
    onEvent(stored);
  });

  _legacySocket.on("message", async ({ event, ack }) => {
    if (botUserId && (event as Record<string, unknown>).user === botUserId) {
      await ack();
      return;
    }
    const subtype = (event as Record<string, unknown>).subtype as
      | string
      | undefined;
    if (subtype === "bot_message") {
      await ack();
      return;
    }
    const stored = pushEvent("message", event);
    await ack();
    onEvent(stored);
  });

  _legacySocket.on("reaction_added", async ({ event, ack }) => {
    const stored = pushEvent("reaction_added", event);
    await ack();
    onEvent(stored);
  });

  _legacySocket.on("slash_commands", async ({ body, ack }) => {
    await ack();
    if (onSlash) {
      const cmd: SlashCommand = {
        command: (body.command as string) || "",
        text: ((body.text as string) || "").trim(),
        channelId: (body.channel_id as string) || "",
        userId: (body.user_id as string) || "",
        userName: (body.user_name as string) || undefined,
        profileId: "default",
      };
      try {
        await onSlash(cmd);
      } catch (err) {
        console.error(
          "[chorusgate-mcp] slash command handler error:",
          (err as Error).message,
        );
      }
    }
  });

  _legacySocket.on("interactive", async ({ body, ack }) => {
    const payload = body as Record<string, unknown>;
    if (payload.type !== "block_actions") {
      await ack();
      return;
    }
    await ack();
    if (!onBlockAction) return;

    const actions = payload.actions as Array<Record<string, unknown>> | undefined;
    if (!actions || actions.length === 0) return;

    for (const action of actions) {
      const ch = payload.channel as Record<string, unknown> | undefined;
      const usr = payload.user as Record<string, unknown> | undefined;
      const msg = payload.message as Record<string, unknown> | undefined;
      const container = payload.container as Record<string, unknown> | undefined;
      const blockAction: BlockAction = {
        type: "block_actions",
        channelId: ((ch?.id || payload.channel_id || "") as string),
        userId: ((usr?.id || payload.user_id || "") as string),
        actionValue: (action.value as string) || "",
        actionId: (action.action_id as string) || "",
        messageTs: ((msg?.ts || container?.message_ts || "") as string),
        profileId: "default",
      };
      try {
        await onBlockAction(blockAction);
      } catch (err) {
        console.error(
          "[chorusgate-mcp] block_action handler error:",
          (err as Error).message,
        );
      }
    }
  });

  await _legacySocket.start();
}

/** Stop the legacy Socket Mode connection (MCP server backward compat). */
export async function stopSocketMode(): Promise<void> {
  if (_legacySocket) {
    await _legacySocket.disconnect();
    _legacySocket = null;
  }
}
