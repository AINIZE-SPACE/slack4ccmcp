// ============================================================
// Profile Config — multi Slack-app / multi-agent profile parser
//
// Replaces the single-app .env model with per-profile token
// discovery and validation.  Backward-compatible: when
// GATEWAY_PROFILES is not set, a single "default" profile is
// constructed from the legacy SLACK_BOT_TOKEN / SLACK_APP_TOKEN.
//
// 跟踪: [#24](https://github.com/AINIZE-SPACE/chorusgate/issues/24)
// 跟踪: [#30](https://github.com/AINIZE-SPACE/chorusgate/issues/30)
// ============================================================

/** One Slack app profile — independent tokens, provider binding, and prefix. */
export interface ProfileConfig {
  /** Internal profile id, e.g. "cc" | "codex". Short, kebab-friendly. */
  id: string;
  /** Slack Bot User OAuth Token (xoxb-…). */
  botToken: string;
  /** Slack App-Level Token for Socket Mode (xapp-…). */
  appToken: string;
  /** Which AgentProvider to bind: "claude" | "codex" | "claude-stream". */
  providerId: string;
  /** Working directory for spawned agent processes (per-profile override). */
  cwd?: string;
  /** Slack-facing slash-command prefix for this profile. Defaults to the
   *  profile id (e.g. "cc" → /cc_sessions).  MUST be unique per workspace. */
  commandPrefix?: string;
}

/**
 * Look up an env var by name.  Returns undefined for missing or empty values.
 * This function reads process.env at CALL TIME so it never freezes a
 * pre-bootstrap default (see commit a4f05c1).
 */
function env(name: string): string | undefined {
  const v = process.env[name];
  return v ? v.trim() : undefined;
}

/** Normalize a profile id to the uppercase suffix used in env-var names. */
function suffix(id: string): string {
  return id.toUpperCase();
}

/**
 * Parse profiles from environment variables.
 *
 * When GATEWAY_PROFILES is set (e.g. "cc,codex"), each id discovers its
 * tokens via:
 *   SLACK_BOT_TOKEN_<ID>  /  SLACK_APP_TOKEN_<ID>
 *   GATEWAY_PROVIDER_<ID>  /  GATEWAY_CWD_<ID>
 *   GATEWAY_COMMAND_PREFIX_<ID>
 *
 * When GATEWAY_PROFILES is NOT set, a single "default" profile is built from
 * the legacy SLACK_BOT_TOKEN / SLACK_APP_TOKEN env vars.
 *
 * Throws if a required token is missing for any profile.
 */
export function parseProfiles(): ProfileConfig[] {
  const raw = env("GATEWAY_PROFILES");

  // ---- multi-profile mode ------------------------------------------------
  if (raw) {
    const ids = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      throw new Error("GATEWAY_PROFILES is set but empty");
    }

    const profiles: ProfileConfig[] = [];
    const seenIds = new Set<string>();

    for (const id of ids) {
      if (seenIds.has(id)) {
        throw new Error(`Duplicate profile id in GATEWAY_PROFILES: ${id}`);
      }
      seenIds.add(id);

      const s = suffix(id);
      const botToken = env(`SLACK_BOT_TOKEN_${s}`);
      const appToken = env(`SLACK_APP_TOKEN_${s}`);

      if (!botToken) {
        throw new Error(
          `SLACK_BOT_TOKEN_${s} is required for profile "${id}". ` +
            `Set it in .env or your shell environment.`,
        );
      }
      if (!appToken) {
        throw new Error(
          `SLACK_APP_TOKEN_${s} is required for profile "${id}". ` +
            `Set it in .env or your shell environment.`,
        );
      }

      validateTokenFormat(botToken, "xoxb-", `SLACK_BOT_TOKEN_${s}`);
      validateTokenFormat(appToken, "xapp-", `SLACK_APP_TOKEN_${s}`);

      const providerId = env(`GATEWAY_PROVIDER_${s}`) || "claude";
      const cwd = env(`GATEWAY_CWD_${s}`);
      const commandPrefix =
        env(`GATEWAY_COMMAND_PREFIX_${s}`) || id;

      profiles.push({ id, botToken, appToken, providerId, cwd, commandPrefix });
    }

    return profiles;
  }

  // ---- legacy single-profile mode -----------------------------------------
  const botToken = env("SLACK_BOT_TOKEN");
  const appToken = env("SLACK_APP_TOKEN");

  if (!botToken) {
    throw new Error(
      "SLACK_BOT_TOKEN is required. Set it in .env or your shell environment.",
    );
  }
  if (!appToken) {
    throw new Error(
      "SLACK_APP_TOKEN is required. Set it in .env or your shell environment.",
    );
  }

  validateTokenFormat(botToken, "xoxb-", "SLACK_BOT_TOKEN");
  validateTokenFormat(appToken, "xapp-", "SLACK_APP_TOKEN");

  const commandPrefix = env("GATEWAY_COMMAND_PREFIX") || "cc";

  return [
    {
      id: "default",
      botToken,
      appToken,
      providerId: env("GATEWAY_PROVIDER") || "claude",
      cwd: env("GATEWAY_CLAUDE_CWD"),
      commandPrefix,
    },
  ];
}

/** Warn (not throw) if a token has an unexpected prefix. */
function validateTokenFormat(
  token: string,
  expectedPrefix: string,
  varName: string,
): void {
  if (!token.startsWith(expectedPrefix)) {
    console.error(
      `[profile-config] WARNING: ${varName} should start with '${expectedPrefix}'. ` +
        `Got: ${token.slice(0, 5)}...`,
    );
  }
}

/**
 * Build a map keyed by profile id for O(1) lookup.
 * Throws on duplicate ids (defense-in-depth; parseProfiles already checks).
 */
export function profilesMap(
  profiles: ProfileConfig[],
): Map<string, ProfileConfig> {
  const m = new Map<string, ProfileConfig>();
  for (const p of profiles) {
    if (m.has(p.id)) {
      throw new Error(`Duplicate profile id: ${p.id}`);
    }
    m.set(p.id, p);
  }
  return m;
}
