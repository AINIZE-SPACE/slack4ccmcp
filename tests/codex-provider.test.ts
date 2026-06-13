import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { codexProvider } from "../src/providers/codex.js";

test("codexProvider.generateMCPConfig writes Web API-only config", () => {
  const configPath = codexProvider.generateMCPConfig("xoxb-test-bot", "xapp-test-app");

  try {
    const text = readFileSync(configPath, "utf8");

    assert.ok(
      text.includes('SLACK_BOT_TOKEN = "xoxb-test-bot"'),
      "config should include bot token",
    );
    assert.ok(
      text.includes('SLACK_APP_TOKEN = "xapp-test-app"'),
      "config should include app token",
    );
    assert.ok(
      text.includes('default_tools_approval_mode = "approve"'),
      "config should keep headless approval mode",
    );
    assert.equal(
      text.includes("MCP_SENDER_ONLY"),
      false,
      "config should not include legacy sender-only flag",
    );
  } finally {
    rmSync(configPath, { force: true });
  }
});
