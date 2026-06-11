// ============================================================
// Gateway control-plane file paths
//
// Shared between the daemon (gateway.ts) and the control CLI
// (gateway-control.ts).
//
// .gateway/ is created under process.cwd() — run slack-gateway from the
// directory you want logs/pid/status to live in. BIN_FILE still resolves
// from the package install location (it never moves).
// ============================================================

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

/** Control-plane directory (gitignored). Created under cwd. */
export const GATEWAY_DIR = resolve(process.cwd(), ".gateway");
/** PID of the running daemon. */
export const PID_FILE = resolve(GATEWAY_DIR, "gateway.pid");
/** Daemon stdout/stderr when started in the background. */
export const LOG_FILE = resolve(GATEWAY_DIR, "gateway.log");
/** Periodic runtime snapshot the daemon writes for status/list. */
export const STATUS_FILE = resolve(GATEWAY_DIR, "status.json");
/** Absolute path to the bin dispatcher (for detached spawn, always relative to
 *  the package root regardless of cwd). */
export const BIN_FILE = resolve(projectRoot, "bin", "slack-gateway.mjs");

/** Ensure the control-plane directory exists. */
export function ensureGatewayDir(): void {
  mkdirSync(GATEWAY_DIR, { recursive: true });
}

/** Shape of status.json written by the daemon. */
export interface GatewayStatus {
  pid: number;
  startedAt: number;
  updatedAt: number;
  activeSlots: number;
  maxConcurrent: number;
  sessions: Array<{
    key: string;
    sessionId: string;
    started: boolean;
    lastUsed: number;
  }>;
}
