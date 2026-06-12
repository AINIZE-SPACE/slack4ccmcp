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

---

## v3 EPIC: Multi-Agent Multi-Project Gateway

> 规划文档：[docs/planning/v3-epic.md](./docs/planning/v3-epic.md)

| Issue | Story | Priority | Status |
|-------|-------|----------|--------|
| [#22](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/22) | Provider 抽象层 — AgentProvider 接口 + Parser 抽象 | P0 | 🟡 in_progress |
| [#23](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/23) | Codex Provider — \`codex exec\` spawn + JSONL 解析 | P0 | 📋 planned |
| [#24](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/24) | 多 Slack App Socket Mode — 多 SocketModeClient 实例 | P0 | 📋 planned |
| [#25](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/25) | 会话级多项目 — sessionStore.projectDir | P1 | 📋 planned |
| [#26](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/26) | 统一 Session 模型 — CC UUID + Codex thread_id | P0 | 📋 planned |
| [#27](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/27) | 多 Agent/App 配置系统 — GATEWAY_PROFILES | P0 | 📋 planned |
| [#28](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/28) | Codex Slack MCP Tools — TOML 配置生成 | P1 | 📋 planned |
| [#32](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/32) | Slack approval/control loop (stream-json) | P0 | 📋 planned |
| [#33](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/33) | Session-level git worktree isolation | P1 | ⏸️ deferred |
| [#34](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/34) | Claude 双向 stream-json 控制面 — approve/deny | P0 | 📋 planned |

### v3 里程碑

- **M1: 双 Agent 核心** (#22, #23, #26) — Provider 抽象 + Codex spawn + 统一 session ✅
- **M2: Claude stream-json 控制面** (#34, #32) — 双向 stdin/stdout + Slack approve/deny
- **M3: 多 Slack App** (#24, #27) — 多 profile + 多 Socket Mode 连接
- **M4: 多项目 + Slack 工具** (#25, #28) — 会话级 cwd + Codex Slack MCP

详见 [docs/planning/v3-epic.md](./docs/planning/v3-epic.md)
