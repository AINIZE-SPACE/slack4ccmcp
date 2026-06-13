# Slack Scope → Session Map

每个 Slack scope（channel 或 thread）绑定一个持久 Agent session UUID。
gateway 用 `claude -p --resume <uuid>` 或 `codex exec resume <tid>` 续接。
本文件只存路由 meta —— 真正的对话/记忆在 Agent 自己的 session 存储里。
由 gateway 自动维护；可由 git 追踪。

| Profile | Provider | Scope Key | Session UUID | Project Dir | Started | Last Used |
|---------|----------|-----------|-------------|-------------|---------|-----------|
| default | claude | default:claude:thread:D0B8LES3QUX:1781344650.541849:E:\my_project\ainize\ChorusGate_dev | 157e59ec-86ac-4ba3-948f-206c5bb76b85 | E:\my_project\ainize\ChorusGate_dev | yes | 2026-06-13T12:33:50.562Z |
| default | claude | default:claude:thread:D0B8LES3QUX:1781344748.183159:E:\my_project\ainize\ChorusGate_dev | 016453ca-53a1-45e1-81c0-f1d0a97cccd8 | E:\my_project\ainize\ChorusGate_dev | yes | 2026-06-13T10:46:52.063Z |
| default | claude | default:claude:thread:D0B8LES3QUX:1781266621.800139:E:\my_project\ainize\ChorusGate_dev | cf1e4343-9bbc-42d5-a911-c901e74e617e | E:\my_project\ainize\ChorusGate_dev | yes | 2026-06-13T09:57:35.449Z |
| default | claude | default:claude:channel:C0BAB3Y7LLC:E:\my_project\ainize\ChorusGate_dev | bbecca3f-ef78-4843-89be-5caab52bfc2e | E:\my_project\ainize\ChorusGate_dev | yes | 2026-06-13T08:57:14.185Z |
| default | claude | default:claude:channel:C0BAB3Y7LLC | 567432f0-b7c8-4598-a1b8-0a36a9147167 |  | yes | 2026-06-13T05:30:58.871Z |
