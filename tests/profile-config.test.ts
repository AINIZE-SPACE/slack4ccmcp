// ============================================================
// Profile config parser tests
// ============================================================

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Preserve original env to restore after each test.
const SAVED_ENV = { ...process.env };

function clearProfileEnv(): void {
  delete process.env.GATEWAY_PROFILES;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_APP_TOKEN;
  delete process.env.GATEWAY_PROVIDER;
  delete process.env.GATEWAY_CLAUDE_CWD;
  delete process.env.GATEWAY_COMMAND_PREFIX;
  for (const k of Object.keys(process.env)) {
    if (
      k.startsWith("SLACK_BOT_TOKEN_") ||
      k.startsWith("SLACK_APP_TOKEN_") ||
      k.startsWith("GATEWAY_PROVIDER_") ||
      k.startsWith("GATEWAY_CWD_") ||
      k.startsWith("GATEWAY_COMMAND_PREFIX_")
    ) {
      delete process.env[k];
    }
  }
}

beforeEach(clearProfileEnv);
afterEach(() => {
  clearProfileEnv();
  Object.assign(process.env, SAVED_ENV);
});

// Dynamic import so parseProfiles reads process.env at call time.
async function parse() {
  const mod = await import("../src/profile-config.js");
  return mod.parseProfiles();
}

describe("parseProfiles — legacy single profile", () => {
  it("parses a single default profile from SLACK_BOT_TOKEN/SLACK_APP_TOKEN", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-bot";
    process.env.SLACK_APP_TOKEN = "xapp-test-app";

    const profiles = await parse();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].id, "default");
    assert.equal(profiles[0].botToken, "xoxb-test-bot");
    assert.equal(profiles[0].appToken, "xapp-test-app");
    assert.equal(profiles[0].providerId, "claude"); // default
  });

  it("reads GATEWAY_PROVIDER for legacy mode", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-bot";
    process.env.SLACK_APP_TOKEN = "xapp-test-app";
    process.env.GATEWAY_PROVIDER = "codex";

    const profiles = await parse();
    assert.equal(profiles[0].providerId, "codex");
  });

  it("reads GATEWAY_CLAUDE_CWD for legacy mode", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-bot";
    process.env.SLACK_APP_TOKEN = "xapp-test-app";
    process.env.GATEWAY_CLAUDE_CWD = "/home/user/project";

    const profiles = await parse();
    assert.equal(profiles[0].cwd, "/home/user/project");
  });

  it("reads GATEWAY_COMMAND_PREFIX for legacy mode", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-bot";
    process.env.SLACK_APP_TOKEN = "xapp-test-app";
    process.env.GATEWAY_COMMAND_PREFIX = "cx";

    const profiles = await parse();
    assert.equal(profiles[0].commandPrefix, "cx");
  });

  it("defaults commandPrefix to 'cc' when not set", async () => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-bot";
    process.env.SLACK_APP_TOKEN = "xapp-test-app";

    const profiles = await parse();
    assert.equal(profiles[0].commandPrefix, "cc");
  });
});

