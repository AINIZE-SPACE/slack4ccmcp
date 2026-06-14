// ============================================================
// Tool: slack_send_message — Send a message to a Slack channel
// ============================================================

import type { SendMessageInput, SendMessageOutput } from "../types.js";
import { getWebClient } from "../slack-clients.js";
import { slackApiError } from "../tool-errors.js";

export const sendMessageTool = {
  name: "slack_send_message",
  description:
    "Send a message to a Slack channel or as a thread reply. " +
    "Supports Slack mrkdwn formatting.",
  inputSchema: {
    type: "object" as const,
    properties: {
      channel: {
        type: "string",
        description:
          "Channel ID (e.g. 'C123456') or channel name with # (e.g. '#general')",
      },
      text: {
        type: "string",
        description:
          "Message text in Slack mrkdwn format. " +
          "Use *bold*, _italic_, `code`, ```code blocks```, " +
          "• for bullet lists, and <http://url|link text> for links.",
      },
      thread_ts: {
        type: "string",
        description:
          "Optional: thread timestamp to reply in an existing thread",
      },
    },
    required: ["channel", "text"],
  },
  async handler(input: SendMessageInput): Promise<SendMessageOutput> {
    const web = getWebClient();

    const result = await web.chat.postMessage({
      channel: input.channel,
      text: input.text,
      thread_ts: input.thread_ts,
      link_names: true,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (!result.ok) {
      throw slackApiError("Failed to send message", result.error);
    }

    return {
      ok: true,
      ts: result.ts || "",
      channel: result.channel || input.channel,
    };
  },
};
