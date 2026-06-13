# Issue Tracking - ChorusGate STORY-9 Code Review (xiaoma / 小马)

**Generated:** 2026-06-13 (初版) / 2026-06-14 (re-review 闭环)
**Branch:** `v3/story-8-claude-stream-json`
**Reviewer:** xiaoma (小马)
**Review Doc:** [REVIEW-STORY9-2026-06-13-xiaoma.md](./REVIEW-STORY9-2026-06-13-xiaoma.md)
**Re-Review Doc:** [REVIEW-STORY9-R2-2026-06-14-xiaoma.md](./REVIEW-STORY9-R2-2026-06-14-xiaoma.md)
**关联 Epic:** #40 (STORY-9 MCP Web API-only)
**关联 PR:** #39
**当前状态：** ✅ **6/6 Resolved (commit af4826e)** — 可合 dev → main

---

## 概要

| 严重 | 发现 | 已修 | 待修 (本 PR) | 转 backlog |
| --- | ---: | ---: | ---: | ---: |
| P0 Critical | 2 | 2 | 0 | 0 |
| P1 High | 2 | 2 | 0 | 0 |
| P2 Medium | 2 | 2 | 0 | 0 |
| **总计** | **6** | **6** | **0** | **0** |

修复 commit: `af4826e` (Address STORY-9 review findings, 4 files, +24/-4)
GitHub 状态: #41–#46 全部 CLOSED (2026-06-14)

---

## Open — 本 PR 必修

(空 — 全部已修)

---

## Backlog — 转 sprint 后续

(空 — P2 也在本 PR 修了)

---

## Resolved (6 项 — 全部由 af4826e 修复)

### ISSUE-STORY9-P0-1: `.claude/mcp.json` 在本 PR 新增了 `MCP_SENDER_ONLY=1` ✅ Resolved

- **严重：** P0
- **文件：** `.claude/mcp.json:7` (修复前)
- **症状：** 本 PR 把 server 从 `slack-socket` 改名为 `chorusgate` 时，主动 env 段新增了 `MCP_SENDER_ONLY: "1"` 一行。与 spec 验收第 6 条「文档不再把 `MCP_SENDER_ONLY` 作为主路径配置」直接矛盾。
- **修复 (af4826e)：** 删 `.claude/mcp.json` env 段的 `MCP_SENDER_ONLY` 行。改后与 `.claude/mcp.json.example` 一致。
- **测试 (T1-8 新加)：** `grep -n MCP_SENDER_ONLY .claude/mcp.json` → 0 处。
- **GitHub issue：** #41 → **CLOSED**
- **状态：** ✅ Resolved (af4826e)

### ISSUE-STORY9-P0-2: `.claude/mcp.json` 用 Windows-only `cmd /c` 封装，与 `docs/feature-mcp-server.md` 文档不一致 ✅ Resolved

- **严重：** P0
- **文件：** `.claude/mcp.json:3-4` vs `docs/feature-mcp-server.md`
- **症状：** 实际配置 `"command": "cmd", "args": ["/c", "chorusgate-mcp"]`，文档示例 `"command": "chorusgate-mcp", "args": []`。Mac/Linux 照文档抄会启动失败。
- **修复 (af4826e)：** 采用方案 B — 文档主示例改为 Windows wrapper（与 `.claude/mcp.json.example` 一致），并在文档末尾加「非 Windows 环境如果已能直接解析 `chorusgate-mcp`，可改为：…」块 + 完整 JSON。三方配置现已对齐。
- **测试 (T2-7 新加)：** doc 配置示例与 `.claude/mcp.json.example` 字段一致性 人工审查通过。
- **GitHub issue：** #42 → **CLOSED**
- **状态：** ✅ Resolved (af4826e)

### ISSUE-STORY9-P1-1: 既有 REPORT-STORY9 测试计划 T1 系列未覆盖 `.claude/mcp.json` 配置文件 — P0-1 漏掉的根因 ✅ Resolved

- **严重：** P1
- **文件：** `docs/tests/plans/PLAN-STORY9-2026-06-13-delez.md` + `docs/tests/reports/REPORT-STORY9-2026-06-13-delez.md`
- **症状：** T1-1 ~ T1-7 全部针对 `src/`，无一条针对 `.claude/mcp.json` 或 `.claude/mcp.json.example`。T2-1 ~ T2-6 覆盖 README/INSTALL/architecture/gotchas 也未碰 `.claude/mcp.json`。spec 验收第 6 条明确「主路径配置」即 `.claude/mcp.json`，但被测试计划跳过。
- **修复 (af4826e)：** PLAN + REPORT 同步加 3 条 case：
  - T1-8: `.claude/mcp.json` 不含 `MCP_SENDER_ONLY` (`grep`)
  - T1-9: `.claude/mcp.json` 与 `.claude/mcp.json.example` 配置骨架一致（人工审查）
  - T2-7: `docs/feature-mcp-server.md` 配置示例与 `.claude/mcp.json.example` 一致（人工审查）
  - PLAN 的「T1 命令」块加 `grep -n "MCP_SENDER_ONLY" .claude/mcp.json` 一行
