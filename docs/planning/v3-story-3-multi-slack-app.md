# STORY-3: 多 Slack App Socket Mode

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P0 | 依赖：STORY-1
> 评审决策：详见 [#24](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/24)、[#30](https://github.com/AINIZE-SPACE/slack4ccmcp/issues/30)

## 问题

当前代码是单例结构——Slack runtime 的全部核心组件都是模块级单例。要同时监听 CC 和 Codex 两个 Slack app，必须先拆单例。

### 当前单例清单（需全部改成 per-profile）

| 文件 | 单例 | 行 |
|------|------|-----|
| `slack-clients.ts` | `let webClient: WebClient \| null` | [#7](https://github.com/AINIZE-SPACE/slack4ccmcp/blob/dev/src/slack-clients.ts#L7) |
| `slack-clients.ts` | `let appToken: string \| null` | 全局 |
| `socket-manager.ts` | `let socketClient: SocketModeClient \| null` | [#23](https://github.com/AINIZE-SPACE/slack4ccmcp/blob/dev/src/socket-manager.ts#L23) |
| `socket-manager.ts` | `let botUserId: string \| null` | [#28](https://github.com/AINIZE-SPACE/slack4ccmcp/blob/dev/src/socket-manager.ts#L28) |
| `socket-manager.ts` | `let onEventCallback: EventCallback \| null` | [#24](https://github.com/AINIZE-SPACE/slack4ccmcp/blob/dev/src/socket-manager.ts#L24) |
| `socket-manager.ts` | `let onSlashCallback: SlashCallback \| null` | [#25](https://github.com/AINIZE-SPACE/slack4ccmcp/blob/dev/src/socket-manager.ts#L25) |

## 方案

### 重构：per-profile 实例

STORY-3 **不只是** `startAll(profiles)`。必须先重构为 per-profile 实例：

```typescript
// 每个 profile 拥有完整的独立 Slack runtime
interface SlackProfile {
  id: string;                        // "cc" | "codex"
  appToken: string;
  botToken: string;
  providerId: string;                // "claude" | "codex"
  webClient: WebClient;              // 独立实例
  socketClient: SocketModeClient;    // 独立实例
  botUserId: string | null;          // 独立 bot 身份
}

// SocketManager 从单例变为多 profile 管理器
class SocketManager {
  private profiles = new Map<string, SlackProfile>();

  async addProfile(config: ProfileConfig): Promise<void>;
  async removeProfile(id: string): Promise<void>;
  async startAll(): Promise<void>;
  async stopAll(): Promise<void>;
}
```

### 多实例架构

```
socket-manager.ts
  ┌─────────────────────────┐
  │  SocketManager          │
  │  clients: Map<appId, {  │
  │    client, appToken,    │
  │    botToken, providerId │
  │  }>                     │
  │                         │
  │  start(profile)         │
  │  startAll(profiles[])   │
  │  stop(appId)            │
  │  stopAll()              │
  └─────────────────────────┘
```

每个 Slack app profile 有：
- `appId`：内部标识（`"cc"` | `"codex"`）
- `appToken`：`xapp-` token
- `botToken`：`xoxb-` token
- `providerId`：对应哪个 AgentProvider
- `webClient`：独立的 WebClient 实例

### Token 命名规范

```env
# Profile: CC
SLACK_BOT_TOKEN_CC=xoxb-...
SLACK_APP_TOKEN_CC=xapp-...

# Profile: Codex
SLACK_BOT_TOKEN_CODEX=xoxb-...
SLACK_APP_TOKEN_CODEX=xapp-...
```

向后兼容：如果只设了 `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN`（无后缀），视为 `default` profile → 等同于现有行为。

### 事件路由

```
SocketManager 收到事件
  ↓ 标记来源 (appId: "cc" | "codex")
  ↓
Gateway.onEvent(event, providerId)
  ↓ 按 providerId 选 AgentProvider
  ↓
AgentProvider.createSession / resumeSession
```

### 关键约束

每个 Slack app → 一个 Socket Mode 连接 → 一个 `num_connections`。两个 app = 两个独立连接，**互不干扰**（Slack 不会把它们之间做负载均衡）。

这和"一个 app 有多个连接导致分流"的坑是**不同问题**——前者是同一 app 多连接，后者是不同 app。

### gateway.ts 适配

```typescript
// 从单 provider 改为多 provider
const providers = new Map<string, AgentProvider>();
providers.set("cc", new ClaudeProvider());
providers.set("codex", new CodexProvider());

// Socket Manager 启动时加载所有 profile
const profiles = parseProfiles(); // 从 env 解析 [{appId, appToken, botToken, providerId}]
for (const p of profiles) {
  await socketManager.start(p);
}
```

### 配置系统（STORY-6 详述）

```env
GATEWAY_PROFILES=cc,codex
```

## 验收标准

- [ ] 两个 SocketModeClient 同时运行，各自接收事件
- [ ] CC Slack app 的事件 → ClaudeProvider 处理
- [ ] Codex Slack app 的事件 → CodexProvider 处理
- [ ] 互不干扰，事件不混淆
- [ ] 单 profile（无后缀 token）向后兼容
