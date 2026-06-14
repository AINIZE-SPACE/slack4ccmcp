// ============================================================
// PermissionTracker — track pending permission_request events
//                      and resolve them via Slack block_actions
//
// When Claude emits a permission_request, the gateway posts an
// interactive Slack message with 4 approval buttons (Hermes style):
//   Allow Once | Allow Session | Always Allow | Deny
//
// Session/always approvals cache so subsequent same-tool requests
// auto-approve without blocking the user again.
//
// M2: Claude 双向 stream-json 控制面
// 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34)
// 跟踪: [#32](https://github.com/AINIZE-SPACE/chorusgate/issues/32)
// ============================================================

/** Approval scope returned by handleAction. */
export type ApprovalScope = "once" | "session" | "always" | "deny";

// ---- Slack Block Kit types (subset needed by this module) ---------------------

interface SlackText {
  type: "plain_text" | "mrkdwn";
  text: string;
  emoji?: boolean;
}

interface SlackButtonElement {
  type: "button";
  text: SlackText;
  style?: "primary" | "danger";
  action_id: string;
  value: string;
}

interface SlackContextElement { type: "mrkdwn"; text: string; }

type SlackElement = SlackButtonElement | SlackContextElement;

interface SlackBlock {
  type: "section" | "actions" | "context";
  block_id?: string;
  text?: SlackText;
  fields?: SlackText[];
  elements?: SlackElement[];
}

// ---- result types -------------------------------------------------------------

export interface HandleActionResult {
  handled: boolean;
  requesterUserId?: string;
  /** The approval scope the user chose. */
  scope?: ApprovalScope;
  /** Legacy compat: true for any non-deny scope. */
  granted?: boolean;
}

// ---- pending item -------------------------------------------------------------

interface PendingPermission {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  channel: string;
  threadTs: string;
  requesterUserId: string;
  /** Session identity — scopes auto-approval to the right profile+provider. */
  sessionIdentity: string;
  resolve: (scope: ApprovalScope) => void;
  timer: NodeJS.Timeout;
}

// ---- auto-approval cache ------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000; // 2 min

/**
 * Auto-approval entry: when a user chose "session" or "always" for a tool,
 * subsequent requests for the same tool auto-approve without prompting.
 */
interface AutoApprovalEntry {
  toolName: string;
  scope: "session" | "always";
  grantedAt: number;
}

// ---- PermissionTracker --------------------------------------------------------

export class PermissionTracker {
  private pending = new Map<string, PendingPermission>();
  private timeoutMs: number;

  /**
   * Auto-approval cache keyed by `${sessionKey}:${toolName}`.
   * "session" entries are cleared when the gateway restarts.
   * "always" entries persist across restarts (in-memory only for now).
   */
  private autoApprovals = new Map<string, AutoApprovalEntry>();

  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Check whether a tool should auto-approve based on prior approvals.
   *
   * Looks up two cache entries:
   * 1. "always" scope: `${requesterUserId}:${toolName}` (per-user, global across sessions)
   * 2. "session" scope: `${sessionIdentity}:${toolName}` (per session identity)
   *
   * Returns the scope if auto-approved, or null if user input is needed.
   */
  checkAutoApproval(
    sessionIdentity: string,
    toolName: string,
    requesterUserId: string,
  ): "session" | "always" | null {
    // Check "always" scope first (broader).
    const alwaysKey = `${requesterUserId}:${toolName}`;
    const alwaysEntry = this.autoApprovals.get(alwaysKey);
    if (alwaysEntry && alwaysEntry.scope === "always") {
      return "always";
    }

    // Check "session" scope.
    const sessionKey = `${sessionIdentity}:${toolName}`;
    const sessionEntry = this.autoApprovals.get(sessionKey);
    if (sessionEntry) {
      return sessionEntry.scope;
    }

    return null;
  }

  /** Register a pending approval request. Returns Promise resolving to the scope. */
  waitForApproval(
    requestId: string,
    details: {
      toolName: string;
      toolInput: Record<string, unknown>;
      channel: string;
      threadTs: string;
      requesterUserId: string;
      /** Session identity key (profileId:providerId:channel:threadTs). */
      sessionIdentity?: string;
    },
  ): Promise<ApprovalScope> {
    this.reject(requestId, "deny");

    const effectiveIdentity = details.sessionIdentity ??
      `${details.channel}:${details.threadTs}`;

    return new Promise<ApprovalScope>((resolve) => {
      const timer = setTimeout(() => {
        console.error(
          `[permission-tracker] request ${requestId} timed out, auto-denying`,
        );
        this.reject(requestId, "deny");
      }, this.timeoutMs);

      this.pending.set(requestId, {
        requestId,
        toolName: details.toolName,
        toolInput: details.toolInput,
        channel: details.channel,
        threadTs: details.threadTs,
        requesterUserId: details.requesterUserId,
        sessionIdentity: effectiveIdentity,
        resolve,
        timer,
      });
    });
  }

