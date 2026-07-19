---
batch: 5
status: completed
type: backend
depends_on: ["batch-002-conversation-and-message-schema", "batch-003-agent-audit-and-citation-schema"]
blocks: ["batch-011-agent-orchestrator-workflow", "batch-012-agent-bullmq-worker", "batch-013-conversation-rest-api", "batch-014-post-sse-stream-and-replay", "batch-019-conversation-summary-and-memory", "batch-025-ai-observability-cost-and-evaluation"]
parallel_with: ["batch-004-model-gateway-foundation", "batch-006-tool-registry-and-policy", "batch-015-frontend-stream-client-and-contracts"]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 005：Run 状态机与持久事件存储

## 1. 批次目标

实现可恢复、可取消、可重放的 Agent Run/Step/Event 数据模型和原子状态机，PostgreSQL 成为权威状态源。

## 2. 业务价值

Worker 崩溃、页面刷新和 SSE 断线后仍能恢复；避免当前回测“DB 已取消但 Worker 最终写完成”的竞态。

## 3. 前置依赖

- Batch 002 会话/消息模型。
- Batch 003 审计/引用模型。

## 4. 执行范围

- 新增 `AiAgentRun`、`AiAgentStep`、`AiRunEvent`、outbox/lease 字段。
- 实现乐观锁状态机、单调 sequence、checkpoint、取消请求和 replay repository。
- 补 Tool/Model call 到 Run 的 FK。

## 5. 不在本批次范围内

- 不实现 BullMQ processor、Orchestrator、Controller 或 SSE socket。
- 不保存 hidden reasoning。

## 6. 涉及的现有文件

- `src/queue/backtesting/`（只借鉴，不复制取消缺陷）
- `src/apps/backtest/services/backtest-run.service.ts`
- Batch 002/003 Prisma files
- `src/shared/prisma.service.ts`

## 7. 需要新增的文件

- `prisma/agent/execution.prisma`
- `src/apps/agent/execution/agent-state-machine.service.ts`
- `src/apps/agent/execution/agent-run.repository.ts`
- `src/apps/agent/execution/agent-event.repository.ts`
- `src/apps/agent/execution/test/agent-state-machine.service.spec.ts`
- `prisma/migrations/20260720030000_add_ai_run_step_event/migration.sql`

## 8. 需要修改的文件

- `prisma/agent/audit.prisma` 增加 non-null/deferrable run 关系（按 migration 顺序）
- `src/apps/agent/agent.module.ts` 注册 execution providers

## 9. 数据库变更

- Run：conversation/message/user、status/statusVersion、workflow/model/tool policy versions、budget、cancelRequestedAt、leaseOwner/ExpiresAt、checkpoint Json、created/started/ended。
- Step：runId、stepKey、ordinal、attempt、status、input/output hash、started/ended；唯一 `(runId,stepKey,attempt)`。
- Event：runId、sequence、type、payload Json、occurredAt；唯一 `(runId,sequence)`；索引 `(runId,sequence)` 与清理日期。
- 每次状态变更和 event append 同事务；sequence 由数据库锁定的 run counter 分配。

## 10. API 变更

不实现；为 `runs/status/cancel/events` 提供 application service。

## 11. 后端实现任务

- 明确 allowed transition table；CAS `statusVersion` 更新失败返回 conflict。
- cancel 终态幂等；RUNNING 先到 CANCEL_REQUESTED，再由协作边界到 CANCELLED。
- lease 过期后可接管，但同 step attempt 唯一避免重复完成。
- replay 只按 user-scoped runId + afterSequence 查询。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

Tool/Model attempt 在步骤事务外可运行，但完成事件与审计更新要原子提交；副作用由 idempotency key 防重。

## 14. 详细执行步骤

- 画状态/事务不变量并转为表驱动测试。
- 新增 Prisma/migration、FK、索引和 check constraints（必要时 raw SQL）。
- 实现 createRun/claim/heartbeat/transition/requestCancel/checkpoint/appendEvent/replay。
- 用并发事务模拟双 worker、cancel-vs-complete、重复事件和 lease takeover。
- 验证事件缺口、顺序、分页与归档查询计划。

