# Re-Review Report - ChorusGate STORY-9 (PR #39 commit af4826e)

**Date:** 2026-06-14
**Branch:** `v3/story-8-claude-stream-json` (PR #39)
**Reviewer:** xiaoma (小马)
**Review Scope:** 对 af4826e "Address STORY-9 review findings" 的二次验收
**Base Review:** [REVIEW-STORY9-2026-06-13-xiaoma.md](./REVIEW-STORY9-2026-06-13-xiaoma.md)
**Issue Tracking:** [ISSUES-STORY9-2026-06-13.md](./ISSUES-STORY9-2026-06-13.md)
**PR:** https://github.com/AINIZE-SPACE/ChorusGate/pull/39
**Status:** ✅ **PASS — 6 项发现全部修复，可合 dev → main**

---

## 评审范围

仅二次验收 af4826e (1 commit, 4 files, +24/-4) 是否真的解决了上一轮 6 项发现 (#41–#46)。
M2 / STORY-8 / 改名等其他 PR 范围不在本评审内。

| 修复声明 | 落点文件 | 对应 issue | 实际行数 |
| --- | --- | --- | --- |
| 1. 移除 `.claude/mcp.json` 中 `MCP_SENDER_ONLY` | `.claude/mcp.json` | #41 (P0-1) | -1 行 |
| 2. 补 `slack_get_skill_list` 到 doc 工具表 | `docs/feature-mcp-server.md` | #44 (P1-2) | +1 行 |
| 3. 对齐 doc 配置示例与 `.claude/mcp.json.example` (Windows wrapper) + 加非 Windows 替代 | `docs/feature-mcp-server.md` | #42 (P0-2) #45 (P2-1) #46 (P2-2) | +13/-2 行 |
| 4. 补强测试计划/报告，显式覆盖 `.claude/mcp.json` | `docs/tests/plans/PLAN-STORY9-*.md` + `docs/tests/reports/REPORT-STORY9-*.md` | #43 (P1-1) | +9/-2 行 |

---

## 评审方法

1. 读 af4826e commit 的完整 diff (4 文件)
2. 读 STORY-9 spec 6 条验收标准，对照修复后状态
3. `cat .claude/mcp.json` + `cat .claude/mcp.json.example` 实际内容三方比对
4. 读 `docs/feature-mcp-server.md` 完整新版本
5. 读新 PLAN/REPORT 的 T1-8 / T1-9 / T2-7 内容
6. `grep -rn MCP_SENDER_ONLY {src,.claude,docs,bin}/` 全仓扫（验收 spec 第 6 条）
7. `gh issue view #41–#46` 查 GitHub 状态
8. 跑 `npm run typecheck` + `node --import tsx --test tests/*.test.ts` 拿 baseline

---

## 逐项验收 (6 项)

### 修复 #41 (P0-1): `.claude/mcp.json` 已无 `MCP_SENDER_ONLY` ✅

`git show af4826e -- .claude/mcp.json` 确认删除该行。当前文件 env 段只剩 `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` 两个 env 引用。`grep -n MCP_SENDER_ONLY .claude/mcp.json` → 0 处。

**结论：完全符合 spec 验收第 6 条「文档不再把 `MCP_SENDER_ONLY` 作为主路径配置」。**

### 修复 #42 (P0-2) / #45 (P2-1) / #46 (P2-2): 三方配置对齐 ✅

**采用方案 B（Windows wrapper 为基线，doc 加非 Windows 替代）**：

| 文件 | 实际内容 | 备注 |
| --- | --- | --- |
| `.claude/mcp.json` | `cmd` + `args: ["/c", "chorusgate-mcp"]` + `chorusgate` + `trello` | dev 本地实际 |
| `.claude/mcp.json.example` | 与上完全相同 | 模板已同步 |
| `docs/feature-mcp-server.md` 主示例 | `cmd` + `args: ["/c", "chorusgate-mcp"]` (chorusgate 段) | 文档主示例已对齐 |
| `docs/feature-mcp-server.md` 补充段 | `"command": "chorusgate-mcp", "args": []` (非 Windows 替代) | 新增的「非 Windows」块明确给出 unix 写法 |

**对齐验证：**
- `.claude/mcp.json` ≡ `.claude/mcp.json.example` (diff 0 行) ✅
- doc 主示例 (chorusgate 段) 与两配置文件一致 ✅
- doc 显式说明「非 Windows 环境如果已能直接解析 `chorusgate-mcp`，可改为：…」+ 给完整 JSON 块 ✅
- doc 主示例是 chorusgate 最小段，trello 段用一句「请以 `.claude/mcp.json.example` 里的完整 server 列表为准」指向 .example，避免 doc 漂移 ✅

**结论：P0-2 文档/实际不一致问题已解决。Mac/Linux 用户照 doc 末尾的替代块能直接配好。**

### 修复 #43 (P1-1): 测试计划/报告覆盖 `.claude/mcp.json` ✅

新加 3 条 case 全部在 PLAN + REPORT 中成对出现：

| Case | 验证内容 | 验证方法 | 实际状态 |
| --- | --- | --- | --- |
| T1-8 | `.claude/mcp.json` 不含 `MCP_SENDER_ONLY` | `grep` | ✅ 0 处 |
| T1-9 | `.claude/mcp.json` 与 `.example` 的 `chorusgate` 配置骨架一致 | 人工审查 | ✅ 两者均为 `cmd` + `[/c", "chorusgate-mcp"]` |
| T2-7 | `docs/feature-mcp-server.md` 的配置示例与 `.claude/mcp.json.example` 一致 | 人工审查 | ✅ doc 主示例已改为 Windows wrapper + 非 Windows 替代 |

**P0-1 漏判的根因（T1 系列只扫 `src/`）已结构性补上。**

**小建议 (P3-2，本 PR 不阻塞)：T1-9 和 T2-7 用的是「人工审查」，可以用 `diff <(jq '.mcpServers.chorusgate' .claude/mcp.json) <(jq '.mcpServers.chorusgate' .claude/mcp.json.example)` 之类变成自动 grep，更不易漏。后续可改。**

### 修复 #44 (P1-2): doc 工具表补 `slack_get_skill_list` ✅

`docs/feature-mcp-server.md`「MCP Tools」表新增第 8 行：

```
| `slack_get_skill_list` | 列出可用 ChorusGate skills 与触发说明 |
```

数 `src/tools/*.ts` 文件：channel-history, get-skill-list, get-user, list-channels, react, reply, send-message, thread-replies = **8 个**。doc 表 8 行（含 slack_get_skill_list）。**完全对齐。**

---

## 验证日志

### 类型检查 ✅
```
$ npm run typecheck
> tsc --noEmit
PASS (0 error)
```

### 测试 ✅
```
$ node --import tsx --test tests/*.test.ts
ℹ tests 61
ℹ suites 3
ℹ pass 61
ℹ fail 0
ℹ duration_ms 1084.69
```

（首次从 WSL2 跑 `npm test` 出现 30 min 超时，根因是 WSL2 shell 的 glob 展开/终端 shim 异常；切到 Windows-native `node` 直接执行同一命令，1.08s 通过，10 个 test 文件逐个亦全绿。已确认非代码回归。）

### `MCP_SENDER_ONLY` 全仓扫描 ✅
```
$ grep -rn MCP_SENDER_ONLY .claude/    → 0 处  (P0-1 修复)
$ grep -rn MCP_SENDER_ONLY src/ bin/   → 0 处
$ grep -rn MCP_SENDER_ONLY docs/       → 仅 v3-story-9-mcp-webapi-only.md (spec 本身, 属历史背景)
```

### spec 6 条验收逐条对照 ✅

| # | 验收项 | 验证 | 状态 |
| --- | --- | --- | --- |
| 1 | `chorusgate-mcp` 启动后不建立 Socket Mode | `grep -n SocketMode\|WebSocket src/index.ts` → 0 | ✅ |
| 2 | MCP tool 列表不再含 `slack_check_events` | `grep -rn slack_check_events src/` → 0 + 文件已删 | ✅ |
| 3 | `.claude/mcp.json` 可被本地 runtime 与 gateway spawn 的 runtime 复用 | 实际配置仅 env 引用 token，无绝对路径 | ✅ |
| 4 | Codex TOML 仍含 token + `default_tools_approval_mode = "approve"` | T3 测试通过 | ✅ |
| 5 | Codex TOML 不再含 `MCP_SENDER_ONLY` | T1-6 + T3 通过 | ✅ |
| 6 | 文档不再把 `MCP_SENDER_ONLY` 作为主路径配置 | T1-8 + T2-6 + T2-7 通过 (本 PR 修复后) | ✅ |

### GitHub issue 状态 ✅
```
#41 [P0] MCP_SENDER_ONLY  → CLOSED
#42 [P0] Windows-only cmd  → CLOSED
#43 [P1] test plan 覆盖盲点 → CLOSED
#44 [P1] doc 缺 getSkillListTool → CLOSED
#45 [P2] trello 漂移 → CLOSED
#46 [P2] 三方配置不一致 → CLOSED
```

---

## 本次 re-review 新增/遗留项

### 遗留：原 6 项发现全部 Resolved ✅
无遗留阻塞项。

### 新增 P3 建议 (本 PR 不阻塞，记入 backlog)

| # | 项 | 文件 | 备注 |
| --- | --- | --- | --- |
| P3-1 | `.claude/mcp.json` 提交到 git 而非 .gitignore | `.gitignore` | 现有依赖 `${SLACK_BOT_TOKEN}` 占位防泄漏，但若有开发者写入字面 token 会误提交。可考虑加 `.claude/mcp.json` 到 .gitignore (同时保留 `.claude/mcp.json.example`)。本 PR 不阻塞。 |
| P3-2 | T1-9 / T2-7 验证方法写「人工审查」 | `docs/tests/plans/PLAN-STORY9-*.md` | 改用 `diff <(jq '.mcpServers.chorusgate' .claude/mcp.json) <(jq '.mcpServers.chorusgate' .claude/mcp.json.example)` 之类可重复执行。本 PR 不阻塞。 |
| P3-3 | 默认 commit 的 `.claude/mcp.json` 是 Windows-only | `.claude/mcp.json` | Mac/Linux 克隆者需自行修改为非 Windows variant。doc 已说明，但若想「clone 即可用」需采用方案 A (跨平台 `chorusgate-mcp`)。本 PR 不阻塞 (spec 不要求跨平台)。 |

### 关于评审环境的说明

按 code-review-workflow skill 惯例，评审应在 test clone (`ChorusGate_Test`) 进行。
实际情况：test clone 与 dev clone 同分支名 (`v3/story-8-claude-stream-json`)，但 test clone 仍停在 `61dde2d`（无 af4826e），WSL2 无外网无法 `git fetch`。

故本轮 re-review 仍基于 dev clone 的 `af4826e` 提交进行。
REVIEW/ISSUES 文档写到 dev clone 的 `docs/tests/`，便于小克在 PR 内一并提交。
test clone 的 `docs/tests/` 暂未同步（小克 fetch 后可同步）。

---

## 下一步

- [x] 小克修复 4 项（P0×2 + P1×2 + P2×2 全部）
- [x] 小克 verify：`npm run typecheck` 0 error + `npm test` 61/61 通过
- [x] GitHub issues #41–#46 全部 CLOSED
- [ ] 小马二次验收 → 本文档即验收结果
- [ ] 小克把 `docs/tests/REVIEW-STORY9-R2-2026-06-14-xiaoma.md` + `ISSUES-STORY9-2026-06-13.md` 提交到 PR #39 的分支
- [ ] 合 PR #39 → dev → main

---

**Reviewer:** xiaoma (小马)
**关联 PR:** #39
**关联 issues:** #40 (STORY-9 epic), #41–#46 (本评审新开，已全部 CLOSED)
**生成时间:** 2026-06-14
