// ============================================================
// Shared bootstrap — env loading + token validation + client init
//
// Both the MCP server (index.ts) and the gateway daemon (gateway.ts)
// need this exact sequence.  Extracted to avoid duplication and ensure
// token validation stays consistent.
//
// Multi-profile: bootstrap now parses all profiles and initializes
// the default singleton (first profile) for backward compat with
// tools that call getWebClient().
// ============================================================

import { loadEnv, fixMcpPlaceholders } from "./load-env.js";
import { initSlackClients } from "./slack-clients.js";
import { parseProfiles, type ProfileConfig } from "./profile-config.js";

/**
 * Run the full bootstrap sequence:
 *   1. Load .env (global + project + cwd)
 *   2. Fix MCP config placeholders
 *   3. Parse profiles (multi or single)
 *   4. Validate token formats
 *   5. Initialize default singleton Slack clients (backward compat)
 *
 * Returns the parsed profiles so callers can set up multi-profile
 * Socket Mode if needed.
 *
 * Calls process.exit(1) on unrecoverable config errors.
 */
export function bootstrap(): ProfileConfig[] {
  const dotEnvParsed = loadEnv();
  fixMcpPlaceholders(dotEnvParsed, ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN"]);

  // Parse profiles (single "default" if GATEWAY_PROFILES not set)
  let profiles: ProfileConfig[];
  try {
    profiles = parseProfiles();
  } catch (err) {
    console.error(
      `[chorusgate] FATAL: ${(err as Error).message}`,
    );
    process.exit(1);
  }

  if (profiles.length === 0) {
    console.error(
      "[chorusgate] FATAL: no profiles configured. " +
        "Set SLACK_BOT_TOKEN/SLACK_APP_TOKEN or GATEWAY_PROFILES.",
    );
    process.exit(1);
  }

  // Initialize the default singleton from the first profile.
  // Tools and legacy code call getWebClient() / getAppToken() which
  // resolve to this first profile's clients.
  initSlackClients({
    botToken: profiles[0].botToken,
    appToken: profiles[0].appToken,
  });

  console.error(
    `[chorusgate] ${profiles.length} profile(s) loaded: ` +
      profiles.map((p) => `${p.id}(${p.providerId})`).join(", "),
  );

  return profiles;
}
