# v3 设计评审回复

> 评审日期：2026-06-12 | 状态：已完成修复

## 评审结论

方案方向可行。4 个 P0 设计缺口已修复，新增 M0 验证 Spike 里程碑。

## 修复明细

### 1. Codex JSONL 字段 + 权限标志 (P0) ✅

| 项 | 旧 | 新 |
|----|-----|-----|
| Session ID 字段 | `thread.id` | `thread_id`（canonical）+ `thread.id`（兼容） |
| 权限标志 | `--full-auto`（deprecated）| `--ask-for-approval never` |
| 文档 | v3-story-2-codex-provider.md | 已修复 |
| 跟踪 | [#23](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/23) | 已加评论 |
| 决策单 | — | [#29](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/29) |

### 2. Per-profile Slack runtime 重构 (P0) ✅

单例清单已记录，STORY-3 先拆单例再扩展：

| 单例 | 文件 |
|------|------|
| `webClient` | `slack-clients.ts:7` |
| `socketClient` | `socket-manager.ts:23` |
| `botUserId` | `socket-manager.ts:28` |
| `onEventCallback` | `socket-manager.ts:24` |
| `onSlashCallback` | `socket-manager.ts:25` |

| 文档 | v3-story-3-multi-slack-app.md | 已修复 |
| 跟踪 | [#24](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/24) | 已加评论 |
| 决策单 | — | [#30](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/30) |

### 3. Session key 结构化 (P0) ✅

| 旧 key | 新 key |
|--------|--------|
| `channel:C0B8V9LV8CT` | `cc:claude:channel:C0B8V9LV8CT:E:\project-a` |

新 key 维度：`profileId:providerId:scopeKey:projectDir`

| 文档 | v3-story-4-multi-project.md | 已修复 |
| 跟踪 | [#25](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/25) | 已加评论 |

### 4. Per-profile MCP token 注入 (P1) ✅

| 旧 | 新 |
|----|-----|
| `process.env.SLACK_BOT_TOKEN`（全局） | `profile.botToken`（per-profile 注入） |
| CC 和 Codex 共享 sender config | 各生成独立的 MCP config |

| 文档 | v3-story-7-codex-slack-tools.md | 已修复 |
| 跟踪 | [#28](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/28) | 已加评论 |
| 决策单 | — | [#31](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/31) |

### 5. 新增 M0 验证 Spike 里程碑

| 文档 | v3-epic.md | 已更新 |
|------|------------|--------|
| 内容 | 真实 codex exec --json 固化 JSONL/resume/MCP fixture | |

## 新增 GitHub Issues

| Issue | 标题 | 类型 |
|-------|------|------|
| [#29](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/29) | Codex gateway runtime uses --ask-for-approval never and documented JSONL | 决策单 |
| [#30](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/30) | Use cc/codex Slack profiles with independent Socket Mode tokens | 决策单 |
| [#31](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/31) | Phase 1 Codex is gateway-only; keep MCP server Claude Code first | 决策单 |

## 里程碑调整

```
M0 (新增) → M1 (重构后) → M2 → M3
  ↓            ↓
JSONL 固化   先拆单例 + session key 重构
              再做双 Agent provider
```
