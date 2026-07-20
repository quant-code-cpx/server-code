# Agent 实施任务

## 1. 拆分策略

采用“协议先行 + 模块并行 + 集成收口”。每个批次必须可由一个 coding agent 独立理解、实现、验证、提交和回滚；跨端公共结构只由 [API 协议](../api/README.md) 与 Batch 001 定义。MVP 被拆成数据门禁、契约、持久化、模型/Tool、编排/队列/API/SSE、前端和 E2E，不存在“完成整个 Agent”大批次。

Batch 000 是进入 Agent 金融 Tool 前的强制平台门禁；编号 001–018 构成 MVP。编号 019–026 与 029 是后续能力/生产化，其中 024 只有性能证据通过才实施。027/028 是默认不实施的条件试点。

## 2. 命名和状态

- 文件：`batch-NNN-kebab-case.md`；编号表达推荐执行顺序，slug 永不复用。
- frontmatter 的 `depends_on` 是硬依赖，`blocks` 是反向索引，`parallel_with` 只是推荐并行，不覆盖硬依赖。
- 状态只在批次文件 frontmatter 更新：`pending → in_progress → completed`；真实阻断写 `blocked` 并列出证据/解除条件。
- 完成时在批次第 24 节记录实际 commit/PR、验证命令和证据路径；不得只改状态。
- 任何 scope/契约变化先更新主设计与依赖图，再改批次；不在实现中悄悄新增 Tool/事件/表。

## 3. 执行顺序

1. Batch 000 与 001 并行：数据可重建/口径门禁、公共协议。
2. 001 后启动 004 和前端 015；000+001 后做 002，随后 003。
3. 003 后 005/006 并行；006+000 后 007/008/009 并行，003+006 后 010。
4. 前端 015→016→017 与上述后端工作并行，使用 fixture/MSW。
5. Tool/model/state 全部完成后执行 011→012→013→014；再由 018 做真实闭环验收。
6. MVP 后 019、020、023、025、029 可并行；021 跟随 020，022 跟随 019，026 最后生产收口。
7. 024、027、028 必须先通过各自 discovery/evaluation gate；门禁失败应形成 no-go 结论，不创建空架构。

详细图与并行/阻塞说明见 [依赖图](./dependency-map.md)，跨批次公共门禁见 [验收标准](./acceptance-criteria.md)。

## 4. 前后端协作

- Batch 001 输出生成式 TypeScript/JSON Schema 契约。
- Batch 015–017 只依赖契约和 fixtures，可在后端 004–014 期间并行。
- Batch 013/014 完成后，两端用同一 SSE fixture、event sequence、错误码和 content block schema 联调。
- Batch 018 是唯一 MVP 集成放行点；前端或后端单独“测试通过”不能替代它。

## 5. MVP 验收能力

Batch 000–018 完成后必须能：

```text
React 页面提问
→ NestJS 原子创建消息与 Run
→ BullMQ Worker 恢复版本化 workflow
→ 模型选择受控内部/量化/搜索 Tool
→ 程序完成确定性计算
→ 来源、Tool、模型、引用先持久化
→ POST SSE 可重连流式返回
→ 前端展示文字/表格/图/K线/引用/数据截止时间
→ 会话、事件和审计可查询
→ 用户可取消、刷新恢复、重新生成
```

MVP 不含多 Agent、向量数据库、独立 Python、任意 SQL、自动交易、模型自由提交回测或外部群发。

## 6. 批次索引

