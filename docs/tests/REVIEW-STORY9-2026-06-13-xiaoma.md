# Code Review Report - ChorusGate STORY-9 (MCP Web API-only Closure)

**Date:** 2026-06-13
**Branch:** `v3/story-8-claude-stream-json` (PR #39, 同 PR 含 STORY-8 M2)
**Reviewer:** xiaoma (小马)
**Review Scope:** STORY-9 改动 — MCP 边界、provider 配置统一、文档收口
**PR:** https://github.com/AINIZE-SPACE/ChorusGate/pull/39
**Issue:** https://github.com/AINIZE-SPACE/ChorusGate/issues/40
**Spec:** `docs/planning/v3-story-9-mcp-webapi-only.md`
**Status:** 评审完成。发现 P0×2 / P1×2 / P2×2，需小克修 P0/P1 后可合

---

## 评审范围

PR #39 范围很大（86 文件，+3454/-1962），含 M2 (STORY-8) + 改名 ChorusGate + STORY-9 MCP 收口。
M2 部分上一轮 REVIEW-v3-2026-06-13 已审完。本评审**只聚焦 STORY-9**。

| 模块 | 文件 | 责任 |
| --- | --- | --- |
| 1. MCP 入口收口 | `src/index.ts` (+10/-154) | 移除 Socket Mode / resources / event stream / `slack_check_events` |
| 2. 删除事件工具 | `src/tools/check-events.ts` (+0/-54) | 文件删除 |
| 3. Provider 统一 | `src/providers/claude.ts` (+45/-97) | 共享 `.claude/mcp.json` 路径 |
| 4. Provider 统一 | `src/providers/claude-stream.ts` (+27/-59) | 同上 |
| 5. Codex MCP 配置 | `src/providers/codex.ts` (+47/-1) | `generateMCPConfig()` 不再写 `MCP_SENDER_ONLY` |
| 6. 配置文件 | `.claude/mcp.json` (+3/-2) | 重命名 `slack-socket`→`chorusgate` |
| 7. 配置示例 | `.claude/mcp.json.example` (+2/-2) | 同上 |
| 8. MCP 启动器 | `bin/chorusgate-mcp.mjs` (+1/-4) | 极简入口（已无 sender-only 分支） |
| 9. 新测试 | `tests/codex-provider.test.ts` (+32) | 验证 Codex TOML 不含 `MCP_SENDER_ONLY` |
| 10. MCP 文档 | `docs/feature-mcp-server.md` (+12/-51) | 移除 resources / event-store / sender-only 三节 |
| 11. 架构文档 | `docs/architecture.md` (+113/-117) | 重写 socket-mode 边界 |
| 12. 顶层文档 | `README.md` (+40/-41), `README_CN.md` (+28/-40), `INSTALL.md` (+32/-17) | 同步 |
| 13. 计划文档 | `docs/planning/v3-story-9-mcp-webapi-only.md` (+62) | 新 spec |
| 14. 其他计划 | 多个 `docs/planning/v3-story-N-*.md` | 交叉引用同步 |

**测试基线：** 61/61 通过（3 suites, ~989ms）— 含本评审新增 1
**类型检查：** clean
**评审环境：** dev clone (`/mnt/e/my_project/ainize/ChorusGate_dev`)。test clone (`ChorusGate_Test`) 同分支但落后若干 commit，WSL2 无外网无法 fetch，实际评审基于 dev clone 的 B Tf38eafa` 提交。

---

## 评审方法

1. 读 STORY-9 spec (62 行) — 提取 6 条验收标准
2. 跑 `npm run typecheck` + `npm test` 拿基线
3. `git diff origin/dev...HEAD` 拉 PR 全部 86 文件清单
4. 逐文件读 STORY-9 相关源（index.ts / codex.ts / claude.ts / claude-stream.ts / mcp.json / mcp.json.example / chorusgate-mcp.mjs / codex-provider.test.ts）
5. `grep -rn MCP_SENDER_ONLY {src,.claude,docs,bin}/` 全仓扫
6. `grep -n SocketMode|WebSocket src/index.ts` 验 Socket Mode 清理
7. `grep -rn slack_check_events src/` 验工具删除
8. 读 `docs/feature-mcp-server.md` diff (b669ea3 → b7f6f23) 验文档收口
9. 读既有 `REPORT-STORY9-2026-06-13-delez.md` (小克的测试报告，判定 PASS) 找覆盖盲点
10. 对照 spec 验收逐条 verify

---

## 发现汇总

| 严重 | 发现 | 已修 | 待修 (本 PR) | 转 backlog |
| --- | ---: | ---: | ---: | ---: |
| P0 Critical | 2 | 0 | 2 | 0 |
| P1 High | 2 | 0 | 2 | 0 |
| P2 Medium | 2 | 0 | 0 | 2 |
| **本评审总计** | **6** | **0** | **4** | **2** |

---

## P0 Critical (2 项 — 本 PR 必修)

### P0-1: `.claude/mcp.json` 在本 PR **新增**了 `MCP_SENDER_ONLY=1`，直接违反 STORY-9 收口

- **位置：** `.claude/mcp.json:7`
- **症状：** 本 PR 把该文件从 `slack-socket` 改名为 `chorusgate` 的同时，**新增**了一行 `MCP_SENDER_ONLY: "1"` 到 env 段：

```diff
   "mcpServers": {
-    "slack-socket": {
+    "chorusgate": {
       "command": "cmd",
-      "args": ["/c", "slack-socket-mcp"],
+      "args": ["/c", "chorusgate-mcp"],
       "env": {
+        "MCP_SENDER_ONLY": "1",
         "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
         "SLACK_APP_TOKEN": "${SLACK_APP_TOKEN}"
       }
     }
   }
```

  spec 验收第 6 条明文要求「文档不再把 `MCP_SENDER_ONLY` 作为主路径配置」 — `.claude/mcp.json` 正是主路径配置，而它在本 PR **主动**把 legacy flag 写进去了。
- **影响：** 当任何 runtime 读 `.claude/mcp.json` 启动 `chorusgate-mcp` 时，会带着 `MCP_SENDER_ONLY=1` 启动。虽然当前 `src/index.ts` 已删 sender-only 分支（即便有 env 也不会分支），但：
  1. 配置与 spec 收口目标直接矛盾 — spec 说"不再作为主路径配置"
  2. 未来若有人加回 sender-only 行为，env 就会自动激活，破坏 Web API-only 边界
  3. `.claude/mcp.json.example` 已无此字段，三方不一致（见 P2-2）
- **修复：** 删 `.claude/mcp.json:7` 那一行。
- **测试：** `grep -n MCP_SENDER_ONLY .claude/mcp.json` → 0 处。

### P0-2: `.claude/mcp.json` 用 Windows-only `cmd /c` 封装，但 `docs/feature-mcp-server.md` 文档写的是跨平台 `chorusgate-mcp`

- **位置：** `.claude/mcp.json:3-4` vs `docs/feature-mcp-server.md`「配置」节
- **症状：**
  - 实际配置：
```json
    "command": "cmd",
    "args": ["/c", "chorusgate-mcp"]
```
  - 文档：
```json
    "command": "chorusgate-mcp",
    "args": []
```
  - `.claude/mcp.json.example` 跟实际一样用 Windows wrapper。
- **影响：**
  1. Mac/Linux 开发者照文档抄配置 → 启动失败（`cmd` 在 Unix 不存在）
  2. 文档与实际不一致，新用户被骗
  3. spec 验收第 3 条「`.claude/mcp.json` 可同时被本地 runtime 与 gateway spawn 的 runtime 复用」隐含跨平台可用
- **修复方案 (二选一)：**
  - (A) 推荐：把 `.claude/mcp.json` 改成跨平台 (`"command": "chorusgate-mcp"`)，与文档一致；`bin/chorusgate-mcp.mjs` 已有 shebang，可在 Unix 直接执行
  - (B) 若 Windows-only 是项目硬约束，更新 `docs/feature-mcp-server.md` 写明 Windows wrapper，并在文件头加注释说明跨平台 TODO
- **测试：** 方案 A — `cat .claude/mcp.json` 与 `docs/feature-mcp-server.md` 文档示例逐字段比对；非 Windows 机器 dry-run `chorusgate-mcp --help`。

---

## P1 High (2 项 — 本 PR 必修)

### P1-1: 既有 `REPORT-STORY9-2026-06-13-delez.md` 的测试用例 T1 系列只覆盖 `src/`，未覆盖 `.claude/mcp.json` 配置文件本身 — 这是 P0-1 漏掉的根因

- **位置：** `docs/tests/plans/PLAN-STORY9-2026-06-13-delez.md` + `REPORT-STORY9-2026-06-13-delez.md`
- **症状：** T1-1 ~ T1-7 全部针对 `src/index.ts` 或 `src/`，没有一条针对 `.claude/mcp.json` 或 `.claude/mcp.json.example`。T2-1 ~ T2-6 覆盖 README/INSTALL/architecture/gotchas，也没碰 `.claude/mcp.json`。结果 P0-1 漏网。
- **影响：** 测试覆盖盲点。STORY-9 spec 验收第 6 条「文档不再把 `MCP_SENDER_ONLY` 作为主路径配置」中"主路径配置"明确指 `.claude/mcp.json`，但测试计划完全跳过它。
- **修复：** 在 PLAN 里加：
  - T1-8: `.claude/mcp.json` 不包含 `MCP_SENDER_ONLY`（`grep`）
  - T1-9: `.claude/mcp.json` 和 `.claude/mcp.json.example` 的 server 列表一致（除敏感字段外）
  - T2-7: `docs/feature-mcp-server.md` 中的配置示例与 `.claude/mcp.json.example` 字段一致
- **测试：** 三条新 case + 重跑 REPORT 流程。

### P1-2: `docs/feature-mcp-server.md` 工具表只列 7 个工具，实际 `src/index.ts` 注册 8 个（缺 `getSkillListTool`）

- **位置：** `docs/feature-mcp-server.md`「MCP Tools」表
- **症状：**
  - 文档表：reply, send_message, add_reaction, channel_history, thread_replies, list_channels, get_user_info = 7 个
  - 实际 `src/index.ts` 工具数组：replyTool, sendMessageTool, addReactionTool, channelHistoryTool, threadRepliesTool, listChannelsTool, getUserInfoTool, **getSkillListTool** = 8 个
  - diff 中 `+import { getSkillListTool } from "./tools/get-skill-list.js"` 和 `+  getSkillListTool,` 确认第 8 个工具是本 PR 新加的，但 doc 表没更新。
- **影响：** 文档与实现漂移；用户/开发者查文档时漏掉一个工具能力。
- **修复：** 在 doc 表加一行 `slack_get_skill_list`（或工具实际名）。
- **测试：** 数 `src/index.ts` tools 数组长度 vs 文档表行数，应一致。

---

## P2 Medium (2 项 — 转 sprint backlog)

### P2-1: `.claude/mcp.json` 含 `trello` MCP server，但 `.claude/mcp.json.example` 没有
- 两个文件应仅在敏感字段/注释上有差异；server 列表不一致是疏漏。
- **建议：** 在 example 里也加 trello 段（或从实际配置里删 trello）。

### P2-2: 三方配置文档不一致
- `.claude/mcp.json` (实际), `.claude/mcp.json.example` (示例), `docs/feature-mcp-server.md` (文档) — 三处的 server 列表、env 字段、命令格式各不一样。
- **建议：** 引入单一 source of truth（例如从代码生成 example，或在 doc 里加"以 `.claude/mcp.json.example` 为准"声明）。

---

## 验证日志

### 类型检查
```text
$ npm run typecheck
> tsc --noEmit
PASS
```

### 单元 + 集成测试
```text
$ npm test
ℹ tests 61
ℹ suites 3
ℹ pass 61
ℹ fail 0
ℹ duration_ms 989.4
```

### `MCP_SENDER_ONLY` 全仓扫描
```text
$ grep -rn MCP_SENDER_ONLY src/ bin/      → 0 处
$ grep -rn MCP_SENDER_ONLY .claude/       → 1 处 (.claude/mcp.json:7)  ← P0-1
$ grep -rn MCP_SENDER_ONLY docs/          → 仅 spec 与 test artifacts (合规)
```

### Socket Mode / `slack_check_events` 扫描
```text
$ grep -n SocketMode|WebSocket src/index.ts   → 0 处
$ grep -rn slack_check_events src/            → 0 处
$ ls src/tools/check-events.ts                → 不存在
```
全部干净 ✓

### `src/tools/` 当前内容（8 个工具）
```text
channel-history.ts   get-skill-list.ts   get-user.ts
list-channels.ts     react.ts            reply.ts
send-message.ts      thread-replies.ts
```

---

## 关于评审环境的说明

按 code-review-workflow skill 惯例，评审应在 test clone (`ChorusGate_Test`) 进行。
实际情况：test clone 与 dev clone 同分支名 (`v3/story-8-claude-stream-json`)，
但 test clone 落后若干 commit (最新 `4a38535`，dev 最新 `f38eafa`)。
WSL2 terminal 无外网 (`Could not resolve host: github.com`)，
无法 `git fetch` 更新 test clone。

故本次评审基于 dev clone 的 `f38eafa` 提交（含 STORY-9 commit）。
REVIEW + ISSUES 文档直接写到 dev clone 的 `docs/tests/`，便于小克在 PR 内一并提交。
test clone 的 `docs/tests/` 暂未同步（小克 fetch 后可同步）。

---

## 下一步

- [ ] 小克修 P0-1 (删 `.claude/mcp.json:7` `MCP_SENDER_ONLY` 行)
- [ ] 小克修 P0-2 (统一命令格式 — 选 A 跨平台或 B 文档同步 Windows)
- [ ] 小克补 P1-1 (扩 PLAN + REPORT 覆盖 `.claude/mcp.json`)
- [ ] 小克补 P1-2 (doc 表加 `getSkillListTool`)
- [ ] P2-1, P2-2 转 sprint backlog，开 GitHub issue 跟踪
- [ ] 重跑 `npm run typecheck` + `npm test`，需仍 61/61
- [ ] 小马二次验收
- [ ] 合 dev → main

---

**Reviewer:** xiaoma (小马)
**关联 PR:** #39
**关联 issues:** #40 (STORY-9 epic), #41-#46 (本评审新开 P0x2 / P1x2 / P2x2)
**生成时间:** 2026-06-13
