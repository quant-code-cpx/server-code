---
batch: 14
status: pending
type: backend
depends_on: ["batch-005-run-state-and-event-store", "batch-012-agent-bullmq-worker", "batch-013-conversation-rest-api"]
blocks: ["batch-018-mvp-e2e-and-model-regression", "batch-025-ai-observability-cost-and-evaluation"]
parallel_with: ["batch-016-frontend-chat-shell", "batch-017-frontend-rich-response-blocks"]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 014：POST SSE 流、重放与背压

## 1. 批次目标

实现 `POST /api/agent/runs/events` 的 raw `text/event-stream`，从持久事件表重放并订阅新事件，支持 Last-Event-ID、心跳、鉴权、背压和刷新恢复。

## 2. 业务价值

前端实时看到 Tool/模型/引用进度；网络断开不丢事件，也不依赖不安全 WebSocket。

## 3. 前置依赖

- Batch 005 事件存储。
- Batch 012 Worker 产生事件。
- Batch 013 Controller/application 权限。

## 4. 执行范围

- POST fetch-SSE Controller/presenter、replay+tail、event serializer。
- Transform/HTTP metrics 对 raw stream 的显式 metadata bypass。
- 连接取消、慢消费者限制、token 过期/重连和多实例通知适配。

## 5. 不在本批次范围内

- 不使用 Nest `@Sse()` GET。
- 不把 Socket.IO 用于 token delta。
- 不新增事件名/字段；以公共契约为准。

## 6. 涉及的现有文件

- `src/lifecycle/interceptor/transform.interceptor.ts`、logging/metrics interceptors
- `src/shared/context/`
- Batch 005 `AiRunEvent` repository
- `docs/agent/api/sse-events.md`

## 7. 需要新增的文件

- `src/apps/agent/streaming/agent-stream.service.ts`
- `src/apps/agent/streaming/sse-event.serializer.ts`
- `src/apps/agent/api/agent-stream.controller.ts`
- `src/apps/agent/streaming/test/agent-stream.e2e-spec.ts`

## 8. 需要修改的文件

- `src/apps/agent/agent.module.ts` 注册 stream Controller/service
- Transform/logging/metrics interceptor 按 `@RawStreamResponse` metadata 处理
- 代理/Compose dev 配置关闭 stream buffering（生产详细 Batch 026）

## 9. 数据库变更

不新增表。replay 查询 `(runId,sequence)`；实时 tail 可以用 Redis pub/sub/PG notify 加速，但丢通知时轮询/重放保证正确性。

## 10. API 变更

- 实现 canonical `POST /api/agent/runs/events`；Body `{runId, afterSequence}`，Header 可用 `Last-Event-ID`。
- 严格序列化 14 个 event name；每个 frame `id/event/data`，heartbeat 是 comment 不占 sequence。

## 11. 后端实现任务

- 鉴权并检查 run userId 后才写 headers。
- 先获取 high-water mark、重放连续事件，再 tail 新事件，避免 replay/live 窗口。
- 每个事件先 DB commit 后发布；客户端 gap 可从 last contiguous 重连。
- 连接关闭触发 AbortSignal，只关闭订阅，不自动取消 Run。

## 12. 前端实现任务

不改前端；Batch 015 已实现 parser/reconnect。

## 13. Tool 或工作流变更

Tool/model 事件来自持久 event store，不直接从 adapter socket 推给 Controller。

## 14. 详细执行步骤

- 实现 serializer golden fixtures 与 CR/LF/UTF-8 安全。
- 实现 user-scoped replay、high-water handoff 和 live tail。
- 标记 raw response，让包装器不写 JSON；HTTP metrics 在连接结束计时。
- 实现 heartbeat、idle timeout、buffer bytes/connection/user limits。
- 用断线、gap、重复、token expiry、跨租户、慢 consumer、多实例模拟测试。

## 15. 核心数据结构

- `SseFrame { id: eventId, event: type, data: AgentSseEvent }`。
- 客户端 cursor 以 runId+sequence 为权威；Last-Event-ID 必须解析并绑定同 run。

## 16. 关键接口定义

- `AgentStreamService.stream(userId, runId, afterSequence, signal): AsyncIterable<AgentSseEvent>`
- `serializeSseEvent(event): string`

## 17. 配置和环境变量

- `AGENT_SSE_HEARTBEAT_MS`、`AGENT_SSE_IDLE_TIMEOUT_MS`、`AGENT_SSE_MAX_CONNECTIONS_PER_USER`、`AGENT_SSE_MAX_BUFFER_BYTES`。

## 18. 异常和边缘场景

- replay 与 live 竞态、终态后重连、事件大于 buffer、代理缓冲、半开连接、JWT 过期、重复 sequence、未知 event version、数据库短暂断开。

## 19. 安全要求

- SSE 与普通 API 同 JWT/tenant ACL；禁止 query-string token。
- headers 禁缓存，CORS/credentials 沿用认证策略；事件 payload 先 sanitizer。

## 20. 日志和可观测性要求

- active connections/replay count/replay lag/gap/bytes/duration/slow disconnect/auth reject；HTTP latency 在 close 结算。
- 日志不记录 model delta 正文。

## 21. 测试要求

- serializer snapshot；14 个 event 顺序/字段。
- supertest/真实 HTTP 流：断点、重复去重、gap、终态、取消、401/跨租户。
- 模拟 publish 丢失仍从 DB 读到；慢 consumer 被安全断开。

## 22. 执行命令

- `pnpm test -- src/apps/agent/streaming/test/agent-stream.e2e-spec.ts`
- `pnpm run build`
- `pnpm run lint`

## 23. 验收标准

- 断线后从任意已提交 sequence 恢复，无丢失、无跨用户、可容忍重复。
- TransformInterceptor 不包装/破坏流，指标不提前结束。
- 无需 WebSocket 即可完成全量 Agent 交互。

## 24. 完成定义

POST SSE、replay/tail、interceptor/metrics 适配、e2e 故障测试与代理要求文档合入。

## 25. 回滚方案

关闭 stream route/feature flag；Run 继续后台执行，客户端可轮询 `runs/status`。事件数据保留。

## 26. 后续批次

- Batch 015 前端联调。
- Batch 018 完整闭环和故障恢复。
- Batch 026 配置生产反向代理。
