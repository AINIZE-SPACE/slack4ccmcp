// ============================================================
// ChorusGate Shared Types
// ============================================================

// --- Slack Event Types ---

/** Events we listen to from Slack Socket Mode */
export type SlackEventType = "app_mention" | "message" | "reaction_added";

/** All possible Slack event types we might receive */
export const SLACK_EVENT_TYPES: readonly SlackEventType[] = [
  "app_mention",
  "message",
  "reaction_added",
] as const;

// --- Internal Event Representation ---

export interface StoredEvent {
  /** Unique event ID (generated) */
  id: string;
  /** Event type from Slack */
  type: SlackEventType;
  /** Slack event subtype (e.g. 'bot_message', 'thread_broadcast') */
  subtype?: string;
  /** Channel ID */
  channel: string;
  /** Channel name (resolved) */
  channel_name?: string;
  /** User ID who triggered the event */
  user: string;
  /** User's display name (resolved) */
  user_name?: string;
  /** Message text (if applicable) */
  text?: string;
  /** Message timestamp */
  ts: string;
  /** Thread timestamp (if in a thread) */
  thread_ts?: string;
  /** For reactions: the emoji name */
  reaction?: string;
  /** For reactions: the user who added the reaction */
  reaction_user?: string;
  /** The item the reaction was added to (channel + ts) */
  reaction_item_channel?: string;
  reaction_item_ts?: string;
  /** Whether this event has been handled/replied to */
  handled: boolean;
  /** When we received this event (epoch ms) */
  received_at: number;
  /** Which profile (Slack app) this event came from.  Set by SocketManager. */
  profileId?: string;
  /** Raw Slack event payload for debugging */
  raw?: unknown;
}

// --- MCP Tool Input/Output Schemas ---

// slack_reply
export interface ReplyInput {
  /** Channel ID to reply in */
  channel: string;
  /** Thread timestamp to reply to */
  thread_ts: string;
  /** Reply text (supports Slack mrkdwn) */
  text: string;
}

export interface ReplyOutput {
  ok: boolean;
  ts: string;
  channel: string;
}

// slack_send_message
export interface SendMessageInput {
  /** Channel ID (e.g. 'C123456') or channel name (e.g. '#general') */
  channel: string;
  /** Message text (supports Slack mrkdwn) */
  text: string;
  /** Optional thread timestamp to reply in thread */
  thread_ts?: string;
}

export interface SendMessageOutput {
  ok: boolean;
  ts: string;
  channel: string;
}

// slack_add_reaction
export interface AddReactionInput {
  /** Channel ID */
  channel: string;
  /** Message timestamp */
  timestamp: string;
  /** Emoji name (without colons, e.g. 'thumbsup') */
  name: string;
}

export interface AddReactionOutput {
  ok: boolean;
}

// slack_channel_history
export interface ChannelHistoryInput {
  /** Channel ID */
  channel: string;
  /** Max messages to return (default: 20, max: 200) */
  limit?: number;
}

export interface ChannelHistoryOutput {
  messages: SlackMessageInfo[];
  channel: string;
  has_more: boolean;
}

export interface SlackMessageInfo {
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  reply_count?: number;
  subtype?: string;
}

// slack_thread_replies
export interface ThreadRepliesInput {
  /** Channel ID */
  channel: string;
  /** Thread parent timestamp */
  thread_ts: string;
}

export interface ThreadRepliesOutput {
  messages: SlackMessageInfo[];
  channel: string;
  thread_ts: string;
}

// slack_list_channels
export interface ListChannelsInput {
  /** Max channels to return (default: 50) */
  limit?: number;
  /** Optional Slack pagination cursor from a previous response */
  cursor?: string;
}

export interface ListChannelsOutput {
  channels: SlackChannelInfo[];
  /** Cursor for the next page, if more channels are available */
  next_cursor?: string;
}

export interface SlackChannelInfo {
  id: string;
  name: string;
  is_private: boolean;
  topic?: string;
  num_members?: number;
}

// slack_get_user_info
export interface GetUserInfoInput {
  /** User ID (e.g. 'U123456') */
  user_id: string;
}

export interface GetUserInfoOutput {
  id: string;
  name: string;
  real_name: string;
  display_name: string;
  title?: string;
  image_48?: string;
  is_bot: boolean;
  timezone?: string;
}
