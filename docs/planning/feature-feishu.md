> **状态：规划中（尚未实现）**

# 飞书（Lark）支持

## 背景

飞书是国内最主流的即时通讯工具之一。将 Claude gateway 接入飞书，和 Slack 并列支持，让 slack4ccmcp 变成通用的 IM → Claude Code 桥接器。

---

## 飞书 vs Slack 技术对比

| 维度 | Slack | 飞书 |
|------|-------|------|
| 实时事件接入 | Socket Mode（WebSocket，无需公网）| Event Callback（HTTP POST）或 长连接 WebSocket |
| 命令系统 | Slash commands（原生注册）| 消息卡片 + 自定义命令（通过消息事件模拟）|
| Bot 类型 | Bot Token（xoxb-）+ App Token（xapp-）| App ID + App Secret → access_token（2h 过期需刷新）|
| 消息格式 | mrkdwn | 富文本 / 卡片（card） |
| Thread 概念 | thread_ts | root_id（根消息 ID）|
| DM 类型 | channel_type=im | chat_type=p2p |

关键差异：飞书没有 Socket Mode 等价物，标准做法是 **HTTP Event Callback**（飞书推送到你的公网 URL），或者用飞书的 **长连接 WebSocket**（需单独开启，不是所有企业版都支持）。

---

## 架构方案

### 方案 A：Platform 抽象层（推荐）

在当前 gateway 基础上，抽出 `Platform` 接口，Slack 和 飞书各实现一个 channel adapter：

```
┌─────────────────────────────────────────────────────────┐
│  gateway.ts（重构后）                                    │
│  Platform Manager — 管理多个 Platform 实例              │
└─────┬──────────────────────────────────┬────────────────┘
      │                                  │
      ▼                                  ▼
┌─────────────────┐             ┌────────────────────┐
│  SlackPlatform  │             │  FeishuPlatform    │
│  socket-manager │             │  feishu-client.ts  │
│  (已有)         │             │  HTTP callback 或  │
│                 │             │  长连接 WS         │
└─────────────────┘             └────────────────────┘
      │                                  │
      └──────────────┬───────────────────┘
                     ▼
           ┌──────────────────┐
           │  reply-engine.ts │
           │  session-store   │
           │  (共享，不变)    │
           └──────────────────┘
```

`Platform` 接口定义（规划）：

```typescript
interface Platform {
  name: string                          // 'slack' | 'feishu'
  start(): Promise<void>                // 启动事件监听
  stop(): Promise<void>                 // 优雅停止
  onEvent(handler: EventHandler): void  // 注册事件回调
  sendMessage(ctx: ReplyContext, text: string): Promise<void>
  updateMessage(ctx: ReplyContext, ts: string, text: string): Promise<void>
  sendEphemeral?(ctx: ReplyContext, text: string): Promise<void>
}
```

`ReplyContext` 扩展 `platform` 字段，session key 加 platform 前缀（`slack:channel:C0B8V9LV8CT` / `feishu:chat:oc_xxx`），避免跨平台 key 冲突。

### 方案 B：独立进程（简单但重复）

保持现有 gateway 不变，写一个独立的 `feishu-gateway.ts`，逻辑基本复制 Slack gateway。

缺点：session-store、reply-engine、进度提示等全部重复实现。维护成本翻倍。

**结论：选方案 A**，先做 Platform 抽象重构，再加飞书实现。

---

## 飞书接入方式选择

### 选项 1：HTTP Event Callback

飞书把事件 POST 到你的公网 URL（`https://your-domain/feishu/events`）。

优点：官方文档最完善，所有事件类型都支持。

缺点：需要公网 IP 或 ngrok/frp 内网穿透，对个人开发者不友好，与 Slack Socket Mode 零配置的体验差距很大。

### 选项 2：长连接 WebSocket（推荐）

飞书官方 SDK（`@larksuiteoapi/node-sdk`）支持长连接模式，类似 Slack Socket Mode，无需公网：

