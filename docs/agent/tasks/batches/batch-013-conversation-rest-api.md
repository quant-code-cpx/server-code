---
batch: 13
status: completed
type: backend
depends_on:
  [
    'batch-001-agent-public-contracts',
    'batch-002-conversation-and-message-schema',
    'batch-003-agent-audit-and-citation-schema',
    'batch-005-run-state-and-event-store',
    'batch-012-agent-bullmq-worker',
  ]
blocks: ['batch-014-post-sse-stream-and-replay', 'batch-018-mvp-e2e-and-model-regression']
parallel_with: ['batch-016-frontend-chat-shell', 'batch-017-frontend-rich-response-blocks']
recommended_executor: backend-coding-agent
recommended_reasoning_level: high
estimated_scope: large
---

# Batch 013：会话、消息与 Run REST API

## 1. 批次目标

实现 `/api/agent/*` 的会话、消息、Run 状态/取消/重生成/Tool 摘要接口，遵循全 POST、专用 DTO、显式状态码和租户权限。

## 2. 业务价值

提供前端完整命令/查询面，消息发送能原子建 Run 并入队，刷新后能查询权威状态。

## 3. 前置依赖

- Batch 001 公共契约。
- Batch 002/003/005 repositories。
- Batch 012 queue producer。

## 4. 执行范围

- AgentController/Application services/DTO/Swagger。
- 会话 create/list/detail/messages list/model update；messages send/regenerate；runs status/cancel/tool-calls list。
- clientRequestId 幂等、cursor、所有权、quota 和 response mapping。

## 5. 不在本批次范围内

- 不实现 SSE body；Batch 014。
- 不实现 schedule/report/notification API。
- 不修改全仓现有 200/201 漂移。

## 6. 涉及的现有文件

- `src/main.ts`、全局 JWT/roles/ValidationPipe/TransformInterceptor
- 现有 Controller/DTO/Swagger decorator 约定
- Batch 001–012 Agent 模块

## 7. 需要新增的文件

- `src/apps/agent/api/agent.controller.ts`
- `src/apps/agent/api/dto/conversation/*.dto.ts`
- `src/apps/agent/api/dto/run/*.dto.ts`
- `src/apps/agent/application/agent-conversation.service.ts`
- `src/apps/agent/application/agent-run.service.ts`
- `src/apps/agent/api/test/agent.controller.spec.ts`

## 8. 需要修改的文件

- `src/apps/agent/agent.module.ts` 注册 Controller/application services
- `src/app.module.ts` 导入 AgentModule（若尚未）
- Swagger tags/security 配置按现有模式

## 9. 数据库变更

不新增表；发送消息在一个事务创建 user message、assistant placeholder、Run、初始 event/outbox。入队由 durable outbox 保证。

## 10. API 变更

- 严格实现 `docs/agent/api/rest-api.md` 中 MVP endpoints。
- 每个 `@Post('非空路径')`、`@HttpCode(HttpStatus.OK)`、专用 class-validator DTO、Swagger response。
- 服务端忽略/拒绝 userId 字段；unknown DTO 字段应 fail，不静默丢弃。

## 11. 后端实现任务

- application service 区分 command/query；Controller 不直接 Prisma。
- quota/并发在 create Run 前检查；allowedCapabilities 只能收窄 policy。
- cancel 使用 expectedStatusVersion；终态幂等。
- tool-calls list 默认只返回脱敏摘要。

## 12. 前端实现任务

不涉及；Batch 015/016 接口已可联调。

## 13. Tool 或工作流变更

发送消息不直接执行 Tool；只创建 Run/queue。Tool list 查询检查 run 所有权。

## 14. 详细执行步骤

- 根据 REST 文档生成 DTO/controller 清单和 Swagger examples。
- 实现 application transaction/outbox/idempotency。
- 实现 user-scoped cursor queries、archive/model update/regenerate/cancel。
- 配置 raw stream endpoint 留给 Batch 014，不使用 Nest `@Sse()`。
- 写 API black-box tests：401/403/幂等/跨租户/DTO/状态竞态。

## 15. 核心数据结构

- `CreateConversationDto`、`SendMessageDto`、`PageContextDto`、`RunStatusDto`、`CancelRunDto` 等与公共契约一一对应。

## 16. 关键接口定义

- `AgentConversationApplication.create/list/detail/listMessages`
- `AgentRunApplication.send/regenerate/status/cancel/listToolCalls`

## 17. 配置和环境变量

- `AGENT_MAX_ACTIVE_RUNS_PER_USER`、`AGENT_DEFAULT_DAILY_BUDGET`；生产由配置校验。

## 18. 异常和边缘场景

- 重复 send 并发、归档会话发送、message 不属会话、非法 preferred model、取消终态、cursor 被篡改、队列暂时不可用。

## 19. 安全要求

- 全局 JWT + application 层 userId；所有 ID 查找统一 not found。
- DTO 禁止任意 pageContext 数据；route/entity type/ID/范围白名单与长度限制。

## 20. 日志和可观测性要求

- API request/result 只记录 userId hash、conversationId/runId、duration/code；不记录消息正文。
- 业务失败指标区分 HTTP success envelope 与 agent error code。

## 21. 测试要求

- Controller unit + supertest API integration；全部业务路由 POST 非空。
- Swagger status 与运行时一致；unknown fields 被拒绝。
- 跨用户每个 endpoint；clientRequestId 并发幂等；cancel CAS。

## 22. 执行命令

- `pnpm test -- src/apps/agent/api/test/agent.controller.spec.ts`
- `pnpm run build`
- `pnpm run lint`

## 23. 验收标准

- REST 文档 MVP endpoints 全部有 DTO/Swagger/test 和调用方。
- 消息发送一次事务形成可恢复 Run；队列失败不丢意图。
- 不存在内联 `@Body` type、默认 201 或跨租户访问。

## 24. 完成定义

- [x] 10 个 MVP 端点全部使用非空 `@Post`、HTTP 200、专用 class-validator DTO 和 Swagger response DTO。
- [x] 会话、消息、Run、Tool 摘要 application service 与 user-scoped Repository 已实现；Controller 不直接访问 Prisma。
- [x] `send/regenerate` 在单个 PostgreSQL 事务创建消息、Run、初始 Event 与 `AiJobOutbox`；事务后 BullMQ 失败由 outbox 恢复。
- [x] `clientRequestId` 并发幂等、不同请求 hash 冲突、活跃 Run/每日成本配额和已发布 Workflow/Prompt pin 已实现。
- [x] cancel CAS、终态幂等、waiting job 移除与 active AbortSignal 协作已接通，状态机不允许 `RUNNING → QUEUED`。
- [x] Agent 严格 Body Guard、显式 HTTP/业务错误码、跨租户 not found 和 Tool payload 脱敏已实现。
- [x] Controller/Supertest/application/真实 PostgreSQL/真实 Redis、Agent/Queue 回归、build、lint、容器与 JWT smoke 均通过。
- [x] 测试方案、执行报告、REST API 文档和运行手册已同步。
- [x] 实现提交：`1a4a8af feat(agent): add conversation and run REST API`。

## 25. 回滚方案

从 AppModule 移除 AgentModule/路由，停止 producer；保留会话/Run 数据，后续可恢复。

## 26. 后续批次

- Batch 014 增加 POST SSE。
- Batch 015–017 与真实 API 联调。