  /**
   * Handle a Slack block_actions callback.
   *
   * action_value format: "${scope}:${requestId}:${requesterUserId}"
   * where scope is "allow_once" | "allow_session" | "allow_always" | "deny".
   */
  handleAction(actionValue: string): HandleActionResult {
    const lastColon = actionValue.lastIndexOf(":");
    if (lastColon === -1) return { handled: false };
    const requesterUserId = actionValue.slice(lastColon + 1);

    const firstColon = actionValue.indexOf(":");
    if (firstColon === lastColon) return { handled: false };
    const scopeRaw = actionValue.slice(0, firstColon);
    const requestId = actionValue.slice(firstColon + 1, lastColon);

    const scope = this.mapScope(scopeRaw);
    if (!scope) return { handled: false };

    const pending = this.pending.get(requestId);
    if (!pending) return { handled: false };

    // Register auto-approval for session/always scope
    if (scope === "session" || scope === "always") {
      // session identity = `${profileId}:${providerId}:${channel}:${threadTs}`
      // "always" entries use a profile-level key for cross-session reuse
      const cacheKey = scope === "always"
        ? `${pending.requesterUserId}:${pending.toolName}`
        : `${pending.sessionIdentity}:${pending.toolName}`;
      this.autoApprovals.set(cacheKey, {
        toolName: pending.toolName,
        scope,
        grantedAt: Date.now(),
      });
    }

    // Resolve the pending request
    const handled = this.resolve(requestId, scope);
    return {
      handled,
      requesterUserId: pending.requesterUserId,
      scope,
      granted: scope !== "deny",
    };
  }

  /** Resolve a specific request with the given scope. */
  resolve(requestId: string, scope: ApprovalScope): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    p.resolve(scope);
    this.pending.delete(requestId);
    return true;
  }

  /** Convenience: approve with "once" scope (legacy compat). */
  approve(requestId: string): boolean {
    return this.resolve(requestId, "once");
  }

  /** Convenience: deny (legacy compat). */
  deny(requestId: string): boolean {
    return this.resolve(requestId, "deny");
  }

  private reject(requestId: string, scope: ApprovalScope): boolean {
    const p = this.pending.get(requestId);
    if (!p) return false;
    clearTimeout(p.timer);
    p.resolve(scope);
    this.pending.delete(requestId);
    return true;
  }

  private mapScope(raw: string): ApprovalScope | null {
    switch (raw) {
      case "allow_once": return "once";
      case "allow_session": return "session";
      case "allow_always": return "always";
      case "deny": return "deny";
      // Legacy compat: old format "approve" / "deny"
      case "approve": return "once";
      default: return null;
    }
  }

  getPending(requestId: string): PendingPermission | undefined {
    return this.pending.get(requestId);
  }

  get hasPending(): boolean { return this.pending.size > 0; }
  get pendingCount(): number { return this.pending.size; }

  /** Clear all pending + auto-approvals. */
  clear(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve("deny");
    }
    this.pending.clear();
    this.autoApprovals.clear();
  }
}

// ---- buildApprovalBlocks (4-button Hermes style) -----------------------------

/**
 * Build Slack Block Kit approval message with 4 buttons.
 *
 * Buttons: ✅ Allow Once | 📋 Allow Session | 🔒 Always Allow | ❌ Deny
 */
export function buildApprovalBlocks(
  toolName: string,
  toolInput: Record<string, unknown>,
  requestId: string,
  requesterUserId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): SlackBlock[] {
  const inputSummary = JSON.stringify(toolInput, null, 2).slice(0, 500);
  const timeoutMinutes = Math.round(timeoutMs / 60000);

  return [
    {
      type: "section" as const,
      text: {
        type: "mrkdwn",
        text: `:warning: *Claude 请求执行工具* — 需要你的批准`,
      },
    },
    {
      type: "section" as const,
      fields: [
        { type: "mrkdwn", text: `*工具:*\n\`${toolName}\`` },
        { type: "mrkdwn", text: `*请求ID:*\n\`${requestId}\`` },
      ],
    },
    {
      type: "section" as const,
      text: {
        type: "mrkdwn",
        text: `*参数:*\n\`\`\`${inputSummary}\`\`\``,
      },
    },
    {
      type: "actions" as const,
      block_id: `perm_${requestId}`,
      elements: [
        {
          type: "button" as const,
          text: { type: "plain_text", text: "✅ Allow Once", emoji: true },
          style: "primary",
          action_id: "permission_allow_once",
          value: `allow_once:${requestId}:${requesterUserId}`,
        },
        {
          type: "button" as const,
          text: { type: "plain_text", text: "📋 Allow Session", emoji: true },
          action_id: "permission_allow_session",
          value: `allow_session:${requestId}:${requesterUserId}`,
        },
        {
          type: "button" as const,
          text: { type: "plain_text", text: "🔒 Always Allow", emoji: true },
          action_id: "permission_allow_always",
          value: `allow_always:${requestId}:${requesterUserId}`,
        },
        {
          type: "button" as const,
          text: { type: "plain_text", text: "❌ Deny", emoji: true },
          style: "danger",
          action_id: "permission_deny",
          value: `deny:${requestId}:${requesterUserId}`,
        },
      ],
    },
    {
      type: "context" as const,
      elements: [
        {
          type: "mrkdwn",
          text: `:hourglass_flowing_sand: ${timeoutMinutes} 分钟内未响应将自动拒绝`,
        },
      ],
    },
  ];
}