```typescript
import { Client, withLogger } from '@larksuiteoapi/node-sdk'

const client = new Client({ appId: '...', appSecret: '...' })
client.im.v1.message.list.create({ ... })

// 长连接接收事件（无需公网）
const wsClient = new client.openapi.im.v1.message.subscriptions.ws()
```

实际上飞书官方 SDK 的 `EventDispatcher` + `startServer` 支持 WebSocket 长连接模式：

```typescript
const dispatcher = new EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => { /* 消息事件 */ }
})
client.addEventListeners(dispatcher)
await client.start({ socketMode: true }) // 长连接，不需要公网
```

**结论：用长连接 WebSocket，体验接近 Slack Socket Mode。**

---

## 飞书 MCP Tools（规划）

对应 Slack 的 8 个 MCP tools，飞书需要：

| 工具 | 飞书 API |
|------|---------|
| `feishu_send_message` | `im.v1.message.create` |
| `feishu_reply` | `im.v1.message.reply` |
| `feishu_channel_history` | `im.v1.message.list` |
| `feishu_thread_replies` | `im.v1.message.list`（filter by thread_id）|
| `feishu_list_channels` | `im.v1.chat.list` |
| `feishu_get_user_info` | `contact.v3.user.get` |
| `feishu_add_reaction` | `im.v2.message_reaction.create` |

---

## 飞书 Token 管理

飞书 access_token 每 2 小时过期，需要自动刷新：

```typescript
// feishu-clients.ts
class FeishuTokenManager {
  private token: string | null = null
  private expiresAt = 0

  async getToken(): Promise<string> {
    if (Date.now() < this.expiresAt - 60_000) return this.token!
    // 刷新：POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
    })
    const { tenant_access_token, expire } = await res.json()
    this.token = tenant_access_token
    this.expiresAt = Date.now() + expire * 1000
    return this.token
  }
}
```

---

## 配置（.env 扩展）

```env
# 飞书
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx
FEISHU_VERIFICATION_TOKEN=xxx   # Event Callback 验证（长连接模式可不填）

# 启用哪些 platform（逗号分隔）
GATEWAY_PLATFORMS=slack,feishu  # 默认只 slack
```

---

## 开源协议

飞书官方 SDK `@larksuiteoapi/node-sdk` 是 MIT 协议，兼容本项目计划使用的 MIT 协议。

---

## 实施顺序

1. **Platform 抽象重构**（不加飞书，只重构 Slack 为 Platform）
   - 定义 `Platform` 接口
   - 把 `SlackPlatform` 抽出来，gateway.ts 改为 Platform Manager
   - 确保所有已有功能不回归
2. **飞书基础接入**
   - `feishu-clients.ts`（token 管理 + Web API 封装）
   - `feishu-platform.ts`（长连接 WS 事件接收）
   - 飞书消息 → reply-engine → 飞书回复（DM 场景）
3. **飞书 MCP Tools**
   - `src/tools/feishu-*.ts` 工具集
   - sender-only 飞书 MCP 配置生成
4. **飞书命令支持**
   - 通过消息关键词模拟 slash command（`/new`、`/sessions` 等）
5. **文档 + 飞书 App 配置向导**

---

## 关键风险

| 风险 | 描述 | 缓解 |
|------|------|------|
| 长连接稳定性 | 飞书 WS 长连接在企业网络/防火墙下可能不稳定 | 加自动重连 + 心跳，失败回退 HTTP Callback |
| token 刷新竞态 | 多个并发请求同时检测 token 过期，触发多次刷新 | 单飞（inflight refresh 去重）|
| 消息格式差异 | mrkdwn 和飞书富文本互不兼容 | gateway 回复用纯文本（claude 输出本身就是文本），卡片格式后续再做 |
| Platform 重构回归 | 抽象层引入 bug，Slack 功能回归 | Platform 重构单独 PR，完整回归测试后再加飞书 |