| 编号 | 批次                                                                                            | 阶段            | 类型      | 初始状态  |
| ---: | ----------------------------------------------------------------------------------------------- | --------------- | --------- | --------- |
|  000 | [平台数据与迁移就绪门禁](./batches/batch-000-platform-data-readiness.md)                        | MVP gate        | database  | completed |
|  001 | [Agent 公共协议与领域枚举](./batches/batch-001-agent-public-contracts.md)                       | MVP             | fullstack | completed |
|  002 | [会话与消息数据模型](./batches/batch-002-conversation-and-message-schema.md)                    | MVP             | database  | completed |
|  003 | [Agent 审计、来源与引用数据模型](./batches/batch-003-agent-audit-and-citation-schema.md)        | MVP             | database  | completed |
|  004 | [模型网关基础](./batches/batch-004-model-gateway-foundation.md)                                 | MVP             | backend   | completed |
|  005 | [Run 状态机与持久事件存储](./batches/batch-005-run-state-and-event-store.md)                    | MVP             | backend   | completed |
|  006 | [Tool Registry、策略与执行器](./batches/batch-006-tool-registry-and-policy.md)                  | MVP             | backend   | completed |
|  007 | [股票、市场与自选股查询 Tool](./batches/batch-007-stock-market-query-tools.md)                  | MVP             | backend   | completed |
|  008 | [财务、指标与个股资金流 Tool](./batches/batch-008-financial-fund-flow-tools.md)                 | MVP             | backend   | completed |
|  009 | [用户风险与确定性量化 Tool](./batches/batch-009-deterministic-quant-tools.md)                   | MVP             | backend   | completed |
|  010 | [受控联网搜索、抓取与引用](./batches/batch-010-web-search-and-citations.md)                     | MVP             | backend   | completed |
|  011 | [Agent Orchestrator 与版本化工作流](./batches/batch-011-agent-orchestrator-workflow.md)         | MVP             | backend   | completed |
|  012 | [Agent BullMQ Worker 与恢复](./batches/batch-012-agent-bullmq-worker.md)                        | MVP             | backend   | completed |
|  013 | [会话、消息与 Run REST API](./batches/batch-013-conversation-rest-api.md)                       | MVP             | backend   | completed |
|  014 | [POST SSE 流、重放与背压](./batches/batch-014-post-sse-stream-and-replay.md)                    | MVP             | backend   | completed |
|  015 | [前端流客户端与公共契约](./batches/batch-015-frontend-stream-client-and-contracts.md)           | MVP             | frontend  | pending   |
|  016 | [前端 AI 对话壳](./batches/batch-016-frontend-chat-shell.md)                                    | MVP             | frontend  | pending   |
|  017 | [前端富响应内容块](./batches/batch-017-frontend-rich-response-blocks.md)                        | MVP             | frontend  | pending   |
|  018 | [MVP 端到端、金融口径与模型回归](./batches/batch-018-mvp-e2e-and-model-regression.md)           | MVP acceptance  | testing   | pending   |
|  019 | [会话摘要与显式用户记忆](./batches/batch-019-conversation-summary-and-memory.md)                | Phase 2         | backend   | pending   |
|  020 | [定时与条件 Agent 任务](./batches/batch-020-scheduled-agent-tasks.md)                           | Phase 2         | backend   | pending   |
|  021 | [站内与外部通知渠道](./batches/batch-021-outbound-notification-channels.md)                     | Phase 2         | fullstack | pending   |
|  022 | [研究报告与投资日志闭环](./batches/batch-022-research-report-and-investment-journal.md)         | Phase 2         | fullstack | pending   |
|  023 | [多供应商模型路由与降级](./batches/batch-023-multi-provider-routing-and-fallback.md)            | Phase 2         | backend   | pending   |
|  024 | [无状态 Python 量化计算服务](./batches/batch-024-python-quant-compute-service.md)               | Conditional     | backend   | pending   |
|  025 | [AI 可观测性、成本与评测平台](./batches/batch-025-ai-observability-cost-and-evaluation.md)      | Phase 2         | platform  | pending   |
|  026 | [安全加固与生产部署](./batches/batch-026-security-hardening-and-production-deployment.md)       | Production      | platform  | pending   |
|  027 | [pgvector 语义检索试点](./batches/batch-027-vector-retrieval-pilot.md)                          | Conditional     | backend   | pending   |
|  028 | [受控只读 SQL Explorer 试点](./batches/batch-028-controlled-sql-explorer.md)                    | Conditional     | backend   | pending   |
|  029 | [回测点时性、股票池与复权修复](./batches/batch-029-backtest-bias-and-adjustment-remediation.md) | Phase 2 quality | backend   | pending   |

## 7. 验收和回滚规则

每批必须执行其第 22 节命令和 [公共验收标准](./acceptance-criteria.md) 的适用项。数据库批次必须用 fresh 临时库执行完整 migration，不允许 `db push` 代替；金融数据修复先 dry-run/副本/备份。回滚不删除审计证据，不把已修正数据恢复成已知错误口径。
