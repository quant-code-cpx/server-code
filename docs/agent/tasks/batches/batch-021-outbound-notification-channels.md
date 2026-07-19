---
batch: 21
status: pending
type: fullstack
depends_on: ["batch-020-scheduled-agent-tasks"]
blocks: ["batch-026-security-hardening-and-production-deployment"]
parallel_with: ["batch-019-conversation-summary-and-memory", "batch-022-research-report-and-investment-journal", "batch-023-multi-provider-routing-and-fallback", "batch-024-python-quant-compute-service", "batch-025-ai-observability-cost-and-evaluation", "batch-029-backtest-bias-and-adjustment-remediation"]
recommended_executor: general-coding-agent
recommended_reasoning_level: high
estimated_scope: large
---

# Batch 021：站内与外部通知渠道

## 1. 批次目标

用事务 outbox 和 DeliveryAttempt 把 Agent/定时任务结果可靠送达站内信及经确认的外部渠道，独立重试而不重跑研究。

## 2. 业务价值

用户可收到主动研究结果，同时避免当前通知吞异常、仅本进程 WS 和重复送达问题。

## 3. 前置依赖

- Batch 020 任务 execution。

## 4. 执行范围

- 新增 NotificationChannel/Delivery models、channel port、in-app adapter 和一个经用户确认的外部 adapter。
- 加密渠道配置、test/send/retry、outbox processor、幂等和状态 UI/API。
- 修正 Agent 相关 WS 仅作通知加速，正文仍通过 REST/SSE/报告读取。

## 5. 不在本批次范围内

- 不支持普通微信非官方接口。
- 不让模型自由选收件人/群发。
- 不因 delivery 失败重跑 Agent。

## 6. 涉及的现有文件

- `src/apps/notification/notification.service.ts`、controller/module
- `src/websocket/events.gateway.ts`
- `src/shared/token.service.ts`、Redis/queue
- 前端 sync notification Context

## 7. 需要新增的文件

- `prisma/agent/notification-channel.prisma`
- `prisma/migrations/20260721020000_add_ai_notification_delivery/migration.sql`
- `src/apps/notification/channels/notification-channel.port.ts`
- `in-app.channel.ts` 与批准的外部 channel adapter
- `src/apps/notification/notification-outbox.processor.ts`
- `src/apps/notification/test/agent-notification.spec.ts`
- `../client-code/src/sections/agent/components/notification-channel-settings.tsx`

## 8. 需要修改的文件

- NotificationModule/Service 停止对 Agent delivery 吞异常
- Agent/schedule 完成事务写 outbox
- EventsGateway 在安全修复前可由 feature flag 禁用
- Agent REST 增加 channels/deliveries endpoints

## 9. 数据库变更

- Channel：userId/type/name/encryptedConfig/status/verifiedAt/lastFour/version。
- Delivery：userId/channelId/executionId/runId/idempotencyKey/payloadRef/status/attempt/nextAttemptAt/providerMessageId/errorClass。
- 唯一 idempotencyKey；due retry 索引。

## 10. API 变更

- POST `/api/agent/notification-channels/list/create/update/test/delete` 和 `/notification-deliveries/list/retry`。
- 配置字段 type-specific DTO；响应永不返回 secret。

## 11. 后端实现任务

- completion 事务只写 delivery intent；processor 发送并记录每 attempt。
- 相同 idempotency key/provider key 防重复；永久/临时错误分类。
- in-app 复用 Notification 表与 service，但失败不得吞；WS emit 失败不等于持久通知失败。

## 12. 前端实现任务

- 渠道设置、验证状态、脱敏配置、测试结果和送达历史。
- 通知点击导航到 conversation/report/run，不在 push 放敏感全文。

## 13. Tool 或工作流变更

不新增模型 Tool；workflow 只能引用已验证、当前用户自有 channel IDs。

## 14. 详细执行步骤

- 确认首个外部渠道与 secret 管理方式。
- 写 schema/migration/channel port/encryption envelope。
- 实现 in-app + external adapter contract suite。
- 接 schedule/Run outbox、processor/retry/idempotency。
- 实现 API/UI、跨租户、重复、provider timeout/accepted-but-response-lost 测试。

## 15. 核心数据结构

- `NotificationEnvelope { templateKey, subject, summary, deepLink, classification }`。
- 渠道 secret 使用 key version + ciphertext，不存明文。

## 16. 关键接口定义

- `NotificationChannel.send(envelope, idempotencyKey, signal)`
- `DeliveryService.enqueueFromExecution(executionId)`
- `DeliveryProcessor.process(deliveryId)`

## 17. 配置和环境变量

- 渠道 provider key、`NOTIFICATION_ENCRYPTION_KEY`、delivery timeout/max attempts、WS feature flag；只在 secret manager。

## 18. 异常和边缘场景

- provider 已接收但响应丢失、用户删渠道、密钥轮换、退订、频率限制、深链资源已删、WS 离线、多设备。

## 19. 安全要求

- 收件地址/secret 脱敏和加密；test 发送也限流/审计。
- 禁止模型构造任意 recipient 或模板 HTML；Markdown/链接白名单。

## 20. 日志和可观测性要求

- delivery success/failure/retry/lag/provider、outbox backlog、WS emit；日志只含 channelId/lastFour。

## 21. 测试要求

- adapter contract、幂等、加密轮换、跨租户、重试分类、outbox crash。
- 前端 secret 不回显、可访问性、删除渠道。

## 22. 执行命令

- `pnpm test -- src/apps/notification/test/agent-notification.spec.ts`
- `pnpm run build`
- `yarn --cwd ../client-code test notification-channel-settings`

## 23. 验收标准

- delivery 失败不改变已完成 Run 且可独立重试。
- 重复 processor/provider 模糊响应不会重复用户可见通知。
- 任何 API/日志/前端状态不泄露 secret/完整敏感研究。

## 24. 完成定义

schema、port、至少站内+一个批准渠道、outbox、API/UI、加密/幂等/故障测试合入。

## 25. 回滚方案

暂停外部 channel processor，仅保留站内/历史；吊销 provider key。渠道密文保留或按用户请求安全删除。

## 26. 后续批次

- Batch 026 生产 secret/WS/队列部署。
- 后续按同一 port 增加邮件/IM adapter。
