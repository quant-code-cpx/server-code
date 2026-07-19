---
batch: 19
status: pending
type: backend
depends_on: ["batch-002-conversation-and-message-schema", "batch-005-run-state-and-event-store", "batch-011-agent-orchestrator-workflow", "batch-018-mvp-e2e-and-model-regression"]
blocks: ["batch-022-research-report-and-investment-journal", "batch-027-vector-retrieval-pilot"]
parallel_with: ["batch-020-scheduled-agent-tasks", "batch-023-multi-provider-routing-and-fallback", "batch-025-ai-observability-cost-and-evaluation", "batch-029-backtest-bias-and-adjustment-remediation"]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 019：会话摘要与显式用户记忆

## 1. 批次目标

实现最近消息+版本化滚动摘要+显式用户记忆的有界上下文，支持记忆查看/纠正/删除和摘要可追溯。

## 2. 业务价值

长会话不无限堆 token，同时避免模型把短期推断或错误事实偷偷变成长期用户画像。

## 3. 前置依赖

- Batch 002 会话/消息。
- Batch 005 Run 状态。
- Batch 011 工作流。
- Batch 018 MVP 基线。

## 4. 执行范围

- 新增 `AiConversationSummary`、`AiUserMemory` 与 repository/service。
- 摘要工作流、token budget context builder、memory candidate/confirm/expire。
- 用户管理 API 与前端最小设置入口（可在现有 Agent 页面抽屉）。

## 5. 不在本批次范围内

- 不做向量检索；Batch 027 先试点评测。
- 不保存 hidden reasoning。
- 不自动记忆持仓/敏感推断。

## 6. 涉及的现有文件

- Batch 002 conversation/message schema
- `src/apps/user/user.service.ts`、preferences
- `../client-code/src/sections/agent/`（Batch 016）

## 7. 需要新增的文件

- `prisma/agent/memory.prisma`
- `prisma/migrations/20260721000000_add_ai_summary_and_memory/migration.sql`
- `src/apps/agent/memory/conversation-summary.service.ts`
- `src/apps/agent/memory/user-memory.service.ts`
- `src/apps/agent/memory/context-builder.service.ts`
- `src/apps/agent/memory/test/context-builder.spec.ts`
- `../client-code/src/sections/agent/components/agent-memory-drawer.tsx`

## 8. 需要修改的文件

- AgentModule/Controller 增加 memory services/endpoints
- 前端 Agent route/API/types 增加记忆管理

## 9. 数据库变更

- Summary：conversationId、from/to message、version、prompt/model、content Json、contentHash、createdAt；唯一 `(conversationId,version)`。
- Memory：userId、key/category/value、sourceMessageId、status、sensitivity、confirmedAt/expiresAt/deletedAt、version；唯一 active `(userId,key)` 由服务保证/部分索引。

## 10. API 变更

- POST `/api/agent/memories/list/create/update/delete`；create 需要显式用户确认。
- 摘要不提供原始隐藏接口；会话 detail 只返回 summary metadata。

## 11. 后端实现任务

- ContextBuilder 固定顺序与 token budget；原始消息不可改写。
- 摘要只压缩指定连续区间，引用关键事实 source IDs；过期数据加 stale marker。
- Memory candidate 默认不启用自动写；敏感类别禁止或更高确认。

## 12. 前端实现任务

- 记忆抽屉展示来源、用途、更新时间、过期和删除；用户可纠正。
- 删除立即从新 Run context 排除。

## 13. Tool 或工作流变更

不新增模型自由 Tool；memory 写入是结构化用户 command。工作流只读 CONFIRMED active memory。

## 14. 详细执行步骤

- 冻结 memory category/sensitivity/retention policy。
- 写 Prisma/migration/repositories。
- 实现 context token estimator、summary generation+validation 和 memory CRUD。
- 在 Orchestrator load_context 接入，记录使用了哪些 summary/memory IDs。
- 实现前端管理与跨租户/删除/过期/summary drift 测试。

## 15. 核心数据结构

- `ConversationSummary`、`UserMemory { category, key, value, sensitivity, status, provenance }`。
- context manifest 持久化 ID/hash，不复制全部内容到日志。

## 16. 关键接口定义

- `ContextBuilder.build(runId, budget): ContextManifest`
- `ConversationSummaryService.compact(conversationId, range)`
- `UserMemoryService.confirm(userId, candidate)`

## 17. 配置和环境变量

- `AGENT_CONTEXT_MAX_TOKENS`、`AGENT_RECENT_MESSAGE_COUNT`、`AGENT_MEMORY_DEFAULT_TTL_DAYS`。

## 18. 异常和边缘场景

- 摘要过程中有新消息、摘要模型失败、旧 summary prompt version、记忆冲突、删除后缓存、用户要求“忘记”、数据时效过期。

## 19. 安全要求

- 用户只能管理自己的记忆；管理员不通过普通接口查看。
- 持仓、健康、凭据、政治/敏感画像不自动记忆；删除清缓存/向量副本。

## 20. 日志和可观测性要求

- context tokens 分布、summary ratio/failure/staleness、memory create/use/delete，不记录值。

## 21. 测试要求

- token budget/gap/并发摘要/版本/删除/过期/跨租户。
- 模型回归比较有无摘要事实保持，不允许幻觉写 memory。
- 前端可访问性和删除后新 Run 不使用。

## 22. 执行命令

- `pnpm prisma:generate && pnpm run build`
- `pnpm test -- src/apps/agent/memory/test/context-builder.spec.ts`
- `yarn --cwd ../client-code test agent-memory`

## 23. 验收标准

- 长会话 context 不超预算，关键实体/时点/用户约束可追溯。
- 未经确认的 candidate 不进入后续 Run；删除后立即失效。
- 原始消息与历史 summary 版本不被覆盖。

## 24. 完成定义

schema/migration、services、workflow 接入、管理 API/UI、隐私/回归测试和保留文档合入。

## 25. 回滚方案

feature flag 停止摘要/记忆注入；保留原始消息。删除新表前导出用户确认记忆，默认不物理回滚。

## 26. 后续批次

- Batch 022 使用摘要/记忆生成研究日志。
- Batch 027 以离线评测决定向量检索。
