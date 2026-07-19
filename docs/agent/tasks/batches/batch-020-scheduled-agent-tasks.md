---
batch: 20
status: pending
type: backend
depends_on: ["batch-003-agent-audit-and-citation-schema", "batch-011-agent-orchestrator-workflow", "batch-012-agent-bullmq-worker", "batch-018-mvp-e2e-and-model-regression"]
blocks: ["batch-021-outbound-notification-channels"]
parallel_with: ["batch-019-conversation-summary-and-memory", "batch-023-multi-provider-routing-and-fallback", "batch-025-ai-observability-cost-and-evaluation", "batch-029-backtest-bias-and-adjustment-remediation"]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 020：定时与条件 Agent 任务

## 1. 批次目标

实现用户定时研究和结构化条件触发，采用唯一调度、交易日/数据水位门禁、幂等 execution 和 Agent queue。

## 2. 业务价值

让系统在数据真正就绪后主动研究，而不是多副本重复 cron、读到半同步数据或重复收费。

## 3. 前置依赖

- Batch 003 审计。
- Batch 011/012 workflow+queue。
- Batch 018 MVP 基线。

## 4. 执行范围

- 新增 `AiScheduledTask`、`AiTaskExecution`、scheduler/lease/service/controller。
- CRON、ONE_TIME、STRUCTURED_CONDITION；时区、交易日、data watermark、额度。
- create/list/detail/update/pause/resume/delete/run/executions API。

## 5. 不在本批次范围内

- 不实现外部渠道送达；Batch 021。
- 不接受任意代码、SQL 或自然语言 cron。
- 不直接添加无锁 `@Cron` 每用户任务。

## 6. 涉及的现有文件

- `src/tushare/sync/sync-registry.service.ts`、`sync-plan.types.ts`、`sync-log.service.ts` 与同步进度 models
- `src/apps/calendar/calendar.service.ts`
- 现有 ScheduleModule、screener-subscription scheduler/processor
- Batch 012 Agent queue

## 7. 需要新增的文件

- `prisma/agent/schedule.prisma`
- `prisma/migrations/20260721010000_add_ai_scheduled_task/migration.sql`
- `src/apps/scheduled-research/scheduled-research.module.ts`
- `scheduled-research.service.ts`、`repository.ts`、`scheduler.ts`、`controller.ts`、`dto/`
- `src/apps/scheduled-research/test/scheduled-research.spec.ts`

## 8. 需要修改的文件

- `src/app.module.ts` 导入模块
- process role 配置仅 scheduler 实例启用扫描
- Agent workflow registry 增加 schedule trigger context

## 9. 数据库变更

- Task 包含 user、trigger、cron/timezone/condition Json、workflow version/input、required watermarks、budget、nextRunAt/status/version。
- Execution 唯一 `(taskId,scheduledFor)`，含 runId/status/watermarks/cost/delivery status。
- due 索引 `(status,nextRunAt)`；claim 使用 `FOR UPDATE SKIP LOCKED` 或 PostgreSQL advisory/distributed lease。

## 10. API 变更

- 实现 REST 文档中的 `/api/agent/schedules/*` POST endpoints。
- DTO 使用 cron parser、IANA timezone、condition allowlist；run 手动执行也幂等。

## 11. 后端实现任务

- scheduler 只有 leader/claim owner 创建 execution；多副本安全。
- 交易日和 required data watermark 未就绪则 defer，不读部分更新。
- 每 execution 固定 workflow/prompt/model/tool policy 与预算，再入 Agent queue。

## 12. 前端实现任务

在 Agent 后续页面增加任务列表/表单可另批实现；本批次提供 API contract 和最小 API tests，不阻塞后台。

## 13. Tool 或工作流变更

schedule 创建/修改不注册成模型 Tool；workflow 完成写 execution/result ref。

## 14. 详细执行步骤

- 定义 trigger/condition/watermark schema 和 nextRun 计算。
- 写 Prisma/migration/repository/unique claim。
- 实现 scheduler tick、交易日+watermark gate、execution+outbox 事务。
- 实现 POST API、pause/resume/update/version CAS。
- 用双 scheduler、DST/时区、节假日、数据延迟、重复 tick、成本超限测试。

## 15. 核心数据结构

- `StructuredCondition { metricKey, resourceId, operator, threshold, window, cooldown }`。
- `RequiredWatermark { dataset, minTradeDate, freshness }`。

## 16. 关键接口定义

- `ScheduledResearchService.claimDue(now, owner)`
- `evaluateGate(task, watermarks)`
- `createExecutionOnce(taskId, scheduledFor)`

## 17. 配置和环境变量

- `SCHEDULER_ENABLED`、`AGENT_SCHEDULER_POLL_MS`、`AGENT_SCHEDULER_LEASE_MS`、每用户任务/每日执行上限。

## 18. 异常和边缘场景

- DST（虽默认上海也须正确）、修改与触发竞态、暂停已入队、节假日、同步延迟、多次条件满足、冷却、用户禁用、资源删除。

## 19. 安全要求

- userId 只从 JWT；condition resource 归属在创建和执行时双检。
- 不执行表达式代码/SQL；通知 channel 只能引用用户自有 ID。

## 20. 日志和可观测性要求

- due/claimed/deferred/watermark lag/duplicate prevented/execution success/cost；按 workflow key 聚合。

## 21. 测试要求

- 双实例 claim 只有一次 execution；同 scheduledFor 唯一。
- 交易日、水位、pause/resume/version/cooldown/跨租户。
- queue/worker 故障后 outbox 恢复。

## 22. 执行命令

- `pnpm prisma:generate`
- `pnpm test -- src/apps/scheduled-research/test/scheduled-research.spec.ts`
- `pnpm run build`

## 23. 验收标准

- 多副本/重复 tick 不重复 Run；数据未就绪明确 defer。
- 所有 execution 可关联固定版本、Run、成本和 gate evidence。
- 不存在用户可提交代码/SQL 的入口。

## 24. 完成定义

schema/migration、unique scheduler、API、queue 集成、并发/时点测试和运行文档合入。

## 25. 回滚方案

暂停全部 Agent schedules 并停止 scheduler role；已入队 Run 可取消。保留 task/execution 审计。

## 26. 后续批次

- Batch 021 发送完成通知。
- Batch 022 生成计划研究报告。
- Batch 026 部署独立 scheduler。
