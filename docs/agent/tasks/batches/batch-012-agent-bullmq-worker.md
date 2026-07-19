---
batch: 12
status: completed
type: backend
depends_on: ['batch-005-run-state-and-event-store', 'batch-011-agent-orchestrator-workflow']
blocks:
  [
    'batch-013-conversation-rest-api',
    'batch-014-post-sse-stream-and-replay',
    'batch-018-mvp-e2e-and-model-regression',
    'batch-020-scheduled-agent-tasks',
    'batch-024-python-quant-compute-service',
    'batch-025-ai-observability-cost-and-evaluation',
  ]
parallel_with:
  [
    'batch-015-frontend-stream-client-and-contracts',
    'batch-016-frontend-chat-shell',
    'batch-017-frontend-rich-response-blocks',
  ]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 012：Agent BullMQ Worker 与恢复

## 1. 批次目标

新增独立 Agent queue/processor，把所有 Run 交给可水平扩展 Worker，支持 lease、heartbeat、幂等入队、取消、重试和进程崩溃恢复。

## 2. 业务价值

模型、搜索和长计算不占用 HTTP 生命周期；API 与 worker 可独立部署，Redis 丢失也能以 PostgreSQL 重建。

## 3. 前置依赖

- Batch 005 状态/lease/event store。
- Batch 011 Orchestrator。

## 4. 执行范围

- Agent queue constants、job contract、producer、processor、reconciler。
- API/worker/scheduler 进程角色配置，独立并发和优雅关闭。
- PostgreSQL intent/outbox 到 BullMQ 的幂等投递与 orphan Run 恢复。

## 5. 不在本批次范围内

- 不实现 Controller/SSE。
- 不把 BullMQ job data 当权威正文。
- 不修复其他三条现有队列，生产统一治理归 Batch 026。

## 6. 涉及的现有文件

- `src/queue/backtesting/`、event-study/screener processors
- `src/shared/metrics/bullmq*`（真实文件按仓库）
- Redis/queue config 与 Docker Compose

## 7. 需要新增的文件

- `src/queue/agent/agent.queue.constants.ts`
- `src/queue/agent/agent-job.interface.ts`
- `src/queue/agent/agent-queue.service.ts`
- `src/queue/agent/agent.processor.ts`
- `src/queue/agent/agent-reconciler.service.ts`
- `src/queue/agent/test/agent.processor.spec.ts`
- `src/worker.main.ts`

## 8. 需要修改的文件

- `src/app.module.ts`/AgentModule 按 process role 注册 producer/processor
- `src/config/redis.config.ts`、`.env.example`
- Docker Compose 增加可选 agent-worker service

## 9. 数据库变更

复用 Batch 005 run/outbox/lease；如 outbox 未独立 model，本批次增加最小 `AiJobOutbox` migration 并索引 `(status,nextAttemptAt)`，不得仅用内存 publish。

## 10. API 变更

不新增 API；producer 返回 runId/jobId，取消由 application service 写 DB 并尝试 remove waiting job。

## 11. 后端实现任务

- job payload 只含 runId/schemaVersion；jobId=runId 防重复。
- processor claim DB lease 后调用 orchestrator；heartbeat 续租，终止前刷新状态。
- BullMQ retry 只处理基础设施故障；业务 step retry 在 workflow。
- reconciler 扫描 QUEUED/lease-expired Run，幂等补投。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

worker 向 Tool/Model 传播 AbortSignal；cancel 后迟到结果不能完成 Run。

## 14. 详细执行步骤

- 定义 queue connection/name/payload/attempt 分工。
- 实现 outbox producer + processor lease/heartbeat/graceful shutdown。
- 实现 cancel waiting/active cooperative path。
- 实现 reconciler 与 Redis flush/restart 后重建测试。
- 拆分 `main.ts`/`worker.main.ts` 启动角色和 Compose service。

## 15. 核心数据结构

- `AgentJob { schemaVersion:1, runId }`。
- `AiJobOutbox { aggregateId, kind, status, attempt, nextAttemptAt, payloadHash }`（若 Batch 005 未覆盖）。

## 16. 关键接口定义

- `AgentQueue.enqueueRun(runId)`
- `AgentProcessor.process(job)`
- `AgentReconciler.requeueRecoverableRuns()`

## 17. 配置和环境变量

