---
batch: 19
status: completed
type: fullstack
depends_on:
  [
    'batch-002-conversation-and-message-schema',
    'batch-005-run-state-and-event-store',
    'batch-011-agent-orchestrator-workflow',
    'batch-018-mvp-e2e-and-model-regression',
  ]
blocks: ['batch-022-research-report-and-investment-journal', 'batch-027-vector-retrieval-pilot']
parallel_with:
  [
    'batch-020-scheduled-agent-tasks',
    'batch-023-multi-provider-routing-and-fallback',
    'batch-025-ai-observability-cost-and-evaluation',
    'batch-029-backtest-bias-and-adjustment-remediation',
  ]
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
- `prisma/migrations/20260721010000_add_ai_summary_and_memory/migration.sql`
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

当前进度（2026-07-21）：

- 第一阶段数据与策略地基已完成：新增 `AiConversationSummary`、`AiUserMemory`、`AiMemoryCategory/Sensitivity/Status`，会话可指向当前摘要，摘要保留消息范围、Prompt/model、source IDs、token 和 hash。
- 长期记忆固定为 `PREFERENCE/PROFILE/CONSTRAINT/DOMAIN_FACT`；状态为 `CANDIDATE/CONFIRMED/REVOKED/EXPIRED`；只有用户明确确认后才能进入长期上下文。
- 已冻结 TTL：偏好 365/1825 天、画像 365/1095 天、约束 180/730 天、领域事实 90/365 天（默认/最大）。持仓明细、交易日志、凭据、健康和政治推断禁止写入；金融敏感仅允许明确偏好或约束。
- migration 使用 partial unique 保证每个 `(userId,category,key)` 只有一个有效 `CONFIRMED` 版本，历史版本保留；CHECK 覆盖版本、hash、JSON、confidence、过期与状态时间戳。
- 第二阶段 Repository 已完成：`ConversationSummaryRepository` 以会话事务锁和 expected version CAS 原子创建摘要并推进 current；`UserMemoryRepository` 支持 candidate、confirm、active、correct、revoke、soft delete，并在所有资源/来源路径强制 owner 条件。
- 过期确认行会在同 key 新确认事务内推进为 `EXPIRED`，避免继续占用 active partial unique；新确认版本按已落地历史单调递增。纠错撤销旧版本与创建 `version + 1` 同事务完成。
- 策略 + Repository 共 33/33；31 个 P0/P1 业务场景全部通过，覆盖 Prompt 发布态、消息范围、历史不可变、事务故障注入、跨租户、TTL、敏感策略、删除、CAS、partial unique 和并发纠错。
- Prisma validate/generate、TypeScript、production build、lint baseline 通过。独立 PostgreSQL 16 fresh `migrate deploy` 38/38；主 PostgreSQL/Redis 未触碰。
- 第三阶段 Service/API 已完成：Summary Service 服务端计算稳定 content hash，会话详情只暴露 current metadata；Memory Service/API 支持 owner-scoped list/create/update/delete、显式确认、JSON 容量/深度限制与明显敏感内容拦截。
- 公开 create 直接使用单事务 `createConfirmed`，确认失败不遗留 candidate；list 使用 `(updatedAt,id)` 稳定 cursor，默认只返回 active，`includeInactive` 仍排除软删除值。
- 四个 API 全部为 `POST('非空路径')`、专用 DTO/Swagger response、严格未知字段拒绝；新增 6032–6036 错误码并同步前后端生成契约。
- 第三阶段联合回归 8 suites、107/107，包含独立 PostgreSQL 16 HTTP 全链、跨租户、来源、故障回滚、并发 create/update、Repository 33 场景和原 Agent Controller。
- 第四阶段已完成：`ContextBuilderService`、保守 token estimator、固定 segment 顺序、摘要 hash/gap 回退、截止日过滤、active memory、脱敏 manifest、目标模型窗口预算已接入 `load_context`/`plan`/`synthesize`；单元 13/13、真实 PostgreSQL workflow 2/2、Agent 回归 249 项、MVP E2E 19/19、PERF/LOAD/STRESS 通过。
- 第五阶段已完成：`ConversationSummaryGeneratorService` 在 `load_context` 前自动选择 canonical 旧消息，使用 8 条 + 2,048 token 双阈值、最近 20 条保护窗口、专用 `conversation_summary@1` 发布态 Prompt、严格 provenance/锚点校验和最多一次 CAS 重算；失败降级且用户取消向上终止。
- 新增 `AGENT_SUMMARY_ENABLED` 回滚开关和单批 500 条/8,192 token 上限；摘要模型 usage 纳入 Run 预算，同轮 Context 立即消费新摘要。
- 第五阶段回归：生成器与 Context 单元 30/30、真实 PostgreSQL 摘要/记忆 23/23、workflow 2/2、Agent 全回归 270 项、MVP E2E 20/20；10,001 消息候选选择 p95 23.69ms，20 会话 LOAD 与同会话 50 并发 STRESS 错误率均为 0。
- 第六阶段已完成：前端新增 `AgentMemoryDrawer`，在 Agent 页面标题栏提供入口，支持只读查看来源/用途/更新时间/到期时间、新建、显式确认纠正和删除确认；删除成功后立即从前端候选列表移除。界面只展示结构化长期记忆，不暴露摘要正文、来源内容或隐藏推理。
- 前端通过重新生成 Swagger/OpenAPI 契约接入 `memories/list/create/update/delete`，不维护手写 DTO；原生 select 的深浅主题、表单 name/autocomplete、长 JSON 换行、宽屏/移动抽屉、100 条列表渲染隔离、错误/空态与键盘可达性均已处理。
- 第六阶段验证（2026-07-22）：前端 lint 通过；`agent.test`、`agent-view.test`、`agent-memory-drawer.test` 共 15/15；`api:agent:check` 通过；production build 通过。后端 memory policy/service/controller/context/summary/workflow 6 suites、73/73 通过。UI 代码审查无遗留 Web Interface Guidelines 问题。
- 当前工作树尚未创建独立 commit/PR，由用户统一提交；本批次完成证据已记录，后续按 Batch 020/023/025/029 的依赖关系推进，向量检索仍由 Batch 027 负责。

## 25. 回滚方案

feature flag 停止摘要/记忆注入；保留原始消息。删除新表前导出用户确认记忆，默认不物理回滚。

## 26. 后续批次

- Batch 022 使用摘要/记忆生成研究日志。
- Batch 027 以离线评测决定向量检索。
