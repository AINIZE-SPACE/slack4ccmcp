# Code Review Report - slack4ccmcp (dev branch)

**Date:** 2026-06-12  
**Branch:** `dev`  
**Review Scope:** Full codebase plus code-review GitHub issues  
**Status:** All review findings addressed

---

## Summary

| Severity | Found | Fixed | Pending |
| --- | ---: | ---: | ---: |
| Critical | 1 | 1 | 0 |
| High | 1 | 1 | 0 |
| Medium | 5 | 5 | 0 |
| Low | 5 | 5 | 0 |
| **Total** | **12** | **12** | **0** |

The original review found 12 items. Seven had already been fixed before this
pass. This pass resolved the remaining five:

- #16 automated test coverage
- #17 structured MCP tool error handling
- #19 duplicate root `.mcp.json`
- #20 module-load `process.cwd()` path capture
- #21 Slack channel pagination

Verification:

```bash
npm run typecheck
npm test
```

Both commands pass.

---

## Resolved Findings

### CRITICAL-001: Token logging in gateway.ts

**Status:** Fixed  
**GitHub:** #11 closed

Startup logging no longer prints full Slack tokens.

### HIGH-001: slack_reply did not mark events as handled

**Status:** Fixed  
**GitHub:** #12 closed

`slack_reply` now marks matching events handled after a successful reply.

### MEDIUM-001: Windows CRLF broke stream-json parsing

**Status:** Fixed  
**GitHub:** #13 closed

`reply-engine.ts` strips `\r` before parsing stream-json lines.

### MEDIUM-002: Duplicated bootstrap code

**Status:** Fixed  
**GitHub:** #14 closed

Shared bootstrap moved to `src/bootstrap.ts`.

### MEDIUM-003: Missing build/lint scripts

**Status:** Fixed  
**GitHub:** #15 closed

`build`, `typecheck`, and `lint` scripts now run `tsc --noEmit`.

### MEDIUM-004: No automated tests

**Status:** Fixed  
**GitHub:** #16 closed

Added `npm test` using Node's built-in test runner with `tsx`, plus focused
coverage for:

- `EventStore` ring-buffer eviction
- `EventStore` pending filtering and `markHandled`
- `SessionStore` markdown persist/reload
- `SessionStore` idle eviction

### MEDIUM-005: Inconsistent MCP tool error handling

**Status:** Fixed  
**GitHub:** #17 closed

Added `src/tool-errors.ts` with `ToolError`, Slack API error mapping, and
structured MCP error serialization. Slack tools now return consistent
`{ ok: false, error: { code, message, details? } }` payloads through the MCP
handler on failure.

### LOW-001: .env.example incomplete

**Status:** Fixed  
**GitHub:** #18 closed

`.env.example` documents gateway and Claude-related environment variables.

### LOW-002: `_event` unused parameter

**Status:** By design

The underscore convention is appropriate for a required callback parameter.

### LOW-003: Duplicate root `.mcp.json`

**Status:** Fixed  
**GitHub:** #19 closed

The duplicate root `.mcp.json` and `.mcp.json.example` were removed. The
canonical project MCP config is `.claude/mcp.json`, with an example at
`.claude/mcp.json.example`.

### LOW-004: Module-level cwd() side effect in gateway-paths.ts

**Status:** Fixed  
**GitHub:** #20 closed

Gateway control-plane paths are now computed lazily through `getPidFile()`,
`getLogFile()`, `getStatusFile()`, and `getGatewayDir()` instead of being frozen
at module import time.

### LOW-005: list-channels does not support pagination

**Status:** Fixed  
**GitHub:** #21 closed

`slack_list_channels` now auto-paginates up to the requested limit, accepts an
optional `cursor`, and returns `next_cursor` when more channels remain.

---

## Files Changed In Final Pass

| File | Change |
| --- | --- |
| `.mcp.json` / `.mcp.json.example` | Removed duplicate root MCP configs |
| `.claude/mcp.json.example` | Added canonical project MCP example |
| `package.json` | Added `npm test` |
| `src/tool-errors.ts` | New structured tool error helpers |
| `src/index.ts` | Structured MCP tool error serialization |
| `src/tools/*.ts` | Slack API failures now use mapped tool errors |
| `src/tools/list-channels.ts` | Added pagination and cursor support |
| `src/types.ts` | Added list-channel cursor fields |
| `src/gateway-paths.ts` | Lazy path helpers |
| `src/gateway-control.ts` | Uses lazy path helpers |
| `src/gateway.ts` | Uses lazy path helpers |
| `src/event-store.ts` | Exported injectable store for tests |
| `src/session-store.ts` | Exported injectable store with testable file path |
| `tests/event-store.test.ts` | New tests |
| `tests/session-store.test.ts` | New tests |

---

## Verification Log

```text
npm run typecheck
> tsc --noEmit
PASS

npm test
> node --import tsx --test tests/**/*.test.ts
4 tests passed
```
