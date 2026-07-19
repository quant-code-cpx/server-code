---
batch: 22
status: pending
type: fullstack
depends_on: ["batch-003-agent-audit-and-citation-schema", "batch-017-frontend-rich-response-blocks", "batch-019-conversation-summary-and-memory"]
blocks: ["batch-027-vector-retrieval-pilot"]
parallel_with: ["batch-021-outbound-notification-channels", "batch-023-multi-provider-routing-and-fallback", "batch-024-python-quant-compute-service", "batch-025-ai-observability-cost-and-evaluation", "batch-029-backtest-bias-and-adjustment-remediation"]
recommended_executor: general-coding-agent
recommended_reasoning_level: high
estimated_scope: large
---

# Batch 022：研究报告与投资日志闭环

## 1. 批次目标

将会话中的可引用研究保存为版本化报告/投资日志，异步生成产物并通过受控 `save_research_report` 明确确认写入。

## 2. 业务价值

把一次性聊天转为可复盘、可追溯的研究资产，并复用现有 Report/ResearchNote 能力。

## 3. 前置依赖

- Batch 003 来源/引用。
- Batch 017 富响应 UI。
- Batch 019 摘要/记忆。

## 4. 执行范围

- 新增 AiResearchReport 或扩展现有 Report 的明确关联；复用 ResearchNote 作个人日志并记录 thesis/risk/outcome。
- 报告 preview→确认→幂等保存，异步 renderer/StoragePort。
- 报告/日志 list/detail/save/delete API 和前端入口。

## 5. 不在本批次范围内

- 不自动发布/分享。
- 不让模型直接写文件路径或删除报告。
- 生产对象存储由 Batch 026 配置。

## 6. 涉及的现有文件

- `src/apps/report/report.service.ts`、renderer/data collector/controller
- `prisma/portfolio/report.prisma`、`prisma/research/research_note.prisma`
- `src/apps/research-note/research-note.service.ts`
- 前端报告/研究笔记与 Agent 富响应组件

## 7. 需要新增的文件

- `prisma/agent/research-report.prisma`（若不扩展现有 Report）
- 对应显式 migration
- `src/apps/agent/research/research-report.service.ts`
- `src/apps/agent/research/storage.port.ts`、`local-storage.adapter.ts`
- `src/apps/agent/tools/adapters/save-research-report.tool.ts`
- `src/apps/agent/research/test/research-report.spec.ts`
- 前端 `agent-report-preview-dialog.tsx`

## 8. 需要修改的文件

- ReportModule/ResearchNoteModule export 受控 Facade
- Report 生成移出 HTTP 同步路径到 Agent queue
- Agent Controller 增 reports endpoints
- 前端 Agent message action 接 preview/save

## 9. 数据库变更

- 报告关联 user/conversation/run/message、version、status、title/summary、contentBlocks、citation manifest、dataAsOf、storageKey/hash、createdAt。
- 投资日志复用 ResearchNote 时新增 sourceRunId/thesis/risk/outcome/reviewAt，migration 和软删策略明确。
- 唯一 `(userId, clientRequestId)` 与 report version。

## 10. API 变更

- 实现 REST 文档 reports list/detail/save/delete；save 首次返回 preview/confirmation token，再确认提交。
- delete 保持软删/文件清理 outbox，不直接孤立文件。

## 11. 后端实现任务

- Report Facade 复用 collector/template，但生成通过 queue；StoragePort 隔离本地/S3。
- 保存前引用覆盖、数据时点、风险提示、所有权验证。
- `save_research_report` WRITE/requiresConfirmation/idempotent；MVP registry 默认关闭，启用后只写当前用户。

## 12. 前端实现任务

- 预览对比即将保存的标题、数据截止、引用、风险；确认/取消明确。
- 报告详情复用安全 Markdown/chart/table；投资日志支持复盘状态。

## 13. Tool 或工作流变更

- 新增后续 canonical `save_research_report`，不计入 15 个 MVP 只读 Tool；definition version 1。

## 14. 详细执行步骤

- 作出复用现有 Report vs 新 model 的 schema 决策并更新 DB 文档。
- 实现 migration/repository/StoragePort/local adapter。
- 把 renderer 放 queue，修 delete file orphan。
- 实现 preview/confirmation token/Tool/API。
- 实现 UI 与引用、幂等、跨租户、生成失败、文件清理测试。

## 15. 核心数据结构

- `ResearchReportManifest { sourceRunId, messageVersion, dataAsOf, citationIds, blockHashes, rendererVersion }`。
- `InvestmentJournal { thesis, evidence, risks, decision, reviewAt, outcome }`。

## 16. 关键接口定义

- `ResearchReportService.preview(userId, runId)`
- `confirmAndSave(userId, token, clientRequestId)`
- `StoragePort.put/get/delete(key, stream)`

## 17. 配置和环境变量

- `AGENT_REPORT_STORAGE_DRIVER=local|s3`、local path、S3 endpoint/bucket/region/key、renderer timeout。

## 18. 异常和边缘场景

- 引用源过期、Run 重生成、重复确认、renderer/Chromium 失败、DB 保存后文件失败、删除文件失败、报告过大。

## 19. 安全要求

- storage key 随机且 tenant-scoped；下载鉴权/短签名，不公开桶。
- 报告 Markdown/图表白名单；文件不含 secret/hidden reasoning。

## 20. 日志和可观测性要求

- generation duration/failure/size/storage、citation coverage、orphan cleanup、confirmation abandon。

## 21. 测试要求

- preview/confirm token 篡改/过期/重复；跨租户。
- renderer snapshot、StoragePort contract、DB/file failure compensation、soft delete cleanup。
- 前端预览/取消/成功/错误。

## 22. 执行命令

- `pnpm test -- src/apps/agent/research/test/research-report.spec.ts`
- `pnpm run build`
- `yarn --cwd ../client-code test agent-report`

## 23. 验收标准

- 报告可从 run/message/version 重现来源、数据时点和渲染版本。
- 未确认不写；重复确认只生成一个报告/文件。
- 删除/失败不遗留无法追踪的对象。

## 24. 完成定义

schema 决策/migration、service/storage/tool/API/UI、异步生成和补偿测试合入。

## 25. 回滚方案

关闭保存 Tool/API；停止 renderer worker。保留报告元数据/对象，按清单人工/作业清理，不直接批删。

## 26. 后续批次

- Batch 027 可对已确认报告做语义检索试点。
- Batch 026 接生产对象存储。
