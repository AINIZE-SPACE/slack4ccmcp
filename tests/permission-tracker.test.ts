// ============================================================
// PermissionTracker 测试 — 4-button approval scope support
//
// 跟踪: [#34](https://github.com/AINIZE-SPACE/chorusgate/issues/34)
// 跟踪: [#32](https://github.com/AINIZE-SPACE/chorusgate/issues/32)
// ============================================================

import test from "node:test";
import assert from "node:assert/strict";
import { PermissionTracker, buildApprovalBlocks } from "../src/permission-tracker.js";

// ---- waitForApproval / handleAction (new 4-button scope API) ----------------

test("PermissionTracker resolves 'once' via handleAction", async () => {
  const tracker = new PermissionTracker(5000);

  const promise = tracker.waitForApproval("req_001", {
    toolName: "Bash",
    toolInput: { command: "ls" },
    channel: "C123",
    threadTs: "123.456",
    requesterUserId: "U001",
  });

  assert.equal(tracker.pendingCount, 1);

  const result = tracker.handleAction("allow_once:req_001:U001");
  assert.equal(result.handled, true);
  assert.equal(result.scope, "once");
  assert.equal(result.granted, true);

  const scope = await promise;
  assert.equal(scope, "once");
});

test("PermissionTracker resolves 'session' via handleAction", async () => {
  const tracker = new PermissionTracker(5000);

  const promise = tracker.waitForApproval("req_sess", {
    toolName: "Bash",
    toolInput: { command: "ls" },
    channel: "C123",
    threadTs: "456.789",
    requesterUserId: "U001",
  });

  const result = tracker.handleAction("allow_session:req_sess:U001");
  assert.equal(result.handled, true);
  assert.equal(result.scope, "session");

  const scope = await promise;
  assert.equal(scope, "session");
});

test("PermissionTracker auto-approves subsequent same-tool requests after session scope", async () => {
  const tracker = new PermissionTracker(5000);

  // First request — user chooses "session"
  const p1 = tracker.waitForApproval("req_1", {
    toolName: "Bash",
    toolInput: {},
    channel: "C123",
    threadTs: "thread_1",
    requesterUserId: "U001",
  });
  tracker.handleAction("allow_session:req_1:U001");
  assert.equal(await p1, "session");

  // Second request for same tool, same session key — should auto-approve
  const autoScope = tracker.checkAutoApproval("C123:thread_1", "Bash", "U001");
  assert.equal(autoScope, "session");
});

test("PermissionTracker auto-approves after 'always' scope", async () => {
  const tracker = new PermissionTracker(5000);

  const p1 = tracker.waitForApproval("req_a", {
    toolName: "Bash",
    toolInput: {},
    channel: "C99",
    threadTs: "t99",
    requesterUserId: "U001",
  });
  tracker.handleAction("allow_always:req_a:U001");
  assert.equal(await p1, "always");

  const autoScope = tracker.checkAutoApproval("C99:t99", "Bash", "U001");
  assert.equal(autoScope, "always");
});

// ---- SessionIdentity-aware auto-approval (P0 fix #50) -----------------------

test("auto-approval respects SessionIdentity — cross-profile isolation", async () => {
  const tracker = new PermissionTracker(5000);

  // Approve "session" with profile=cc, provider=claude
  const p1 = tracker.waitForApproval("req_cp_1", {
    toolName: "Bash",
    toolInput: {},
    channel: "C",
    threadTs: "T",
    requesterUserId: "U",
    sessionIdentity: "cc:claude:C:T",
  });
  tracker.handleAction("allow_session:req_cp_1:U");
  assert.equal(await p1, "session");

  // Same channel/thread but different profile (codex) — should NOT auto-approve
  const auto = tracker.checkAutoApproval("codex:codex:C:T", "Bash", "U");
  assert.equal(auto, null);
});

test("auto-approval respects SessionIdentity — cross-project isolation", async () => {
  const tracker = new PermissionTracker(5000);

  // Approve "always" with projectDir=/a
  const p1 = tracker.waitForApproval("req_proj_1", {
    toolName: "Bash",
    toolInput: {},
    channel: "C",
    threadTs: "T",
    requesterUserId: "U",
  });
  tracker.handleAction("allow_always:req_proj_1:U");
  await p1;

  // Different user in same thread — should NOT auto-approve
  const auto = tracker.checkAutoApproval("cc:claude:C:T", "Bash", "U_other");
  assert.equal(auto, null);
});

test("auto-approval 'always' scope works for same user across sessions", async () => {
  const tracker = new PermissionTracker(5000);

  const p1 = tracker.waitForApproval("req_xsess_1", {
    toolName: "Bash",
    toolInput: {},
    channel: "C",
    threadTs: "T1",
    requesterUserId: "U_X",
  });
  tracker.handleAction("allow_always:req_xsess_1:U_X");
  await p1;

  // Same user, different thread, different profile — still auto-approves
  const auto = tracker.checkAutoApproval("cc:claude:C:T2", "Bash", "U_X");
  assert.equal(auto, "always");
});

// ---- deny via handleAction -------------------------------------------------

test("PermissionTracker resolves 'deny' via handleAction", async () => {
  const tracker = new PermissionTracker(5000);

  const promise = tracker.waitForApproval("req_002", {
    toolName: "Write",
    toolInput: { file_path: "/tmp/test" },
    channel: "C456",
    threadTs: "789.012",
    requesterUserId: "U002",
  });

  const result = tracker.handleAction("deny:req_002:U002");
  assert.equal(result.handled, true);
  assert.equal(result.scope, "deny");
  assert.equal(result.granted, false);

  const scope = await promise;
  assert.equal(scope, "deny");
});

