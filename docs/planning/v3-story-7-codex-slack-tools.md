# STORY-7: Codex Slack MCP Tools

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P1 | 依赖：STORY-2
> 评审决策：详见 [#28](https://github.com/AINIZE-SPACE/chorusgate/issues/28)、[#31](https://github.com/AINIZE-SPACE/chorusgate/issues/31)
> Phase 1: gateway-only Codex；MCP server 保持 Claude Code first。

## 问题

Codex 需要通过 MCP 获得 Slack 工具（读频道历史、发消息等），和 CC 一样。但 MCP 配置格式和启动方式不同。

## 方案

### Per-Profile Token 注入（P0 修复）

当前 CC sender MCP config 读全局 `process.env.SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN`。多 profile 后，每个 provider 必须注入**对应 profile 的 token**，不能继续用全局 env。

```typescript
// 旧（全局 env） — 多 profile 后不工作
const SENDER_MCP_CONFIG = {
  env: { SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN }  // 永远是 CC 的 token
};

// 新（per-profile）— 每个 provider 注入自己的 token
function generateMCPConfig(profile: SlackProfile, provider: AgentProvider): string {
  return provider.id === "codex"
    ? generateTOMLConfig(profile)   // TOML + profile 的 token
    : generateJSONConfig(profile);  // JSON + profile 的 token
}
```

### MCP Config 生成

`CodexProvider.generateMCPConfig()` 生成 TOML 格式配置：

```toml
# 由 gateway 自动生成 — 不要手动编辑
# 生成时间: 2026-06-12T10:00:00Z

[mcp_servers.slack]
command = "node"
args = ["E:\\my_project\\chorusgate\\bin\\chorusgate-mcp.mjs"]

[mcp_servers.slack.env]
SLACK_BOT_TOKEN = "xoxb-..."
SLACK_APP_TOKEN = "xapp-..."

# 关键：不设此选项，codex exec headless 会取消 MCP 工具调用
default_tools_approval_mode = "approve"
```

生成位置：`config/codex-mcp.generated.toml`

### 传给 Codex

Codex 支持通过 `--mcp-config` 或 `config.toml` 加载 MCP servers。gateway spawn 时：

```bash
codex exec <prompt> --json --mcp-config config/codex-mcp.generated.toml
```

或者在项目目录的 `config.toml` 里引用：
```toml
[mcp_servers]
include = ["E:\\path\\to\\codex-mcp.generated.toml"]
```

### 进度标签映射

复用 `reply-engine.ts` 的 `toolLabel()` 逻辑，但适配 Codex 的工具名格式：

```typescript
function toolLabel(name: string): string {
  // Codex MCP tools 格式: mcp__slack__<tool_name>
  const n = name.toLowerCase();
  if (n.includes("channel_history")) return "📖 Codex 读取频道消息中…";
  if (n.includes("send_message")) return "✍️ Codex 发送消息中…";
  // ... 同 CC 映射
}
```

### 与 CC 的 Slack MCP 共存

- CC 用 `config/sender-mcp.generated.json`（JSON 格式）
- Codex 用 `config/codex-mcp.generated.toml`（TOML 格式）
- 两个文件各自生成，互不干扰
- 都用同一份只含 Web API 工具的 `chorusgate-mcp.mjs`

## 验收标准

- [ ] `codex exec` 能加载 Slack MCP tools
- [ ] Codex 能调用 `slack_channel_history`、`slack_send_message` 等工具
- [ ] MCP 工具调用不被自动取消
- [ ] CC 和 Codex 的 MCP config 文件独立，互不覆盖
