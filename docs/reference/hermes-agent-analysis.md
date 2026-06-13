# Hermes Agent Gateway 源码研读 — 对 ChorusGate 的借鉴分析

> 来源: `E:\open-source\hermes-agent\`
> 日期: 2026-06-13
> 本文档将沉淀为项目 skill

---

## 研读文件清单

| # | 文件 | 大小 | 核心关注点 |
|---|------|------|-----------|
| 1 | `gateway/stream_events.py` | 7KB | **类型化事件词汇表** — agent→gateway 交付契约 |
| 2 | `gateway/stream_consumer.py` | 68KB | **流式消费** — 渐进式编辑、分段、速率限制 |
| 3 | `gateway/stream_dispatch.py` | 5KB | **事件分发** — 适配器驱动的渲染决策 |
| 4 | `acp_adapter/permissions.py` | 6KB | **审批桥接** — ACP 权限 → Hermes 审批回调 |
| 5 | `acp_adapter/events.py` | 5KB | **事件回调工厂** — 工具进度 + Plan 更新 |
| 6 | `gateway/platforms/slack.py` | 151KB | **Slack 适配器** — Block Kit 审批按钮、send_exec_approval |
| 7 | `gateway/run.py` | 776KB | **Gateway 主循环** — send_progress_messages、Agent 缓存 |
| 8 | `gateway/delivery.py` | 17KB | **消息投递路由** — 多目标、平台限制、silence 过滤 |
| 9 | `gateway/session.py` | 59KB | **会话管理** — SessionSource、持久化、PII 哈希 |
| 10 | `gateway/platforms/base.py` | 212KB | **平台基类** — 适配器模式、跨平台抽象 |

---

## 1. 类型化流事件词汇表 (`stream_events.py`)

### 核心设计

```python
# 每个事件是一个 frozen dataclass — 描述"发生了什么"，不规定"怎么投递"
StreamEvent = Union[
    MessageChunk,      # 增量文本 delta
    MessageStop,       # 文本段结束（final=True 表示整轮结束，False 表示工具边界）
    Commentary,        # 工具迭代之间的完整中间消息
    ToolCallChunk,     # 工具调用开始
    ToolCallFinished,  # 工具调用完成
    LongToolHint,      # 长工具运行的一次性提示
    GatewayNotice,     # 网关控制消息 (restart/online/long_run)
]
```

### 可借鉴点

| 维度 | Hermes 做法 | ChorusGate 当前 | 建议 |
|------|------------|----------------|------|
| 事件类型 | 7 种明确的 typed dataclass | `onProgress(label)` 单一字符串回调 | **引入 `StreamEvent` 联合类型**，将工具进度、文本增量、分段边界类型化 |
| 分段边界 | `MessageStop(final=False)` 标记工具边界 | 无此概念，占位消息一直编辑同一条 | **增加 segment break 信号**：工具调用后文本应出现在工具进度下方 |
| 中间评述 | `Commentary` — "我先检查一下仓库"作为独立消息 | 丢失在流式编辑中 | 工具调用前的模型评述应作为独立消息投递 |
| 职责分离 | Agent 只产事件，Gateway 决定如何渲染 | Provider 和 Gateway 耦合在 reply-engine | **分离关注点**：Provider 产 StreamEvent，Gateway 的 StreamConsumer 渲染 |

### 对 ChorusGate 的改进方案

```typescript
// 新增: src/providers/stream-events.ts
type StreamEvent =
  | { type: "message_chunk"; text: string }
  | { type: "message_stop"; final: boolean }
  | { type: "commentary"; text: string }
  | { type: "tool_call"; toolName: string; preview: string; args: Record<string, unknown> }
  | { type: "tool_finished"; toolName: string; duration: number; ok: boolean }
  | { type: "gateway_notice"; kind: string; text: string };
```

---

## 2. GatewayStreamConsumer — 流式消费与分段 (`stream_consumer.py`)

### 核心设计

```python
class GatewayStreamConsumer:
    """渐进式编辑单条平台消息，支持流式 token。
    
    关键行为:
    - on_delta(text) — 线程安全的增量投递（从 agent worker 线程调用）
    - on_segment_break() — 工具边界：结束当前消息，下一条文本作为新消息
    - on_commentary(text) — 完整中间评述消息
    - finish() — 信号流结束
    - run() — asyncio 任务，缓冲、速率限制、渐进式编辑
    """
