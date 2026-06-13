---
name: sprint-handoff
description: Sprint 开发完成交接 — commit → 通知测试 → 更新 Issue → 记录 memory，四步缺一不可
---

# 技能: Sprint 开发完成交接

> 代码写完不是终点——提交、通知、更新需求状态、记录 memory 四步缺一不可。
> 参考: `E:\my_project\ainize\summit-saw\domains\dev\notification-templates.md`

## Trigger

- 一个或多个 Story/Task 开发完成，所有测试通过
- 用户说 "通知测试"、"提交代码"、"交接"、"小马测试"

## 四步工作流

### 1. 提交代码

```bash
git add -A
git commit -m "feat(scope): 描述

详细变更列表
Refs: #issue1, #issue2"
```

- Commit 格式: Conventional Commits (`feat:`, `fix:`, `refactor:`)
- Commit body 列出主要变更文件和要点
- 尾部引用相关 GitHub Issues

### 2. 通知评审/测试

**必须发到项目共享频道**（非 DM），让下游同事都能看到。

通知模板:

```
*{项目} {版本/Epic} — {完成的 Story 列表}*
<@REVIEWER_ID> 请测试验证。

*已完成 Stories*
• *STORY-N* — 标题 (要点)
...

*测试状态*
• N/N 测试通过 | TypeScript 零错误
• 分支: `{branch-name}`

*测试要点*
1. ...
2. ...

Issues: #N, #N
```

## 通知目标

> 频道和评审人信息**从 memory 读取**（`[[project-team-channels]]`），
> 不在此处硬编码。通知前先查 memory 获取最新的频道 ID 和团队成员 ID。

## Quality Bar

- [ ] 代码已 commit 到当前分支
- [ ] Slack 通知已发送
- [ ] GitHub Issues 状态已更新 (in_review)
- [ ] 关键决策已记录到 project memory
