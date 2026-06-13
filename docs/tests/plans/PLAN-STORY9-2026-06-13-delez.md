# STORY-9 测试方案：MCP Web API-only 收口

> 测试人：小克 (delez) | 日期：2026-06-13
> PR: [#39](https://github.com/AINIZE-SPACE/ChorusGate/pull/39) | Issue: [#40](https://github.com/AINIZE-SPACE/ChorusGate/issues/40)

## 测试目标

验证 `chorusgate-mcp` 已固定为 **Web API tools only**，不再包含 Socket Mode 连接、事件流、`slack_check_events` 工具和 `MCP_SENDER_ONLY` 逻辑。

## 测试范围

### T1: 代码清理验证

| ID | 检查项 | 方法 |
|----|--------|------|
| T1-1 | `src/index.ts` 不再 import `startSocketMode` / `stopSocketMode` | `grep` |
| T1-2 | `src/index.ts` 不再包含 MCP resources/subscribe handler | `grep` |
| T1-3 | `src/index.ts` 不再包含 `MCP_SENDER_ONLY` 分支 | `grep` |
| T1-4 | `src/tools/check-events.ts` 已删除 | `ls` |
| T1-5 | `src/` 全局不再引用 `slack_check_events` | `grep -rn` |
| T1-6 | `src/` 全局不再引用 `MCP_SENDER_ONLY` | `grep -rn` |
| T1-7 | `src/types.ts` 移除 `CheckEventsInput`/`CheckEventsOutput` | `grep` |

### T2: 文档一致性验证

| ID | 检查项 | 方法 |
|----|--------|------|
| T2-1 | `README.md` 不再提及 `MCP_SENDER_ONLY` | `grep` |
| T2-2 | `README_CN.md` 不再提及 `MCP_SENDER_ONLY` | `grep` |
| T2-3 | `INSTALL.md` 不再提及 `MCP_SENDER_ONLY` | `grep` |
| T2-4 | `docs/feature-mcp-server.md` 正确描述 Web API-only 边界 | 人工审查 |
| T2-5 | `docs/architecture.md` 正确描述 socket mode 只有 gateway 持有 | 人工审查 |
| T2-6 | `docs/gotchas.md` 不再推荐 `MCP_SENDER_ONLY` 作为修复方案 | 人工审查 |

### T3: Codex MCP 配置验证

| ID | 检查项 | 方法 |
|----|--------|------|
| T3-1 | `generateMCPConfig()` 生成的 TOML 不含 `MCP_SENDER_ONLY` | 自动化测试 |
| T3-2 | 生成的 TOML 仍包含 `SLACK_BOT_TOKEN` | 自动化测试 |
| T3-3 | 生成的 TOML 仍包含 `SLACK_APP_TOKEN` | 自动化测试 |
| T3-4 | 生成的 TOML 仍包含 `default_tools_approval_mode = "approve"` | 自动化测试 |

### T4: 回归验证

| ID | 检查项 | 方法 |
|----|--------|------|
| T4-1 | `npm run typecheck` 通过 | `tsc --noEmit` |
| T4-2 | `npm test` 全部通过 | `node --test` |
| T4-3 | `tests/codex-provider.test.ts` 通过 | `node --test` |

## 执行命令

```bash
# T1: 代码清理
grep -rn "MCP_SENDER_ONLY" src/
grep -rn "slack_check_events" src/
grep -n "startSocketMode|stopSocketMode|MCP resources|SubscribeRequest" src/index.ts
ls src/tools/check-events.ts

# T2: 文档一致性
grep -rn "MCP_SENDER_ONLY" README.md README_CN.md INSTALL.md docs/

# T3: Codex 配置
node --import tsx -e "... codexProvider.generateMCPConfig() ..."

# T4: 回归
npm run typecheck
npm test
```

## 准入/退出标准

- 准入：PR #39 已 open，分支 `v3/story-8-claude-stream-json` @ `f38eafa`
- 退出：所有 T1-T4 检查通过，或发现缺陷并提单