```

**关键特性:**

1. **自适应退避**: 连续 flood-control 失败后增加编辑间隔，3 次后永久禁用渐进式编辑
2. **fresh_final**: 长时间运行的响应在完成后作为新消息发送（而非编辑旧预览）— 时间戳反映完成时间
3. **draft streaming**: Telegram 原生 draft 动画（非编辑），完成后发真实消息
4. **cursor**: 流式编辑末尾的闪烁光标 `▌`，完成后移除
5. **think-block 过滤**: 抑制 `<think>...</think>` 标签

### 可借鉴点

| 维度 | Hermes 做法 | ChorusGate 当前 | 建议 |
|------|------------|----------------|------|
| 分段机制 | `_NEW_SEGMENT` sentinel → 结束当前消息，开始新消息 | 占位消息持续编辑同一条 | **实现 segment break**：工具调用后新文本作为新消息 |
| 速率限制 | 自适应退避 + flood strike 计数 | 固定 1500ms throttle | **增加自适应退避**：连续编辑失败时增加间隔 |
| 最终消息 | `fresh_final_after_seconds` — 长响应最后发新消息 | 始终编辑占位消息 | **长响应 (>60s) 最终发新消息**保留准确时间戳 |
| cursor 动画 | `▌` 闪烁光标 | 无 | **可选**: 流式编辑末尾加闪烁光标 |
| 传输模式 | "edit" / "draft" / "auto" / "off" | 仅占位编辑 | **增加传输策略枚举**，为不同场景选择最优模式 |

### 对 ChorusGate 的改进方案

```typescript
// 改进: src/gateway/stream-consumer.ts (新文件)
interface StreamConsumerConfig {
  editInterval: number;        // 编辑间隔 (ms)
  bufferThreshold: number;      // 缓冲阈值 (chars)
  freshFinalAfterSeconds: number; // 长响应后发新消息 (0=始终编辑)
  transport: "edit" | "off";    // 传输模式
  cursor: string;               // 闪烁光标字符
}

class GatewayStreamConsumer {
  private accumulated = "";
  private messageId: string | null = null;
  private messageTs: number | null = null;

  onDelta(text: string): void { /* 线程安全，入队 */ }
  onSegmentBreak(): void { /* 结束当前消息段 */ }
  onCommentary(text: string): void { /* 独立评述消息 */ }
  finish(): void { /* 信号完成 */ }
  async run(): Promise<void> { /* asyncio 风格消费循环 */ }
}
```

---

## 3. GatewayEventDispatcher — 适配器驱动的渲染 (`stream_dispatch.py`)

### 核心设计

```python
class GatewayEventDispatcher:
    """将类型化事件路由到适配器的渲染钩子。
    
    设计原则:
    - 无平台知识 — 适配器决定如何渲染每个事件
    - 同步路由 — 可从 agent worker 线程调用
    - 适配器可"吃掉"事件 — 无法渲染 tool chrome 的平台返回 None
    """
```

### 可借鉴点

| 维度 | Hermes 做法 | ChorusGate 当前 | 建议 |
|------|------------|----------------|------|
| 事件分发 | 统一 dispatch(event) → 适配器渲染 | 回调直接耦合到 gateway.ts | **引入 EventDispatcher** 作为中间层 |
| tool mode | "all" / "new"(去重) / "verbose" / "off" | `GATEWAY_PROGRESS=1/0` | **增加 tool progress mode 选项** |
| 适配器渲染 | `adapter.format_tool_event(event)` — 平台特定格式 | 无 | 为 Slack/飞书等不同平台定制 tool chrome 格式 |

---

## 4. 审批机制 (`acp_adapter/permissions.py` + `gateway/platforms/slack.py`)

### 核心设计

**ACP 权限桥接:**
```python
def make_approval_callback(request_permission_fn, loop, session_id, timeout=60.0):
    """返回 Hermes 兼容的审批回调，桥接到 ACP 协议。
    
    流程:
    1. Hermes 工具调用 prompt_dangerous_approval(command, description)
    2. → _callback(command, description, allow_permanent=True)
    3. → _build_permission_options() — Allow once / Allow session / Allow always / Deny
    4. → _build_permission_tool_call() — 构造 ACP ToolCallUpdate
    5. → request_permission_fn(session_id, tool_call, options)
    6. → 等待 ACP 客户端响应 (timeout=60s)
    7. → _map_outcome_to_hermes() — 映射回 "once"/"session"/"always"/"deny"
    """
```

**Slack Block Kit 审批按钮:**
```python
async def send_exec_approval(chat_id, command, session_key, description):
    """发送 Block Kit 审批提示。
    
    四个按钮:
    - Allow Once    → hermes_approve_once    → resolve_gateway_approval(key, "once")
    - Allow Session → hermes_approve_session → resolve_gateway_approval(key, "session")
    - Always Allow  → hermes_approve_always  → resolve_gateway_approval(key, "always")
    - Deny          → hermes_deny            → (reject)
    
    安全措施:
    - _approval_resolved[msg_ts] 防止双击
    - _is_interactive_user_authorized() 校验点击者身份
    - 按钮点击后替换为确认文本 "✅ Approved once by @user"
    """