describe("parseProfiles — multi-profile mode", () => {
  it("parses GATEWAY_PROFILES=cc,codex", async () => {
    process.env.GATEWAY_PROFILES = "cc,codex";
    process.env.SLACK_BOT_TOKEN_CC = "xoxb-cc-bot";
    process.env.SLACK_APP_TOKEN_CC = "xapp-cc-app";
    process.env.SLACK_BOT_TOKEN_CODEX = "xoxb-codex-bot";
    process.env.SLACK_APP_TOKEN_CODEX = "xapp-codex-app";

    const profiles = await parse();
    assert.equal(profiles.length, 2);
    assert.equal(profiles[0].id, "cc");
    assert.equal(profiles[0].botToken, "xoxb-cc-bot");
    assert.equal(profiles[1].id, "codex");
    assert.equal(profiles[1].botToken, "xoxb-codex-bot");
  });

  it("reads per-profile provider overrides", async () => {
    process.env.GATEWAY_PROFILES = "cc,codex";
    process.env.SLACK_BOT_TOKEN_CC = "xoxb-cc-bot";
    process.env.SLACK_APP_TOKEN_CC = "xapp-cc-app";
    process.env.SLACK_BOT_TOKEN_CODEX = "xoxb-codex-bot";
    process.env.SLACK_APP_TOKEN_CODEX = "xapp-codex-app";
    process.env.GATEWAY_PROVIDER_CC = "claude-stream";
    process.env.GATEWAY_PROVIDER_CODEX = "codex";

    const profiles = await parse();
    assert.equal(profiles[0].providerId, "claude-stream");
    assert.equal(profiles[1].providerId, "codex");
  });

  it("reads per-profile CWD overrides", async () => {
    process.env.GATEWAY_PROFILES = "cc";
    process.env.SLACK_BOT_TOKEN_CC = "xoxb-cc-bot";
    process.env.SLACK_APP_TOKEN_CC = "xapp-cc-app";
    process.env.GATEWAY_CWD_CC = "/home/user/project-a";

    const profiles = await parse();
    assert.equal(profiles[0].cwd, "/home/user/project-a");
  });

  it("reads per-profile command prefix", async () => {
    process.env.GATEWAY_PROFILES = "codex";
    process.env.SLACK_BOT_TOKEN_CODEX = "xoxb-codex-bot";
    process.env.SLACK_APP_TOKEN_CODEX = "xapp-codex-app";
    process.env.GATEWAY_COMMAND_PREFIX_CODEX = "cx";

    const profiles = await parse();
    assert.equal(profiles[0].commandPrefix, "cx");
  });

  it("defaults commandPrefix to profile id", async () => {
    process.env.GATEWAY_PROFILES = "codex";
    process.env.SLACK_BOT_TOKEN_CODEX = "xoxb-codex-bot";
    process.env.SLACK_APP_TOKEN_CODEX = "xapp-codex-app";

    const profiles = await parse();
    assert.equal(profiles[0].commandPrefix, "codex");
  });

  it("trims whitespace in GATEWAY_PROFILES", async () => {
    process.env.GATEWAY_PROFILES = " cc , codex ";
    process.env.SLACK_BOT_TOKEN_CC = "xoxb-cc-bot";
    process.env.SLACK_APP_TOKEN_CC = "xapp-cc-app";
    process.env.SLACK_BOT_TOKEN_CODEX = "xoxb-codex-bot";
    process.env.SLACK_APP_TOKEN_CODEX = "xapp-codex-app";

    const profiles = await parse();
    assert.equal(profiles.length, 2);
    assert.equal(profiles[0].id, "cc");
    assert.equal(profiles[1].id, "codex");
  });
});

describe("parseProfiles — validation", () => {
  it("throws when GATEWAY_PROFILES is set but empty", async () => {
    process.env.GATEWAY_PROFILES = "  ,  ";
    await assert.rejects(parse, /GATEWAY_PROFILES is set but empty/);
  });

  it("throws on duplicate profile ids in GATEWAY_PROFILES", async () => {
    process.env.GATEWAY_PROFILES = "cc,cc";
    process.env.SLACK_BOT_TOKEN_CC = "xoxb-cc-bot";
    process.env.SLACK_APP_TOKEN_CC = "xapp-cc-app";
    await assert.rejects(parse, /Duplicate profile id/);
  });

  it("throws when a profile is missing bot token", async () => {
    process.env.GATEWAY_PROFILES = "cc,codex";
    process.env.SLACK_BOT_TOKEN_CC = "xoxb-cc-bot";
    process.env.SLACK_APP_TOKEN_CC = "xapp-cc-app";
    // Missing SLACK_BOT_TOKEN_CODEX
    process.env.SLACK_APP_TOKEN_CODEX = "xapp-codex-app";
    await assert.rejects(parse, /SLACK_BOT_TOKEN_CODEX is required/);
  });

  it("throws when a profile is missing app token", async () => {
    process.env.GATEWAY_PROFILES = "cc,codex";
    process.env.SLACK_BOT_TOKEN_CC = "xoxb-cc-bot";
    process.env.SLACK_APP_TOKEN_CC = "xapp-cc-app";
    process.env.SLACK_BOT_TOKEN_CODEX = "xoxb-codex-bot";
    // Missing SLACK_APP_TOKEN_CODEX
    await assert.rejects(parse, /SLACK_APP_TOKEN_CODEX is required/);
  });

  it("warns on unexpected token prefix (non-throwing)", async () => {
    process.env.SLACK_BOT_TOKEN = "not-a-bot-token";
    process.env.SLACK_APP_TOKEN = "xapp-test-app";
    // Should not throw — just warn
    const profiles = await parse();
    assert.equal(profiles.length, 1);
  });
});