- **测试：** 三条新 case + REPORT 重跑，af4826e 后 61/61 通过。
- **GitHub issue：** #43 → **CLOSED**
- **状态：** ✅ Resolved (af4826e)
- **后续 P3 建议 (本 PR 不阻塞)：** T1-9 和 T2-7 是「人工审查」，可改 `diff <(jq '.mcpServers.chorusgate' .claude/mcp.json) <(jq '.mcpServers.chorusgate' .claude/mcp.json.example)` 自动化。

### ISSUE-STORY9-P1-2: `docs/feature-mcp-server.md` 工具表漏列第 8 个工具 `getSkillListTool` ✅ Resolved

- **严重：** P1
- **文件：** `docs/feature-mcp-server.md`「MCP Tools」表
- **症状：** 文档表 7 个工具；`src/index.ts` 工具数组实际 8 个（含本 PR 新加的 `getSkillListTool`）。doc drift。
- **修复 (af4826e)：** doc 表加一行 `| slack_get_skill_list | 列出可用 ChorusGate skills 与触发说明 |`。共 8 行。
- **测试：** 数 `src/tools/*.ts` 文件 = 8 个 (channel-history, get-skill-list, get-user, list-channels, react, reply, send-message, thread-replies) 与 doc 表行数一致。
- **GitHub issue：** #44 → **CLOSED**
- **状态：** ✅ Resolved (af4826e)

### ISSUE-STORY9-P2-1: `.claude/mcp.json` 含 `trello` server，但 `.claude/mcp.json.example` 没有 ✅ Resolved

- **严重：** P2
- **症状：** 两个文件应仅在敏感字段/注释上有差异；server 列表不一致是疏漏。
- **修复 (af4826e)：** `.claude/mcp.json` 与 `.claude/mcp.json.example` 现在完全一致（都含 `chorusgate` + `trello` 两个 server）。
- **测试 (T1-9)：** 验证 `chorusgate` 段一致；`trello` 段也通过同一 diff 验证（人工审查）。
- **GitHub issue：** #45 → **CLOSED**
- **状态：** ✅ Resolved (af4826e)

### ISSUE-STORY9-P2-2: 三方配置文档不一致（实际 / example / feature doc） ✅ Resolved

- **严重：** P2
- **症状：** `.claude/mcp.json` (实际), `.claude/mcp.json.example` (示例), `docs/feature-mcp-server.md` (文档) — 三处的 server 列表、env 字段、命令格式各不一样。
- **修复 (af4826e)：** 三方对齐：
  - `.claude/mcp.json` ≡ `.claude/mcp.json.example` (diff 0)
  - doc 主示例 (chorusgate 段) 与两配置文件一致
  - doc 加「非 Windows 替代」块
  - doc 主示例是 chorusgate 最小段，trello 段用「请以 `.claude/mcp.json.example` 里的完整 server 列表为准」指向 .example
- **测试 (T1-9 + T2-7)：** 通过。
- **GitHub issue：** #46 → **CLOSED**
- **状态：** ✅ Resolved (af4826e)

---

## 验证步骤 (af4826e 后自验) — 全部通过 ✅

1. ✅ `npm run typecheck` — 0 error
2. ✅ `npm test` — 61/61 (1.08s)
3. ✅ `grep -rn MCP_SENDER_ONLY .claude/ src/ bin/` — 0 处
4. ✅ `cat .claude/mcp.json` 与 `docs/feature-mcp-server.md` 文档示例（chorusgate 段）逐字段比对 — 一致
5. ✅ `cat .claude/mcp.json` 与 `.claude/mcp.json.example` diff — 0 行
6. ✅ 数 `src/tools/*.ts` (8) vs `docs/feature-mcp-server.md` 工具表行数 (8) — 一致
7. ✅ spec 6 条验收逐条对照 — 全部 ✅
8. ✅ GitHub issues #41–#46 — 全部 CLOSED

---

## Reviewer Sign-off

- [x] P0/P1 修复方案已对齐小克
- [x] 小克 verify 通过（typecheck 0 error + 61/61 tests pass）
- [x] GitHub issues #41–#46 全部 CLOSED
- [x] 小马二次验收通过 (REVIEW-STORY9-R2-2026-06-14-xiaoma.md)
- [ ] 合并 PR #39 → dev → main

---

**Reviewer:** xiaoma (小马)
**初版生成时间:** 2026-06-13
**Re-review 闭环时间:** 2026-06-14
**修复 commit:** `af4826e` (xiaoma-authored re-review fix)
