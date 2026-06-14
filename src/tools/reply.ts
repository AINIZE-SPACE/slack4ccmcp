// ============================================================
// Tool: slack_reply — Reply to a Slack message in thread
// ============================================================

import type { ReplyInput, ReplyOutput } from "../types.js";
import { getWebClient } from "../slack-clients.js";
import { eventStore } from "../event-store.js";
import { slackApiError } from "../tool-errors.js";

export const replyTool = {
  name: "slack_reply",
  description:
    "Reply to a Slack message in its thread. " +
    "After replying, marks the original event as handled.",
  inputSchema: {
    type: "object" as const,
    properties: {
      channel: {
        type: "string",
        description: "Channel ID where the message is (e.g. 'C123456')",
      },
      thread_ts: {
        type: "string",
        description:
          "The thread_ts of the parent message to reply to. " +
          "Use the original message's ts if it started the thread, " +
          "or its thread_ts if it's already in a thread.",
      },
      text: {
        type: "string",
        description:
          "Reply text in Slack mrkdwn format. " +
          "Use *bold*, _italic_, `code`, ```code blocks```, " +
          "and <http://url|link text> for links.",
      },
    },
    required: ["channel", "thread_ts", "text"],
  },
  async handler(input: ReplyInput): Promise<ReplyOutput> {
    const web = getWebClient();

    const result = await web.chat.postMessage({
      channel: input.channel,
      thread_ts: input.thread_ts,
      text: input.text,
      link_names: true,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (!result.ok) {
      throw slackApiError("Failed to send reply", result.error);
    }

    // Mark the corresponding event(s) as handled. We match on channel +
    // the thread_ts we replied to (which is the triggering event's ts).
    // This is best-effort — events may have already been marked by the
    // gateway, or may not exist in the short-lived in-memory store.
    const recent = eventStore.getRecent(50);
    for (const evt of recent) {
      if (evt.channel === input.channel && evt.ts === input.thread_ts) {
        eventStore.markHandled(evt.id);
      }
      // Also mark thread replies whose thread_ts matches.
      if (
        evt.channel === input.channel &&
        evt.thread_ts === input.thread_ts &&
        !evt.handled
      ) {
        eventStore.markHandled(evt.id);
      }
    }

    return {
      ok: true,
      ts: result.ts || "",
      channel: result.channel || input.channel,
    };
  },
};