// ---- legacy compat: old "approve" maps to "once" ---------------------------

test("PermissionTracker handleAction legacy 'approve' format", async () => {
  const tracker = new PermissionTracker(5000);
  const promise = tracker.waitForApproval("req_legacy", {
    toolName: "Bash",
    toolInput: {},
    channel: "C",
    threadTs: "1",
    requesterUserId: "U_X",
  });
  const result = tracker.handleAction("approve:req_legacy:U_X");
  assert.equal(result.handled, true);
  assert.equal(result.scope, "once");
  assert.equal(await promise, "once");
});

// ---- explicit approve/deny (legacy compat) ----------------------------------

test("PermissionTracker.approve / .deny work directly", async () => {
  const tracker = new PermissionTracker(5000);

  const p1 = tracker.waitForApproval("req_a", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1", requesterUserId: "U_A",
  });
  const p2 = tracker.waitForApproval("req_b", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1", requesterUserId: "U_B",
  });

  tracker.approve("req_a"); // once scope
  tracker.deny("req_b");

  assert.equal(await p1, "once");
  assert.equal(await p2, "deny");
});

// ---- timeout auto-denies ---------------------------------------------------

test("PermissionTracker auto-denies on timeout", async () => {
  const tracker = new PermissionTracker(100);

  const promise = tracker.waitForApproval("req_timeout", {
    toolName: "Bash",
    toolInput: {},
    channel: "C",
    threadTs: "1",
    requesterUserId: "U_TIMEOUT",
  });

  const scope = await promise;
  assert.equal(scope, "deny");
  assert.equal(tracker.pendingCount, 0);
});

// ---- unknown action value --------------------------------------------------

test("PermissionTracker.handleAction ignores unknown format", () => {
  const tracker = new PermissionTracker();

  assert.equal(tracker.handleAction("").handled, false);
  assert.equal(tracker.handleAction("unknown").handled, false);
  assert.equal(tracker.handleAction("unknown:req_001").handled, false);
  // Missing requesterUserId segment — should be handled as false
  assert.equal(tracker.handleAction("allow_once:req_x").handled, false);
});

// ---- clear -----------------------------------------------------------------

test("PermissionTracker.clear resolves all pending as denied", async () => {
  const tracker = new PermissionTracker(5000);

  const p1 = tracker.waitForApproval("req_1", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1", requesterUserId: "U_1",
  });
  const p2 = tracker.waitForApproval("req_2", {
    toolName: "Bash", toolInput: {}, channel: "C", threadTs: "1", requesterUserId: "U_2",
  });

  tracker.clear();

  assert.equal(tracker.pendingCount, 0);
  assert.equal(await p1, "deny");
  assert.equal(await p2, "deny");
});

// ---- buildApprovalBlocks (4-button) -----------------------------------------

test("buildApprovalBlocks returns 4-button Slack blocks", () => {
  const blocks = buildApprovalBlocks(
    "Bash",
    { command: "rm -rf dist/" },
    "req_test_blocks",
    "U_TEST",
  );

  assert.ok(Array.isArray(blocks));
  assert.ok(blocks.length >= 4, "should have at least 4 blocks");

  const actionsBlock = blocks.find(
    (b: Record<string, unknown>) => b.type === "actions",
  );
  assert.ok(actionsBlock, "should have an actions block");

  const elements = actionsBlock.elements as Array<Record<string, unknown>>;
  assert.equal(elements.length, 4, "should have 4 buttons");

  // Allow Once
  assert.equal(elements[0].action_id, "permission_allow_once");
  assert.equal(elements[0].value, "allow_once:req_test_blocks:U_TEST");

  // Allow Session
  assert.equal(elements[1].action_id, "permission_allow_session");
  assert.equal(elements[1].value, "allow_session:req_test_blocks:U_TEST");

  // Always Allow
  assert.equal(elements[2].action_id, "permission_allow_always");
  assert.equal(elements[2].value, "allow_always:req_test_blocks:U_TEST");

  // Deny
  assert.equal(elements[3].action_id, "permission_deny");
  assert.equal(elements[3].value, "deny:req_test_blocks:U_TEST");

  // Context block with timeout
  const contextBlock = blocks.find(
    (b: Record<string, unknown>) => b.type === "context",
  );
  assert.ok(contextBlock, "should have a context block");
});

// ---- integration-style: requesterUserId returned for gateway auth check ----

test("PermissionTracker: requesterUserId returned for gateway auth check", async () => {
  const tracker = new PermissionTracker();

  const promise = tracker.waitForApproval("req_auth", {
    toolName: "Bash",
    toolInput: {},
    channel: "C",
    threadTs: "1",
    requesterUserId: "U_REAL_OWNER",
  });

  const result = tracker.handleAction("allow_once:req_auth:U_REAL_OWNER");
  assert.equal(result.requesterUserId, "U_REAL_OWNER");
  assert.equal(result.handled, true);

  await promise;
});

// ---- handleAction parses requestId containing colons ------------------------

test("PermissionTracker handleAction parses requestId containing colons", async () => {
  const tracker = new PermissionTracker();

  const promise = tracker.waitForApproval("claude:req:a/b", {
    toolName: "Bash",
    toolInput: {},
    channel: "C",
    threadTs: "1",
    requesterUserId: "U_COLON",
  });

  const result = tracker.handleAction("allow_once:claude:req:a/b:U_COLON");
  assert.equal(result.handled, true);
  assert.equal(result.scope, "once");

  await promise;
});
