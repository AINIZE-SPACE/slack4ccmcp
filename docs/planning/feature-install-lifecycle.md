> **状态：规划中（尚未实现）**

# 安装生命周期与系统服务支持

## 目标

让 slack4ccmcp 可以像正式的系统服务一样运行：开机自动启动、崩溃自动重启、一条命令完成安装或卸载。同时提供 `install` 脚本自动检测并安装 Claude Code CLI 依赖。

---

## 1. 一键安装脚本（install-all）

新增 `scripts/install.mjs`，通过 `npm run install-all` 触发，按顺序执行：

```
1. 检测 node 版本（>= 18 required）
2. npm ci — 安装依赖
3. npm run build — TypeScript 编译
4. 检测 claude CLI 是否在 PATH：
   - 有 → 显示版本，继续
   - 没有 → npm install -g @anthropic-ai/claude-code，然后验证
5. 检测 .env 是否存在：
   - 没有 → 从 .env.example 复制，提示用户填写三个 token
6. 可选 --service flag：自动注册系统服务
```

**检测 claude CLI 的逻辑**：

```js
const result = spawnSync('claude', ['--version'], { encoding: 'utf8' })
if (result.error || result.status !== 0) {
  // 未安装，执行全局 install
}
```

Why 安装 `@anthropic-ai/claude-code` 而不是其他：gateway 的核心是 `spawn('claude', ['-p', ...])` ，必须保证 `claude` 在 PATH 且是官方 claude-code 包。

---

## 2. 系统服务注册（service:install / service:uninstall）

新增两个 npm scripts，跨平台自动检测：

```bash
npm run service:install    # 注册开机自启服务
npm run service:uninstall  # 注销服务
```

实现在 `src/gateway-service.ts`，`serviceInstall()` / `serviceUninstall()` 函数，由 `bin/slack-gateway.mjs` 分发（新增 `service-install` / `service-uninstall` 子命令）。

### 2.1 Windows — Task Scheduler（推荐）

用 `schtasks` 命令注册开机登录触发的任务：

```bat
schtasks /create /tn "slack4ccmcp-gateway" /tr "node <BIN_FILE> run" /sc ONLOGON /ru SYSTEM /f
```

优先选 Task Scheduler 而不是 NSSM：
- 零外部依赖（schtasks 是 Windows 内置）
- NSSM 需要额外下载，用户环境不一定有

卸载：`schtasks /delete /tn "slack4ccmcp-gateway" /f`

日志仍写 `.gateway/gateway.log`，任务触发后的 stdout/stderr 走原有管道。

### 2.2 macOS — launchd plist

写入 `~/Library/LaunchAgents/com.slack4ccmcp.gateway.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist ...>
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.slack4ccmcp.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>BIN_FILE</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>           <!-- 崩溃自动重启 -->
  <key>StandardOutPath</key>
  <string>.gateway/gateway.log</string>
  <key>StandardErrorPath</key>
  <string>.gateway/gateway.log</string>
</dict>
</plist>
```

加载：`launchctl load ~/Library/LaunchAgents/com.slack4ccmcp.gateway.plist`

卸载：`launchctl unload ...` + 删除 plist 文件

### 2.3 Linux — systemd user unit

写入 `~/.config/systemd/user/slack4ccmcp-gateway.service`：

```ini
[Unit]
Description=slack4ccmcp Slack Gateway
After=network.target

[Service]
ExecStart=node BIN_FILE run
Restart=on-failure
StandardOutput=append:.gateway/gateway.log
StandardError=append:.gateway/gateway.log

[Install]
WantedBy=default.target
```

启用：`systemctl --user enable --now slack4ccmcp-gateway`

卸载：`systemctl --user disable --now slack4ccmcp-gateway` + 删除 unit 文件

---

## 3. 与现有 start/stop/restart/status 的关系

系统服务和现有进程 daemon 不冲突，是两层不同的机制：

| 层级 | 机制 | 作用 |
|------|------|------|
| 进程层（已实现）| `gateway.pid` + SIGTERM | 手动 start/stop，正常使用 |
| 系统层（规划中）| Task Scheduler / launchd / systemd | 开机自启、崩溃重启 |

系统服务触发的是 `slack-gateway run`（前台模式），日志走 `.gateway/gateway.log`，和 `start`（后台守护）共用同一套 PID 探活逻辑。注册系统服务后，不需要再手动 `npm run start`。

---

## 4. Slash command 支持（/install、/update）

参考 hermes 的 `/update` 命令，在 gateway 内增加：

| 命令 | 行为 |
|------|------|
| `/update` | 拉取最新代码（git pull），重新 build，graceful restart |
| `/install` | 仅在初始化场景用，非服务运行时输出安装状态检查 |

`/update` 需要 gateway 支持 graceful drain（等当前 in-flight 请求完成再重启），是 Session Host 之前的简化版本。

---

## 5. 实施顺序

1. `scripts/install.mjs` — 安装脚本（含 claude CLI 检测）
2. `src/gateway-service.ts` — serviceInstall / serviceUninstall，Windows 优先
3. macOS launchd 支持
4. Linux systemd 支持
5. `/update` slash command

---

## 相关文件（规划新增）

| 文件 | 职责 |
|------|------|
| `scripts/install.mjs` | 一键安装脚本 |
| `src/gateway-service.ts` | 系统服务注册/卸载逻辑，跨平台 |
| `bin/slack-gateway.mjs` | 新增 `service-install` / `service-uninstall` 子命令 |
| `.env.example` | token 配置模板（需先补充完整） |
