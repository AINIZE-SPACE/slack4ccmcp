# Issue Tracking - slack4ccmcp Code Review

Generated: 2026-06-12  
Branch: `dev`  
Repo: AINIZE-SPACE/slack4ccmcp

---

## Open Code Review Issues

None. All code-review issues #11 through #21 are resolved or intentionally
closed as by-design.

---

## Resolved Issues

| Issue | Severity | Title | Resolution |
| --- | --- | --- | --- |
| #11 | Critical | Token logging in gateway.ts | Fixed token redaction |
| #12 | High | `slack_reply` does not mark events handled | Fixed handled marking |
| #13 | Medium | Windows CRLF breaks stream-json parsing | Fixed CR stripping |
| #14 | Medium | Duplicated bootstrap code | Extracted `src/bootstrap.ts` |
| #15 | Medium | Missing build/lint scripts | Added TypeScript validation scripts |
| #16 | Medium | No automated test coverage | Added `npm test` and focused store tests |
| #17 | Medium | Inconsistent MCP tool error handling | Added structured `ToolError` handling |
| #18 | Low | `.env.example` incomplete | Expanded env documentation |
| #19 | Low | Duplicate root `.mcp.json` | Removed duplicate root config; canonical config is `.claude/mcp.json` |
| #20 | Low | Module-level cwd() path side effect | Added lazy gateway path helpers |
| #21 | Low | `list-channels` lacks pagination | Added cursor and auto-pagination support |

---

## Verification

```bash
npm run typecheck
npm test
```

Both commands pass on Windows/PowerShell.

---

## Remaining Product/Planning Issues

The remaining open GitHub issues are roadmap or feature planning items, not
unresolved code-review bugs:

- #1 durable event state and retry queue
- #2 session host for interactive Claude Code commands
- #3 Slack slash command UX with ephemeral responses
- #4 next-version workspace gateway roadmap
- #5 gateway/channel provider abstraction
- #6 Slack command/control surface
- #7 Feishu/Lark channel support
- #8 multi-agent runtime adapters
- #9 install/uninstall/doctor lifecycle commands
- #10 open-source readiness and competitive positioning