```

### ChorusGate 对比分析

| 维度 | Hermes | ChorusGate | 差距 |
|------|--------|-----------|------|
| 审批粒度 | once / session / always / deny (4 选项) | approve / deny (2 选项) | **缺少 session/always 级别** |
| 按钮安全 | msg_ts 去重 + user 鉴权 + 按钮替换 | P0-2/P0-3 已修复 | ✅ 已对齐 |
| 超时 | 60s 可配置 | 2min 硬编码 | 应可配置 |
| 审批协议 | ACP 标准化协议 | Claude stream-json 专有 | 短期够用，长期需抽象 |
| 集成方式 | `tools.approval.resolve_gateway_approval()` | `permissionTracker.waitForApproval()` | 架构相似 |

### 对 ChorusGate 的改进建议

1. **增加审批粒度**: `allow_once` / `allow_session` / `allow_always`
2. **审批按钮增加选项**: 当前只有 Approve/Deny → 增加 "Approve for session" / "Always approve"
3. **可配置超时**: `GATEWAY_APPROVAL_TIMEOUT_MS` 环境变量
4. **未来**: 如果引入多 agent runtime，审批协议应抽象为独立接口

---

## 5. 多任务分解 + 主动推送消息 (`run.py` send_progress_messages)

### 核心设计

```python
async def send_progress_messages():
    """从 progress_queue 消费工具进度行，渐进式编辑进度气泡。
    
    关键行为:
    1. 从 asyncio.Queue 消费原始进度行
    2. 去重: 连续相同工具名 → "(×N)" 后缀
    3. 溢出分割: 超出平台消息限制时分多个气泡
    4. 段重置: 收到 __reset__ 信号 → 关闭当前气泡，开始新气泡
    5. 平台检测: 不支持编辑的平台跳过
    6. 中断感知: agent 中断时排空队列
    """
```

**工具进度消息流:**
```
用户消息 → Agent 开始执行
  ├─ "🔍 搜索代码中..."      → 编辑进度气泡
  ├─ "📖 读取文件中..."       → 编辑进度气泡
  ├─ [Commentary: "我先分析一下结构"] → 新消息
  ├─ "⚙️ 执行命令中..."      → 新进度气泡（在评述下方）
  ├─ [工具完成]
  └─ [最终回复]              → 新消息（或编辑占位消息）
```

### ChorusGate 对比分析

| 维度 | Hermes | ChorusGate | 改进建议 |
|------|--------|-----------|---------|
| 进度去重 | `(×N)` 后缀 | 无 | 相同工具连续调用时去重 |
| 溢出分割 | 超过限制自动分多个气泡 | 无 | 工具很多时分段 |
| 评述消息 | Commentary 作为独立消息 | 丢失在进度编辑中 | **实现 commentary 独立消息** |
| 进度气泡分层 | 工具进度气泡 vs 文本消息清晰分离 | 全部编辑同一条占位消息 | **分段机制** |
| 自适应编辑 | 逐步增加编辑间隔 | 固定 1500ms | 增加自适应退避 |

---

## 6. 跨平台适配器架构

### Hermes 的平台支持

```
gateway/platforms/
  base.py          — BasePlatformAdapter (212KB!)
  slack.py         — SlackSocketModeAdapter
  telegram.py      — TelegramAdapter
  feishu.py        — FeishuAdapter
  wecom.py         — WeComAdapter
  weixin.py        — WeChatAdapter
  whatsapp.py      — WhatsAppAdapter
  discord-like     — Discord, Matrix, Signal, DingTalk, Email, SMS...
```

### 平台基类核心接口

```python
class BasePlatformAdapter:
    # 消息收发
    async def send(chat_id, content, reply_to, metadata) -> SendResult
    async def edit_message(chat_id, message_id, content, finalize) -> SendResult
    
    # 审批
    async def send_exec_approval(chat_id, command, session_key, description) -> SendResult
    
    # 流式
    def render_message_event(event, sink)         # 渲染文本事件
    def format_tool_event(event, mode, max_len)   # 格式化工具事件
    def supports_draft_streaming() -> bool         # 是否支持原生 draft streaming
    
    # 生命周期
    async def connect() / disconnect()
    async def start_typing(chat_id) / stop_typing(chat_id)
```

### 对 ChorusGate 的启示

**当前**: `socket-manager.ts` 直接操作 Slack SDK，无平台抽象

**改进路径**:
1. **短期 (v3)**: 提取 `PlatformAdapter` 接口 — Slack 作为第一个实现
2. **中期 (v4)**: 飞书/Lark 适配器
3. **关键原则**: 适配器负责渲染决策，gateway 只负责路由

```typescript
// 建议: src/platforms/types.ts
interface PlatformAdapter {
  readonly platform: string;
  
