// ============================================================
// ChorusGate MCP Server — Web API tools for Slack
// ============================================================

import { bootstrap } from "./bootstrap.js";

bootstrap();

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// --- Tools ---
import { replyTool } from "./tools/reply.js";
import { sendMessageTool } from "./tools/send-message.js";
import { addReactionTool } from "./tools/react.js";
import { channelHistoryTool } from "./tools/channel-history.js";
import { threadRepliesTool } from "./tools/thread-replies.js";
import { listChannelsTool } from "./tools/list-channels.js";
import { getUserInfoTool } from "./tools/get-user.js";
import { getSkillListTool } from "./tools/get-skill-list.js";
import { serializeToolError } from "./tool-errors.js";

// ============================================================
// Tool Registry
// ============================================================

const tools = [
  replyTool,
  sendMessageTool,
  addReactionTool,
  channelHistoryTool,
  threadRepliesTool,
  listChannelsTool,
  getUserInfoTool,
  getSkillListTool,
];

const toolMap = new Map(tools.map((t) => [t.name, t]));

// ============================================================
// MCP Server Setup
// ============================================================

const server = new Server(
  {
    name: "chorusgate-mcp",
    version: "1.0.0",
    description:
      "Slack Web API tools for reading channels, replying in threads, " +
      "sending messages, and looking up workspace context.",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- tools/list ---
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

// --- tools/call ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = toolMap.get(name);

  if (!tool) {
    throw new Error(
      `Unknown tool: ${name}. Available tools: ${Array.from(toolMap.keys()).join(", ")}`
    );
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (tool.handler as any)(args ?? {});

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    const error = serializeToolError(err);
    console.error(
      `[chorusgate-mcp] Tool error (${name}/${error.code}):`,
      error.message
    );
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ ok: false, error }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// ============================================================
// Startup
// ============================================================

async function main(): Promise<void> {
  // Connect transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[chorusgate-mcp] MCP Server ready (stdio)");
}

// Graceful shutdown
async function shutdown(): Promise<void> {
  console.error("[chorusgate-mcp] Shutting down...");
  await server.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[chorusgate-mcp] Fatal error:", (err as Error).message);
  process.exit(1);
});
