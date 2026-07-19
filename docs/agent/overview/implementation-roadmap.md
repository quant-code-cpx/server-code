# 实施路线

路线采用协议先行；完整依赖以 [批次依赖图](../tasks/dependency-map.md) 为准，公共完成门禁见 [验收标准](../tasks/acceptance-criteria.md)。本文只描述阶段目标和批次映射，不重复批次执行细节。

## Phase 0：可信基线与协议

包含：

- [Batch 000：平台数据与迁移就绪门禁](../tasks/batches/batch-000-platform-data-readiness.md)
- [Batch 001：Agent 公共协议与领域枚举](../tasks/batches/batch-001-agent-public-contracts.md)

两者可立即并行。000 修复 fresh migration、周/月涨跌幅、Dividend 重复和 retry 假成功；001 冻结 REST/SSE/状态/错误/内容块/Tool key。阶段验收：空库迁移可重放、数据口径 gate green、两端契约可生成。未完成前，不注册金融 Tool、不执行 Agent 生产 migration。

## Phase 1：MVP 可审计研究闭环

### 1. 持久化与模型/Tool 内核

- [Batch 002：会话与消息数据模型](../tasks/batches/batch-002-conversation-and-message-schema.md)
- [Batch 003：Agent 审计、来源与引用数据模型](../tasks/batches/batch-003-agent-audit-and-citation-schema.md)
- [Batch 004：模型网关基础](../tasks/batches/batch-004-model-gateway-foundation.md)
- [Batch 005：Run 状态机与持久事件存储](../tasks/batches/batch-005-run-state-and-event-store.md)
- [Batch 006：Tool Registry、策略与执行器](../tasks/batches/batch-006-tool-registry-and-policy.md)

002→003→005 串行保证 migration/FK；004 可在 002/003 期间并行；005 与 006 在 003 后并行。阶段局部验收：fake model、fixture Tool、状态机、取消、审计、引用和事件重放在无 Web UI 时可独立测试。

### 2. 第一批真实 Tool

- [Batch 007：股票、市场与自选股查询 Tool](../tasks/batches/batch-007-stock-market-query-tools.md)
- [Batch 008：财务、指标与个股资金流 Tool](../tasks/batches/batch-008-financial-fund-flow-tools.md)
- [Batch 009：用户风险与确定性量化 Tool](../tasks/batches/batch-009-deterministic-quant-tools.md)
- [Batch 010：受控联网搜索、抓取与引用](../tasks/batches/batch-010-web-search-and-citations.md)

四个批次在 006 后并行。首期 15 个 Tool 名和 Schema 见 [Tool 方案](../tools/README.md)。验收重点是 userId 不可由模型覆盖、公告时点/单位/复权/数据截止正确、确定性算法可复现、抓取无法 SSRF、外部事实可引用。

### 3. 编排、后台执行与 API

- [Batch 011：Agent Orchestrator 与版本化工作流](../tasks/batches/batch-011-agent-orchestrator-workflow.md)
- [Batch 012：Agent BullMQ Worker 与恢复](../tasks/batches/batch-012-agent-bullmq-worker.md)
- [Batch 013：会话、消息与 Run REST API](../tasks/batches/batch-013-conversation-rest-api.md)
- [Batch 014：POST SSE 流、重放与背压](../tasks/batches/batch-014-post-sse-stream-and-replay.md)

推荐 011→012→013→014。完成后后端能在独立 Worker 运行单 Agent workflow，数据库 checkpoint 恢复，POST SSE 从持久事件重放；Redis 不是权威源。

### 4. 前端并行线

- [Batch 015：前端流客户端与公共契约](../tasks/batches/batch-015-frontend-stream-client-and-contracts.md)
- [Batch 016：前端 AI 对话壳](../tasks/batches/batch-016-frontend-chat-shell.md)
- [Batch 017：前端富响应内容块](../tasks/batches/batch-017-frontend-rich-response-blocks.md)

015 在 Batch 001 后即可启动；015→016→017 串行，但整体与后端 004–014 并行。前端先用 MSW/fixtures，013/014 完成后切真实接口。验收包括 POST Fetch SSE、刷新恢复、取消/重生成、会话列表，以及安全渲染 Markdown/Tool/引用/Table/Chart/Kline/Financial/Risk blocks。