  // 消息
  send(chatId: string, content: string, opts?: SendOptions): Promise<SendResult>;
  editMessage(chatId: string, msgId: string, content: string): Promise<SendResult>;
  
  // 审批
  sendApproval(chatId: string, request: ApprovalRequest): Promise<SendResult>;
  
  // 流式渲染
  formatToolEvent(event: ToolCallChunk): string | null;  // null = eat
  renderMessageEvent(event: MessageEvent, sink: StreamConsumer): void;
}
```

---

## 7. 其他值得借鉴的细节

### 7.1 Agent 实例缓存

```python
# run.py — 跨 turn 缓存 AIAgent 实例以保持 prompt 缓存
self._agent_cache: OrderedDict[str, tuple] = OrderedDict()
# LRU 淘汰，idle TTL，配置变更时失效（invalidate on /model /config change）
```

**对 ChorusGate**: 每个 session 的 `claude -p --resume` 已经通过 session UUID 复用上下文。但如果 ChorusGate 未来支持多 provider 热切换，可以参考这个缓存失效策略。

### 7.2 静默叙述过滤 (`delivery.py`)

```python
_SILENCE_NARRATION = re.compile(
    r'^[\s*_~`]*\(?\s*(silent|silence|no\s+response|no\s+reply)\s*\.?\)?[\s*_~`]*$'
)
def _is_silence_narration(content) -> bool:
    """检测只有"silent"的占位响应 — 不投递到平台"""
```

**对 ChorusGate**: 可以过滤掉 `(silent)` / `no response` 等占位回复，不发送到 Slack。

### 7.3 PII 哈希 (`session.py`)

```python
def _hash_id(value: str) -> str:
    """确定性 SHA256 哈希 → 12 字符 hex"""
    return hashlib.sha256(value.encode()).hexdigest()[:12]
```

**对 ChorusGate**: `memory/sessions.md` 当前存储明文 channel ID。可以考虑哈希化。

### 7.4 中断机制 (`run.py`)

```python
# 中断感知的进度排空
if getattr(agent, "is_interrupted", False):
    # 丢弃当前事件，继续排空
    await asyncio.sleep(0)
    continue
```

**对 ChorusGate**: 当前版本没有中断机制。未来如果支持 `/stop` 命令，需要类似的中断感知 cleanup。

### 7.5 Tool Mode 选项

```python
# "all" — 每个工具都显示进度
# "new" — 只在工具变化时显示（去重）
# "verbose" — 显示完整命令
# "off" — 不显示工具 chrome
```

**对 ChorusGate**: 当前 `GATEWAY_PROGRESS=1/0` 太粗糙。建议增加模式选择。

---

## 8. 总结: ChorusGate 改进路线图

### 立即改进 (当前 Sprint)

| # | 改进 | 借鉴来源 | 优先级 |
|---|------|---------|--------|
| 1 | **StreamEvent 类型化** — 替代单一 `onProgress(label)` 回调 | `stream_events.py` | P0 |
| 2 | **分段机制** — 工具边界 → 新消息，Commentary 独立消息 | `stream_consumer.py` | P0 |
| 3 | **审批粒度增加** — allow_once / allow_session / allow_always | `permissions.py` + `slack.py` | P1 |
| 4 | **审批超时可配置** — `GATEWAY_APPROVAL_TIMEOUT_MS` | `permissions.py` | P1 |

### 下个 Sprint (v3 后续)

| # | 改进 | 借鉴来源 | 优先级 |
|---|------|---------|--------|
| 5 | **StreamConsumer 重构** — 自适应退避、fresh_final、cursor | `stream_consumer.py` | P1 |
| 6 | **EventDispatcher** — 适配器驱动的渲染 | `stream_dispatch.py` | P1 |
| 7 | **进度去重** — 相同工具 `(×N)` | `run.py` | P2 |
| 8 | **Progress 模式** — all/new/verbose/off | `run.py` | P2 |

### 远期 (v4+)

| # | 改进 | 借鉴来源 | 优先级 |
|---|------|---------|--------|
| 9 | **PlatformAdapter 抽象** — 为飞书/Lark 铺路 | `platforms/base.py` | P2 |
| 10 | **Agent 实例缓存** — 跨 turn 复用 | `run.py` | P3 |
| 11 | **静默叙述过滤** — 不投递空响应 | `delivery.py` | P3 |
| 12 | **中断机制** — `/stop` 命令 | `run.py` | P3 |

---

## 关联资源

- Hermes Agent 源码: `E:\open-source\hermes-agent\`
- ChorusGate v3 EPIC: `docs/planning/v3-epic.md`
- 技能沉淀目录: `E:\my_project\ainize\summit-saw\domains\dev\`
- [[requirement-driven]] [[problem-diagnosis]] [[test-spawn-fake-binary]]
