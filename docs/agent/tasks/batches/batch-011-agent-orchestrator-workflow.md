---
batch: 11
status: pending
type: backend
depends_on: ["batch-004-model-gateway-foundation", "batch-005-run-state-and-event-store", "batch-006-tool-registry-and-policy", "batch-007-stock-market-query-tools", "batch-008-financial-fund-flow-tools", "batch-009-deterministic-quant-tools", "batch-010-web-search-and-citations"]
blocks: ["batch-012-agent-bullmq-worker", "batch-018-mvp-e2e-and-model-regression", "batch-019-conversation-summary-and-memory", "batch-020-scheduled-agent-tasks", "batch-023-multi-provider-routing-and-fallback"]
parallel_with: ["batch-015-frontend-stream-client-and-contracts", "batch-016-frontend-chat-shell", "batch-017-frontend-rich-response-blocks"]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 011：Agent Orchestrator 与版本化工作流

## 1. 批次目标

实现单个受控研究 Agent 的显式工作流：加载上下文、计划、授权/执行 Tool、确定性计算、模型合成、引用校验、持久化和终态。

## 2. 业务价值

形成可暂停、恢复、取消、测试和版本冻结的业务内核，避免不可控的递归 Agent loop。

## 3. 前置依赖

- Batch 004 模型网关。
- Batch 005 Run/Step/Event。
- Batch 006 Tool 执行器。
- Batch 007–010 的 15 个 MVP Tool。

## 4. 执行范围

- WorkflowRegistry、节点接口、条件边、checkpoint 和 v1 research workflow。
- 预算/最大步数/Tool 次数、并行只读调用、失败/降级/取消。
- 结构化计划摘要、事实包、引用覆盖校验和最终消息事务。

## 5. 不在本批次范围内

- 不引入 LangGraph或多 Agent。
- 不实现 BullMQ processor/HTTP/SSE；后续批次负责。
- 不保存或展示模型 hidden reasoning。

## 6. 涉及的现有文件

- Batch 004–010 新增模块
- `docs/agent/overview/agent-workflow-design.md`
- 现有 logger/context/metrics

## 7. 需要新增的文件

- `src/apps/agent/orchestrator/agent-orchestrator.service.ts`
- `src/apps/agent/workflow/workflow-engine.service.ts`
- `src/apps/agent/workflow/workflow-registry.service.ts`
- `src/apps/agent/workflow/nodes/*.node.ts`
- `src/apps/agent/workflow/workflows/stock-research.v1.ts`
- `src/apps/agent/workflow/test/stock-research.workflow.spec.ts`

## 8. 需要修改的文件

- `src/apps/agent/agent.module.ts` 注册 workflow/orchestrator
- Batch 003 prompt/workflow seed 或发布脚本

## 9. 数据库变更

不新增表；写 Batch 005 checkpoint/events 和 Batch 003 audit/citations。首次 workflow/prompt v1 通过 seed/publish command 写入版本表，禁止可变 upsert 覆盖已发布内容。

## 10. API 变更

不新增 Controller。每次节点状态映射 canonical SSE events，但这里只持久化事件。

## 11. 后端实现任务

- 固定节点 `load_context→plan→authorize_tools→execute_tools→synthesize→validate_citations→persist→complete`。
- plan schema 限制 Tool key/次数/依赖；独立 READ Tool 可并行，其他串行。
- 每节点前后检查 cancel/lease/budget，保存 checkpoint。
- 引用校验失败允许一次 repair；仍失败则 typed failure 或带明确未确认段落，不能伪引用。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

- 只通过 ToolExecutor；禁止节点直接注入领域 Service/Prisma。
- 模型请求只含受限事实包，大结果用 resultRef。

## 14. 详细执行步骤

- 定义 workflow/node/result/context contract 和注册版本校验。
- 实现 v1 nodes、事件与 checkpoint；用 fake model/tools 先走全链。
- 实现步数/Tool/token/金额预算和并行 join。
- 实现 Tool/model failure matrix、citation validation、cancel/resume。
- 写所有分支、崩溃点、版本冻结和 deterministic replay 测试。

## 15. 核心数据结构

- `WorkflowDefinition`、`WorkflowContext`、`NodeResult`、`ResearchPlan`、`FactPacket`、`FinalAnswerDraft`。
- Plan 只含可展示的步骤摘要，不含 chain-of-thought。

## 16. 关键接口定义

- `WorkflowEngine.execute(runId, lease, signal): Promise<RunTerminal>`
- `WorkflowRegistry.resolve(key, version)`
- `AgentOrchestrator.resume(runId, workerContext)`

## 17. 配置和环境变量

- `AGENT_MAX_STEPS`、`AGENT_MAX_TOOL_CALLS`、`AGENT_MAX_PARALLEL_TOOLS`、`AGENT_MAX_INPUT_TOKENS`、`AGENT_MAX_COST_PER_RUN`。

## 18. 异常和边缘场景

- 模型循环调用同 Tool、部分并行失败、过期数据、引用缺失、budget 中途耗尽、cancel、worker 崩溃、旧 workflow 恢复。

## 19. 安全要求

- workflow definition server-only；用户 allowedCapabilities 只能收窄管理员 policy。
- 外部/历史/Tool 文本始终作为 untrusted data；不允许动态代码/SQL。

## 20. 日志和可观测性要求

- 节点/Run 成功率、duration、retries、budget usage、citation coverage、cancel latency；trace span 贯穿 model/tool。

## 21. 测试要求

- fake model/tool 的普通问答、内部查询、内外融合、多 Tool、失败重试/降级、取消、恢复。
- 属性测试确保 max steps/tools/cost 不能绕过。
- workflow v1 snapshot/hash 固定。

## 22. 执行命令

- `pnpm test -- src/apps/agent/workflow/test/stock-research.workflow.spec.ts`
- `pnpm run build`

## 23. 验收标准

- 15 个 Tool 之外无法计划/执行；循环必在上限终止。
- 任一 checkpoint 崩溃后恢复不重复不可逆动作。
- 最终消息、引用、审计与 completed event 原子一致。

## 24. 完成定义

引擎、registry、v1 workflow/nodes、版本发布、fake 端到端与故障测试合入。

## 25. 回滚方案

停止后续 enqueue，将默认 workflow 指回前一已发布版本；进行中 Run 按固定版本完成/取消。版本记录不删除。

## 26. 后续批次

- Batch 012 接 BullMQ worker。
- Batch 013/014 暴露 API/stream。
- Batch 018 做真实闭环回归。