### 5. MVP 汇合

- [Batch 018：MVP 端到端、金融口径与模型回归](../tasks/batches/batch-018-mvp-e2e-and-model-regression.md)

阶段最终能力：用户在 React 提问；NestJS 创建可恢复 Run；单个受控 Agent 判断内部查询、确定性计算或联网搜索；Tool/模型/来源/引用完整持久化；POST SSE 返回；前端展示内容块和数据截止时间；刷新、取消和重生成可用。

MVP 验收：fake provider 的全链 CI 稳定，真实数据 golden case 无单位/点时性错误，跨租户/注入/SSRF 为零，断线/Worker crash 可恢复，成本/步数/超时上限生效。

MVP 延后：自动多模型、长期记忆、定时任务、外部通知、报告写入、Python、向量检索、SQL explorer、新回测提交和自动交易。

## Phase 2：主动研究、记忆、报告与质量

基础完成后可并行：

- [Batch 019：会话摘要与显式用户记忆](../tasks/batches/batch-019-conversation-summary-and-memory.md)
- [Batch 020：定时与条件 Agent 任务](../tasks/batches/batch-020-scheduled-agent-tasks.md)
- [Batch 023：多供应商模型路由与降级](../tasks/batches/batch-023-multi-provider-routing-and-fallback.md)
- [Batch 025：AI 可观测性、成本与评测平台](../tasks/batches/batch-025-ai-observability-cost-and-evaluation.md)
- [Batch 029：回测点时性、股票池与复权修复](../tasks/batches/batch-029-backtest-bias-and-adjustment-remediation.md)

随后：

- [Batch 021：站内与外部通知渠道](../tasks/batches/batch-021-outbound-notification-channels.md)，依赖 020。
- [Batch 022：研究报告与投资日志闭环](../tasks/batches/batch-022-research-report-and-investment-journal.md)，依赖 019 和前端富响应。

阶段能力：长会话有界上下文和可管理记忆；研究按交易日/数据水位唯一触发；送达失败不重跑研究；报告可追踪到消息/Run/引用；至少两模型按隐私/能力/预算路由；Agent 指标、成本和回归评测可操作；新回测具备 point-in-time 与可复现标记。

## Phase 3：生产加固

- [Batch 026：安全加固与生产部署](../tasks/batches/batch-026-security-hardening-and-production-deployment.md)

在 000、018、021、023、025 完成后执行。修复生产健康检查、`.dockerignore`、one-shot migrate、非 root 存储/Chromium、队列 Redis noeviction/ACL、API/Worker/Scheduler 分离、唯一调度、WebSocket 强鉴权/所有权/Redis adapter、CI E2E、对象存储、备份恢复、灰度和回滚。

阶段验收：全新环境只靠 migration 与部署清单可重建；备份可恢复；多副本不重复 schedule/通知；跨实例 SSE/通知契约可用；SLO/告警和回滚演练通过。

## 条件能力：默认不实施

- [Batch 024：无状态 Python 量化计算服务](../tasks/batches/batch-024-python-quant-compute-service.md)：仅在 CPU/科学库/隔离的 benchmark 门禁通过后；否则保留 TypeScript。
- [Batch 027：pgvector 语义检索试点](../tasks/batches/batch-027-vector-retrieval-pilot.md)：仅当 hybrid retrieval 明显优于元数据+FTS；结构化行情永不向量化。
- [Batch 028：受控只读 SQL Explorer 试点](../tasks/batches/batch-028-controlled-sql-explorer.md)：仅在固定 Tool 无法覆盖且只读副本/AST/安全评测全通过；默认禁用。

条件失败的正确产物是有证据的 no-go ADR，不是空服务或永久维护成本。

## 最先开发与并行建议

最先开发 Batch 000 和 001。可立即分两条线：数据库/Tushare 修复；公共协议/前端 stream fixture。下一波把数据库 002→003 与模型 004、前端 015→016 并行；003 后让 005/006 并行；随后四类 Tool 与前端 017 并行。Orchestrator 只在 Tool/状态/模型都稳定后接入。

任何实现若发现新公共事件、Tool key、表或跨模块权限，应停止该批次，更新主设计/ADR/依赖后再继续；不得在单个 PR 内重新发明架构。
