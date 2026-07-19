---
batch: 27
status: pending
type: backend
depends_on: ["batch-019-conversation-summary-and-memory", "batch-022-research-report-and-investment-journal", "batch-025-ai-observability-cost-and-evaluation"]
blocks: []
parallel_with: ["batch-028-controlled-sql-explorer", "batch-029-backtest-bias-and-adjustment-remediation"]
recommended_executor: general-coding-agent
recommended_reasoning_level: very-high
estimated_scope: medium
---

# Batch 027：pgvector 语义检索试点

## 1. 批次目标

用离线评测判断已确认研究报告/用户记忆的语义检索是否显著优于元数据+PostgreSQL FTS；仅达门禁时在同库启用 pgvector。

## 2. 业务价值

以证据决定是否承担向量索引、embedding 成本和隐私复杂度，避免对结构化行情错误使用 RAG。

## 3. 前置依赖

- Batch 019 有界记忆。
- Batch 022 已确认报告。
- Batch 025 评测/成本。

## 4. 执行范围

- 构建匿名/合成检索数据集和 FTS baseline。
- 选择 embedding port/model/version，离线生成报告/记忆片段 embedding。
- 可选启用 pgvector、HNSW/IVFFlat 对比、tenant filter 和 hybrid retrieval。
- 输出 go/no-go ADR 复审。

## 5. 不在本批次范围内

- 不向量化行情/财务事实表。
- 不部署独立向量数据库。
- 不向量化未确认会话、hidden reasoning 或敏感持仓正文。

## 6. 涉及的现有文件

- 当前 PostgreSQL 仅 plpgsql/pg_stat_statements，无 pgvector
- Batch 019 memory、Batch 022 reports
- PostgreSQL FTS 能力与 Batch 025 evaluation

## 7. 需要新增的文件

- `src/apps/agent/retrieval/retrieval.port.ts`
- `fts-retrieval.service.ts`、可选 `pgvector-retrieval.service.ts`
- `src/apps/agent/retrieval/embedding.provider.ts`
- `src/apps/agent/retrieval/test/retrieval-evaluation.spec.ts`
- 可选 `prisma/migrations/20260722000000_add_pgvector_retrieval/migration.sql`
- `docs/agent/decisions/adr-010-semantic-retrieval-pilot-result.md`

## 8. 需要修改的文件

- AiResearchReport/AiUserMemory 增可选 chunk/version 关系（仅 go）
- Model/provider config 增 embedding capability（仅 go）
- ContextBuilder 接 hybrid retriever feature flag

## 9. 数据库变更

- 先不改库完成 FTS baseline。Go 后 `CREATE EXTENSION vector`，新 `AiRetrievalChunk` 存 userId/sourceType/sourceId/chunkIndex/contentHash/embeddingModel/version/vector/metadata。
- 唯一 `(sourceType,sourceId,chunkIndex,contentHash,embeddingModel)`；所有查询先 userId filter。
- 在 41GB 热库评估索引 build/WAL/backup；若影响不可接受则 no-go/独立冷库另 ADR。

## 10. API 变更

不新增用户 API；检索结果仅进入 ContextBuilder manifest。管理员评测 API 可复用 Batch 025。

## 11. 后端实现任务

- chunking 稳定、版本化、源删除/更新可清理。
- hybrid score 不由模型决定；返回 source/citation IDs 和 score components。
- embedding provider 失败回退 FTS，不阻断会话。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

不新增模型 Tool；检索是 load_context 内部节点。结构化金融查询仍走 15 个 Tool。

## 14. 详细执行步骤

- 建立 query→relevant source gold set，测 FTS Recall@K/MRR/latency。
- 实现 retrieval port/FTS baseline。
- 批准试验环境 extension 后生成 embedding，测向量/hybrid 质量、成本、索引/备份。
- 做跨租户、删除、模型版本、stale chunk 测试。
- 按预设阈值写 ADR go/no-go；no-go 删除试验 extension/index。

## 15. 核心数据结构

- `RetrievalChunk`、`RetrievalHit { sourceId, citationIds, scores, contentHash }`、`RetrievalEvaluation`。

## 16. 关键接口定义

- `RetrievalPort.search(userId, query, filters, limit)`
- `EmbeddingProvider.embed(texts, modelVersion)`

## 17. 配置和环境变量

- `AGENT_RETRIEVAL_MODE=fts|hybrid` 默认 fts；embedding key/model/batch、max chunks、pgvector probes/efSearch。

## 18. 异常和边缘场景

- embedding 模型升级、维度变化、源删除、重复 chunk、中文分词、极短查询、用户无报告、索引 build 锁/磁盘膨胀。

## 19. 安全要求

- tenant filter 写入 SQL 本体并有跨租户测试；embedding 前敏感分类过滤。
- 外部 provider 不收到完整持仓/未确认会话。

## 20. 日志和可观测性要求

- retrieval recall/MRR/latency/cost/fallback/chunks/index size、tenant rejects；query 原文默认不记日志。

## 21. 测试要求

- gold set FTS/vector/hybrid 对比；跨租户/删除/版本/回退。
- EXPLAIN、索引 build/restore、磁盘/WAL 基线。

## 22. 执行命令

- `pnpm test -- src/apps/agent/retrieval/test/retrieval-evaluation.spec.ts`
- `pnpm run eval:agent -- --suite=retrieval`
- go 后仅测试库：`pnpm exec prisma migrate deploy`

## 23. 验收标准

- 只有预先声明的 Recall@K/MRR 改善、p95、成本、磁盘和隐私阈值全部通过才 go。
- 无论 go/no-go，结构化行情不向量化，跨租户为零。

## 24. 完成定义

baseline、port、试点评测、ADR 结果；go 时还需 migration/index/backup/删除测试，no-go 时默认 FTS 保持。

## 25. 回滚方案

切 `AGENT_RETRIEVAL_MODE=fts`；停止 embedding job。删除 vector index/table/extension 前确认无其他用户，源数据不受影响。

## 26. 后续批次

- go 后再评估更大语料或独立冷库；no-go 在数据集/需求显著变化时复审。
