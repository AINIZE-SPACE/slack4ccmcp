// ============================================================
// Shared .env loading — project root + cwd + global, with MCP placeholder fixup
//
// Load order (later overrides earlier):
//   1. ~/.gateway/.env          — global defaults (user home)
//   2. <project-root>/.env      — project-installed (always found via import.meta.url)
//   3. ./.env (cwd)             — working-directory overrides
//   4. Shell environment        — already in process.env, never overwritten
//
// Also handles MCP config placeholders: if process.env has a literal
// "${SLACK_BOT_TOKEN}" (injected by MCP config), the parsed .env value
// replaces it.
// ============================================================

import { parse as parseDotEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

/** Path to the global .env under the user's home .gateway directory. */
export const GLOBAL_ENV_PATH = resolve(homedir(), ".gateway", ".env");
/** Path to the project-installed .env (always found at package root). */
export const PROJECT_ENV_PATH = resolve(projectRoot, ".env");
/** Path to the local .env in the current working directory's .gateway/ folder.
 *  Using .gateway/.env instead of ./.env avoids conflicts with other apps
 *  that may also look for a root-level .env. */
export const CWD_ENV_PATH = resolve(process.cwd(), ".gateway", ".env");

/**
 * Load .env from three tiers:
 *   1. ~/.gateway/.env            — global defaults (lowest)
 *   2. <project-root>/.env        — project-installed
 *   3. ./.gateway/.env (cwd)      — working-directory overrides (highest file)
 *
 * Shell environment always wins over all files.
 *
 * Returns the merged parsed result so callers can still do placeholder fixup.
 */
export function loadEnv(): Record<string, string> {
  const shellKeys = new Set(Object.keys(process.env));
  const merged: Record<string, string> = {};

  const loadFile = (path: string, label: string): void => {
    try {
      const content = readFileSync(path, "utf-8");
      const parsed = parseDotEnv(content);
      Object.assign(merged, parsed);
      for (const [key, value] of Object.entries(parsed)) {
        if (!shellKeys.has(key)) process.env[key] = value;
      }
      console.error(`[load-env] loaded ${label}: ${path}`);
    } catch {
      // file is optional
    }
  };

  // Priority: global < project < cwd < shell
  loadFile(GLOBAL_ENV_PATH, "global");
  loadFile(PROJECT_ENV_PATH, "project");
  loadFile(CWD_ENV_PATH, "cwd");

  return merged;
}

/**
 * Fix up MCP config placeholders.  When an MCP config passes literal
 * "${SLACK_BOT_TOKEN}" as the env-var value, we replace it with the
 * actual value from the merged .env files.
 */
export function fixMcpPlaceholders(
  parsed: Record<string, string>,
  keys: readonly string[]
): void {
  for (const key of keys) {
    if (
      process.env[key] &&
      process.env[key]!.startsWith("${") &&
      parsed[key]
    ) {
      process.env[key] = parsed[key];
    }
  }
}