- `PROCESS_ROLE=api|agent-worker|scheduler|all`（开发可 all，生产分离）
- `AGENT_QUEUE_REDIS_URL`、`AGENT_WORKER_CONCURRENCY`、`AGENT_JOB_TIMEOUT_MS`、`AGENT_LEASE_HEARTBEAT_MS`。

## 18. 异常和边缘场景

- enqueue 事务后崩溃、Redis flush、重复 job、worker SIGTERM、stalled job、lease 过期误接管、cancel waiting/active、provider socket 不响应 abort。

## 19. 安全要求

- queue Redis 生产 `noeviction`、独立凭据/ACL/namespace；job 不含 prompt/user payload。
- Worker 不暴露 HTTP 公网端口。

## 20. 日志和可观测性要求

- queue depth/wait/active/stalled/failed、enqueue lag、lease heartbeat/takeover、run recovery；扩展现有指标覆盖 Agent。

## 21. 测试要求

- Testcontainers/isolated Redis+DB 的 duplicate enqueue、crash/reconcile、cancel、SIGTERM、Redis loss。
- processor 不在无 lease 时执行；job attempts 不造成双计费。

## 22. 执行命令

- `pnpm test -- src/queue/agent/test/agent.processor.spec.ts`
- `RUN_AGENT_QUEUE_INTEGRATION=true pnpm test -- src/queue/agent/test/agent-queue.integration.spec.ts --runInBand`
- `RUN_AGENT_DB_INTEGRATION=true pnpm test -- src/apps/agent/execution/test/agent-execution.repository.spec.ts --runInBand`
- `pnpm run build`
- `docker compose up -d database redis`（测试环境）

## 23. 验收标准

- HTTP 返回后 worker 可完成 Run；worker 重启/Redis 清空后可恢复未终态 Run。
- 同 runId 并发 job 只有一个有效执行；取消竞态不出现 completed。
- 生产配置可以单独启动 API 和 Agent Worker。

## 24. 完成定义

- [x] 新增 `agent-execution` queue、严格 `{ schemaVersion: 1, runId }` payload、`jobId=runId` 与稳定 payload hash；正文、用户上下文和未知字段不能进入 Redis。
- [x] `AgentRunRepository.createRun()` 在创建 Run 的同一 PostgreSQL 事务写入 `AiJobOutbox`；migration、状态/时间/hash 约束和 `(status,nextAttemptAt,id)` 索引已部署。
- [x] Producer 支持重复 enqueue 幂等、失败指数退避、waiting job 取消、失败/完成残留 job 清理；Redis 丢失后可从非终态 Run 重建。
- [x] Processor 每次 delivery 生成新 worker identity，只调用 `AgentOrchestratorService.resume()`；业务 `COMPLETED/FAILED/CANCELLED` 不触发 BullMQ retry，lease/网络/进程类错误继续 retry。
- [x] Reconciler 扫描 due outbox、`QUEUED` 与 lease-expired `RUNNING/CANCEL_REQUESTED` Run；不引入非法 `RUNNING → QUEUED` 状态转换。
- [x] Worker shutdown、job timeout、heartbeat cancel 统一传播 `AbortSignal`；取消后迟到 Tool/Model 结果不能完成 Run。
- [x] 新增 `PROCESS_ROLE=api|agent-worker|scheduler|all`、`worker.main.ts`、独立并发/timeout/reconcile 配置与可选 Compose `agent-worker` profile；Worker 不暴露 HTTP 端口且禁用 Tushare scheduler。
- [x] Agent queue waiting/active/failed/delayed、stalled、enqueue lag、recovery 指标已接入；Redis 淘汰策略改为 BullMQ 要求的 `noeviction`。
- [x] 专项单测 30/30、真实 Redis 2/2、独立 PostgreSQL 9/9、Agent/Portfolio/Backtest 627/627、Stock 229/229、build/contracts/Prisma/ESLint/Prettier、Docker health/ready 与真实 Worker restart 验证通过。
- [x] 运行、恢复、监控和回滚步骤见[智能体队列工作进程运行手册](../../backend/智能体队列工作进程-运行手册.md)。
- [x] 实现提交：`19069a7 feat(agent): add durable BullMQ worker recovery`。

## 25. 回滚方案

停止 agent-worker，禁用 producer；保留 QUEUED Run，可在恢复版本后重投。不要删除 Redis/DB 状态。

## 26. 后续批次

- Batch 013 API 创建/控制 Run。
- Batch 014 SSE 消费事件。
- Batch 020 schedule 复用 queue。