## 15. 核心数据结构

- 状态与公共契约一致；`checkpoint` 只含结构化节点状态/引用 ID，不含 SDK 对象。
- 事件 payload 有 schemaVersion；eventId 可稳定映射 run+sequence。

## 16. 关键接口定义

- `createRun(command): Promise<Run>`
- `claimRun(runId, workerId, leaseMs): Promise<Lease>`
- `transition(runId, expectedVersion, event): Promise<Run>`
- `requestCancel(userId, runId, expectedVersion): Promise<Run>`
- `replay(userId, runId, afterSequence, limit): Promise<RunEvent[]>`

## 17. 配置和环境变量

- `AGENT_RUN_LEASE_MS`、`AGENT_EVENT_REPLAY_LIMIT`、`AGENT_RUN_MAX_DURATION_MS`；给严格上下限。

## 18. 异常和边缘场景

- 双 worker claim；heartbeat 丢失；cancel 与 complete 同时发生；事件事务成功但 publish 失败；序号 gap；终态 retry；数据库时钟漂移。

## 19. 安全要求

- Run 创建和查询绑定 userId；worker 内部方法不暴露 Controller。
- checkpoint/event payload 过 sanitizer 和大小限制。

## 20. 日志和可观测性要求

- 状态转换总数/拒绝、lease takeover、orphan run、event append/replay latency、sequence gap。
- 所有日志含 runId/stepKey/attempt/traceId。

## 21. 测试要求

- 状态迁移表全覆盖；非法终态回写拒绝。
- 并发 claim/CAS/cancel race 集成测试。
- 崩溃后 checkpoint 恢复、事件 replay 无重无漏。
- migration/index query plan 验证。

## 22. 执行命令

- `pnpm prisma:generate`
- `pnpm exec prisma migrate deploy`（临时数据库）
- `pnpm test -- src/apps/agent/execution/test/agent-state-machine.service.spec.ts`
- `pnpm run build`

## 23. 验收标准

- PostgreSQL 独立于 Redis 可回答 Run 当前状态与完整事件序列。
- cancel 后任何迟到完成不能把状态改为 COMPLETED。
- 双 worker 只允许一个有效 lease/step completion。

## 24. 完成定义

schema/migration、状态机、repositories、并发集成测试、恢复/清理说明合入。

当前进度（2026-07-19）：

- 已新增 `AiAgentRun`、`AiAgentStep`、`AiRunEvent` 及 lease、checkpoint、event outbox 字段；Tool/Model 审计已收紧为强 Run/Step 关系，并用复合 FK 阻止跨 Run 关联。
- 已实现 create、claim、heartbeat、CAS transition、cancel、checkpoint、Step attempt、append 与 user-scoped replay repository；状态、版本和事件在同一事务提交。
- canonical Run 转换、终态不可变、数据库时钟 lease takeover、单调 sequence、payload 脱敏与 256KB 限制均由应用层和数据库约束双重保护。
- 独立 PostgreSQL fresh migration 32/32；Batch 005 单元/集成 14/14，Batch 001–004 相关回归 41/41，总计 55/55。
- 20 路并发写入 1000 个事件耗时 4.381 秒，sequence 1–1002 连续无缺口，replay 查询命中 `(runId, sequence)` 索引。
- 开发主库 migration 已部署且 up to date；开发容器已改用 `prisma migrate deploy`，Nest `Found 0 errors`，app/PostgreSQL/Redis 均 healthy，`/health` 返回 ok。
- 测试方案与执行报告：`docs/design/Agent运行状态与事件存储测试方案-20260719.md`、`docs/Agent运行状态与事件存储测试执行报告-20260719.md`。
- 实现 commit：`5b43612 feat(agent): persist run state and events`。

## 25. 回滚方案

停止 worker/API 写入，回滚代码；保留事件表用于审计。物理删除必须另做经批准 migration。

## 26. 后续批次

- Batch 011 使用状态机执行 workflow。
- Batch 012 接 BullMQ lease/恢复。
- Batch 014 以事件表实现 SSE replay。
