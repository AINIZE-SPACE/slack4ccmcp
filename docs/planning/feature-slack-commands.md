> **状态：部分已实现，大量规划中**

# Slack Command 增强

## 当前已实现的命令

通过 manifest.json 注册，在 socket-manager.ts 的 `slash_commands` 事件路由，实现在 `session-commands.ts`：

| 命令 | 状态 | 行为 |
|------|------|------|
| `/sessions` | ✅ 已实现 | 列出 memory/sessions.md 里所有 session，标注当前绑定 |
| `/resume N` / `/resume <uuid>` | ✅ 已实现 | 把当前频道绑定到指定 session |
| `/new` | ✅ 已实现 | 重置当前频道的 session 绑定（下条消息开新对话）|
| `/current` | ✅ 已实现 | 显示当前频道绑定的 session UUID 和最后使用时间 |
| `/cchelp` | ✅ 已实现 | 列出命令帮助 |

---

## 规划新增命令

> 以下命令尚未实现。参考 hermes-manifest.json 的命令集设计。

### 高优先级（v2 目标）

**运行控制类**

| 命令 | 说明 | 前置依赖 |
|------|------|----------|
| `/stop` | 终止当前 channel 正在运行的 claude 进程（SIGKILL in-flight spawn）| 需要 in-flight 进程引用可取消 |
| `/retry` | 重新发送当前 channel 最后一条用户消息 | 需要 event 历史缓存 |
| `/approve [session\|always]` | 批准挂起的危险命令 | 需要 Session Host |
| `/deny` | 拒绝挂起的危险命令 | 需要 Session Host |
| `/background <prompt>` / `/bg` | 在后台跑一个 prompt，不打断当前对话 | 需要多 session slot 支持 |

**配置类**

| 命令 | 说明 | 前置依赖 |
|------|------|----------|
| `/model [model-name]` | 切换当前 session 使用的模型（如 opus/sonnet/haiku）| 需要 reply-engine 支持 `--model` flag |
| `/permission [bypassPermissions\|default\|...]` | 切换 CLAUDE_PERMISSION_MODE | 需要 per-session 配置存储 |

**信息查看类**

| 命令 | 说明 |
|------|------|
| `/agents` / `/tasks` | 显示当前 in-flight 的 claude 进程列表（key / sessionId / 已运行时长）|
| `/usage` | 显示当前 session token 用量（如果 claude -p 输出包含用量信息）|
| `/status` | gateway 运行状态摘要（pid、uptime、activeSlots） |

### 中优先级（v2 后期）

**Session 操作类**

| 命令 | 说明 | 前置依赖 |
|------|------|----------|
| `/branch [name]` / `/fork` | 分支当前 session——保留历史，新建一个同样 UUID 开头的 session | 需要 session UUID fork 语义 |
| `/compress [topic]` | 手动触发 context 压缩（让 claude 对当前 session 总结归档）| 需要 Session Host |
| `/title <name>` | 给当前 session 设置名称（存到 sessions.md 的第 5 列）| sessions.md schema 变更 |

**运维类**

| 命令 | 说明 |
|------|------|
| `/restart` | Graceful restart gateway（drain in-flight 后重启）|
| `/update` | git pull + npm run build + /restart |
| `/debug` | 上传最近 100 行日志到 pastebin，返回链接（便于远程排障）|

### 低优先级 / 有想法

| 命令 | 说明 |
|------|------|
| `/goal <text>` | 设置跨 turn 的持续目标（参考 hermes /goal）|
| `/queue <prompt>` | 把 prompt 排队到下一轮（不打断当前进行中的回复）|
| `/steer <prompt>` | 在下一次工具调用后注入消息（不打断当前推理）|
| `/reasoning [level]` | 调整 claude 的推理深度（如果模型支持 thinking budget）|

---

## 实现架构（现有基础）

```
Slack 用户输入 /stop
      │
      ▼ Socket Mode slash_commands 事件
socket-manager.ts: slash_commands 事件监听
  ack() ← ephemeral "⏳ 处理中…"
  onSlashCallback(SlashCommand)
      │
      ▼
gateway.ts: onSlash()
  detectCommand()
  per-key 串行队列（channelKey）
      │
      ▼
session-commands.ts: handleCommand()
  按 command 路由到具体实现
```

新增命令只需在 `session-commands.ts` 的 `handleCommand()` 里加 case，在 `manifest.json` 的 `slash_commands` 数组里注册，重装 Slack app 后生效。

`/stop` 等需要控制 in-flight 进程的命令，要求 `gateway.ts` 暴露 `cancelInFlight(key)` 接口，目前不存在。

---

## manifest.json 变更

每新增一个命令，需同步更新 `manifest.json` 的 `slash_commands` 数组，然后在 api.slack.com 推送 manifest + reinstall app。

Socket Mode 支持 slash command 投递，不需要公网 HTTP endpoint。但必须在 Slack App 管理页 App Home 里勾选 "Allow users to send Slash commands and messages from the messages tab"（否则 DM 里不工作）。

---

## 实施顺序

1. `/stop` — 最高实用价值，runaway claude 进程无法中止是痛点
2. `/retry` — 补充 session-commands 里的历史缓存
3. `/model` — 让用户在 Slack 里切模型，无需改 env 重启
4. `/agents` — 显示 in-flight 状态，透明度高
5. `/restart` + `/update` — 运维命令，稳定后上
6. Session Host 就绪后：`/approve` / `/deny` / `/compress` / `/branch`
