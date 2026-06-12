# STORY-5: 统一 Session 模型（CC + Codex）

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P0 | 依赖：STORY-1, STORY-2

## 问题

CC 和 Codex 的 session 模型有本质差异：

| 维度 | Claude Code | Codex |
|------|------------|-------|
| Session ID 来源 | gateway 预生成 UUID | Codex 返回 `thread_id`（UUID 格式，M0 已实测） |
| ID 格式 | `xxxxxxxx-xxxx-...` | UUID 格式字符串，如 `019ebaf3-9be4-7661-be3f-b2a8790363b5` |
| 创建时机 | spawn 前已知 | spawn 后从输出解析 |
| 存储 | `~/.claude/projects/<hash>/` | `~/.codex/sessions/` |

网关需要统一管理两种 session。

## 方案

### SessionStore 扩展

```typescript
interface ThreadSession {
  sessionId: string;      // "0fb487e1-..." or "019ebaf3-..."
  provider: string;        // "claude" | "codex"
  projectDir?: string;     // cwd for this session
  started: boolean;
  lastUsed: number;
}
```

### Session 创建流程对比

**Claude**（不变）：
```
sessionStore.getOrCreate(key) → UUID
spawn claude -p --session-id <UUID> → 回复
sessionStore.markStarted(key)
```

**Codex**（新，M0 已实测）：
```
sessionStore.getOrCreate(key) → placeholder (started=false)
spawn codex exec <prompt> --json
→ 解析 thread.started.thread_id → sessionStore.setSession(key, thread_id)
→ 解析 item.completed.item.type="agent_message" 的 item.text
→ turn.completed 表示本轮结束（当前 fixture 无 done 事件）
```

### Codex 首次 launch 失败处理

如果 `codex exec` 执行失败（没返回 `thread_id`），session 保持 `started=false`，下次重试（不 resume，重新 exec）。

### `/cc_sessions` 列表增强

```
已知会话（3 个）：
1. 0fb487e1…  6-12 10:20  channel:C01  [claude]  E:\project-a  ⬅ 当前
2. 019ebaf3…  6-12 11:00  channel:C01  [codex]   E:\project-b
3. 81a17ecb…  6-11 23:48  channel:C02  [claude]  E:\project-a
```

### memory/sessions.md 表头更新

```markdown
| Scope Key | Session UUID | Provider | Project Dir | Started | Last Used |
|-----------|-------------|----------|-------------|---------|-----------|
| channel:C01 | 0fb487e1-... | claude | E:\project-a | yes | 2026-06-12T10:20:00Z |
| channel:C01 | 019ebaf3-9be4-7661-be3f-b2a8790363b5 | codex | E:\project-b | yes | 2026-06-12T11:00:00Z |
```

### 跨 CC/Codex session 切换

`/cc_resume <uuid>` 按 sessionId 匹配，自动切换 provider：
```
/cc_resume 0fb487e1  → 当前频道切到 claude session
/cc_resume 019ebaf3 → 当前频道切到 codex session
```

SessionStore 里记录了 provider，reply-engine 自动选对应 provider 的 `resumeSession()`。

## 验收标准

- [ ] Codex session 首次创建正确解析 `thread_id`（UUID 格式）
- [ ] sessionStore 支持 provider + projectDir 字段
- [ ] `/cc_sessions` 显示 provider 和项目目录
- [ ] `/cc_resume` 跨 provider 切换正常工作
- [ ] `memory/sessions.md` 格式向后兼容（旧表可加载）
