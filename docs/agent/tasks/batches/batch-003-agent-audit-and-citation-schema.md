---
batch: 3
status: pending
type: database
depends_on: ["batch-001-agent-public-contracts", "batch-002-conversation-and-message-schema"]
blocks: ["batch-005-run-state-and-event-store", "batch-006-tool-registry-and-policy", "batch-010-web-search-and-citations", "batch-013-conversation-rest-api", "batch-020-scheduled-agent-tasks", "batch-022-research-report-and-investment-journal"]
parallel_with: ["batch-004-model-gateway-foundation"]
recommended_executor: database-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 003：Agent 审计、来源与引用数据模型

## 1. 批次目标

新增 Tool、模型、搜索来源、引用、Prompt/Workflow 版本等审计模型，使每个金融结论可回溯到输入、时点和执行版本。

## 2. 业务价值

金融研究不能只有最终文本；本批次建立成本、来源、权限和可复现性的证据链。

## 3. 前置依赖

- Batch 001 公共状态/引用结构。
- Batch 002 会话与消息主键。

## 4. 执行范围

- 新增 `AiToolCall`、`AiModelCall`、`AiSearchSource`、`AiCitation`、`AiPromptVersion`、`AiWorkflowVersion`。
- 设计 payload hash、脱敏摘要和大 payload reference。
- 实现审计 repository 与引用完整性事务。

## 5. 不在本批次范围内

- Run/step/event 状态由 Batch 005 创建。
- 不实现 provider、Tool、网页抓取或 UI。
- 不把 hidden reasoning 写库。

## 6. 涉及的现有文件

- `prisma/audit_log.prisma`（仅借鉴，不复用为 Agent 审计）
- `prisma/report.prisma`、`prisma/research/research_note.prisma`
- `src/apps/user/audit-log.service.ts`
- Batch 002 新增的 conversation/message schema

## 7. 需要新增的文件

- `prisma/agent/audit.prisma`
- `prisma/agent/provenance.prisma`
- `src/apps/agent/audit/agent-audit.repository.ts`
- `src/apps/agent/audit/citation.repository.ts`
- `src/apps/agent/audit/test/agent-audit.repository.spec.ts`
- `prisma/migrations/20260720020000_add_ai_audit_and_citations/migration.sql`

## 8. 需要修改的文件

- `prisma/agent/conversation.prisma` 增加消息—引用关系
- `prisma/user.prisma` 增加必要审计关系（若设计需要）
- `src/apps/agent/agent.module.ts` 注册 repository

## 9. 数据库变更

- Tool call/model call 包含 runId nullable FK（Batch 005 后补强）、attempt、status、started/ended、sanitizedInput/Output、hash、token/cost、providerRequestId、errorClass。
- SearchSource 唯一 `(canonicalUrl, contentHash)` 或 source-level identity；Citation 连接 message/block/fact/source/toolCall，含 locator 和 quoteHash。
- Prompt/Workflow 使用 `(key,version)` 唯一、contentHash、status、publishedAt；发布版本不可修改。
- 高基数 payload 和事件按 createdAt/runId 建索引；生命周期/分区策略写入注释与数据库文档。

## 10. API 变更

不新增 API；为 `runs/tool-calls/list`、引用展示和管理员审计准备 repository view。

## 11. 后端实现任务

- 审计 start/complete/fail 使用 attempt 唯一键和状态机，不 fire-and-forget。
- sanitizer 先于持久化；完整 prompt/Tool 结果默认不存或经加密 object ref。
- Citation 完成前验证 source/locator/hash 存在；Run 完成事务必须能关联最终 message。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

提供 `beginToolCall/completeToolCall/failToolCall` 端口和 `createCitationSource`；Batch 006/010 调用。

## 14. 详细执行步骤

- 按数据库文档冻结模型与保留策略。
- 写 Prisma/migration 和约束，预留 Batch 005 run FK 的可控顺序。
- 实现审计端口、sanitized payload/hash、引用事务。
- 构造重复 attempt、缺来源引用、越权读取、成本 decimal 精度测试。
- 用空库和已有库副本验证 migration 与索引计划。

## 15. 核心数据结构

- 成本使用 Decimal，不用浮点；token 为非负整数。
- `CitationLocator` 存结构化 JSON：database snapshot/factId 或 web section/offset。
- `ConclusionLevel = FACT | PROGRAM_CALCULATION | MODEL_INFERENCE | SCENARIO` 进入 citation/message metadata。

## 16. 关键接口定义

- `beginToolCall(context, definition, sanitizedInputHash)`
- `finishModelCall(callId, usage, outputHash)`
- `createSearchSource(metadata): sourceId`
- `attachCitations(messageId, blockId, citations): void`

## 17. 配置和环境变量

- 可选 `AGENT_AUDIT_PAYLOAD_MODE=HASH_ONLY|ENCRYPTED_REF`，默认 `HASH_ONLY`。
- 加密密钥只来自 secret manager；MVP 不启用数据库明文完整 payload。

## 18. 异常和边缘场景

- provider 无 token usage；网页 canonical URL 变化；引用源被删除；attempt 崩溃停留 RUNNING；成本汇率未知。
- 审计写失败不得吞掉或把 Agent 标完成。

## 19. 安全要求

- 最小字段、hash、脱敏；持仓/自选/网页正文按数据分类保留。
- 普通用户只读自己的可展示摘要；内部 prompt、provider request 和错误堆栈不返回。

## 20. 日志和可观测性要求

- 审计写失败、orphan running attempt、引用无效、usage 缺失、成本未知均有指标/告警。
- 查询按 runId/messageId 的 p95 需可测。

## 21. 测试要求

- 状态转换/唯一 attempt/Decimal 精度/脱敏 snapshot。
- 引用必须指向当前用户可访问 message/source。
- 发布后的 prompt/workflow update 被数据库/服务拒绝。

## 22. 执行命令

- `pnpm prisma:generate`
- `pnpm exec prisma migrate deploy`（临时数据库）
- `pnpm test -- src/apps/agent/audit/test/agent-audit.repository.spec.ts`
- `pnpm run build`

## 23. 验收标准

- 一次 Tool/模型/search/citation 执行可通过 ID 完整串联，且无 hidden reasoning/secret 明文。
- 重复完成/失败操作幂等；不产生双计费。
- 引用缺源或 hash 不匹配时不能提交最终消息。

## 24. 完成定义

模型、migration、repository、sanitizer、集成测试和数据保留说明合入。

## 25. 回滚方案

先禁用审计消费者；新表默认保留。仅在确认无历史合规需求后执行独立 DROP migration，不级联删除消息。

## 26. 后续批次

- Batch 005 补 Run/Step/Event 并建立强 FK。
- Batch 006 使用 Tool 审计。
- Batch 010 使用来源/引用。
