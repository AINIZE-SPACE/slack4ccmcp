// ============================================================
// InterruptManager — busy-ack + kill current task on new message
//
// When a user sends a message while the gateway is already
// processing one for the same session, this module:
//   1. Sends a busy-ack ("⚡ 正在中断当前任务…") with 30s debounce
//   2. Kills the current claude -p process (interrupt mode)
//      or queues the message (queue mode)
//   3. Lets the new message proceed
//
// Inspired by Hermes Agent's _busy_input_mode + _busy_ack_ts.
// ============================================================

import type { ChildProcess } from "node:child_process";
import { getWebClient } from "./slack-clients.js";

// ---- config ------------------------------------------------------------------

const BUSY_MODE =
  (process.env.GATEWAY_BUSY_MODE || "interrupt").toLowerCase() as
    | "interrupt"
    | "queue";

/** Test seam: override the web-client getter (used by tests/interrupt.test.ts). */
let webClientOverride: (() => ReturnType<typeof getWebClient>) | null = null;
export function _setWebClientForTests(
  getter: (() => ReturnType<typeof getWebClient>) | null,
): void {
  webClientOverride = getter;
}
function getWeb(): ReturnType<typeof getWebClient> {
  return webClientOverride ? webClientOverride() : getWebClient();
}

const BUSY_ACK_COOLDOWN_MS = 30_000; // 30s debounce

// ---- InterruptManager --------------------------------------------------------

export class InterruptManager {
  /** Running processes keyed by session scope key. */
  private running = new Map<string, ChildProcess>();

  /** Last busy-ack timestamp per session (for debounce). */
  private lastAck = new Map<string, number>();

  /**
   * Register a running child process for a session.
   * Called before spawning claude -p.
   */
  register(key: string, child: ChildProcess): void {
    this.running.set(key, child);
  }

  /** Unregister after the process completes. */
  unregister(key: string): void {
    this.running.delete(key);
  }

  /**
   * Check whether a new message should interrupt the current task.
   *
   * @returns true if the caller should proceed with the new message,
   *          false if the current task should continue.
   */
  async interrupt(
    key: string,
    channel: string,
    threadTs?: string,
  ): Promise<boolean> {
    const child = this.running.get(key);
    if (!child) return true; // no running process — proceed

    if (BUSY_MODE === "queue") {
      // Queue mode: send ack, then wait for the current task to finish.
      // When the child exits, return true so the gateway proceeds normally.
      await this.sendBusyAck(channel, threadTs, "queue");

      // Wait for child to exit (the current task finishing)
      await new Promise<void>((resolve) => {
        const onExit = () => {
          child.removeListener("exit", onExit);
          child.removeListener("close", onExit);
          resolve();
        };
        child.on("exit", onExit);
        child.on("close", onExit);
      });

      this.running.delete(key);
      return true;
    }

    // Interrupt mode: kill current process
    await this.sendBusyAck(channel, threadTs, "interrupt");

    try {
      child.kill("SIGTERM");
      // Give it 2s to gracefully exit, then force
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }, 2000).unref();
    } catch (err) {
      console.error(
        `[interrupt] failed to kill process for ${key}:`,
        (err as Error).message,
      );
    }

    this.running.delete(key);
    return true;
  }

  /** Check if a session is currently running. */
  isRunning(key: string): boolean {
    return this.running.has(key);
  }

  /** Number of running sessions. */
  get runningCount(): number {
    return this.running.size;
  }

  /** Clear all state (for shutdown). */
  clear(): void {
    for (const [, child] of this.running) {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }
    this.running.clear();
    this.lastAck.clear();
  }

  // ---- private ---------------------------------------------------------------

  private async sendBusyAck(
    channel: string,
    threadTs?: string,
    mode: "interrupt" | "queue" = "interrupt",
  ): Promise<void> {
    const now = Date.now();
    const ackKey = `${channel}:${threadTs ?? "top"}`;
    const last = this.lastAck.get(ackKey) ?? 0;
    if (now - last < BUSY_ACK_COOLDOWN_MS) return; // debounced

    this.lastAck.set(ackKey, now);

    const text =
      mode === "queue"
        ? "⏳ 当前任务正在执行，你的消息已排队。完成后立即回复。"
        : "⚡ 正在中断当前任务，马上回复你的新消息…";

    try {
      const web = getWeb();
      await web.chat.postMessage({
        channel,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        text,
        link_names: true,
        unfurl_links: false,
        unfurl_media: false,
      });
    } catch (err) {
      console.error(
        "[interrupt] failed to send busy ack:",
        (err as Error).message,
      );
    }
  }
}

/** Singleton instance. */
export const interruptManager = new InterruptManager();
