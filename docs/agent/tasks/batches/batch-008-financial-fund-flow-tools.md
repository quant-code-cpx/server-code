---
batch: 8
status: completed
type: backend
depends_on: ['batch-000-platform-data-readiness', 'batch-006-tool-registry-and-policy']
blocks: ['batch-011-agent-orchestrator-workflow']
parallel_with:
  [
    'batch-007-stock-market-query-tools',
    'batch-009-deterministic-quant-tools',
    'batch-010-web-search-and-citations',
    'batch-015-frontend-stream-client-and-contracts',
    'batch-016-frontend-chat-shell',
  ]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 008：财务、指标与个股资金流 Tool

## 1. 批次目标

注册 `get_financial_statements`、`get_financial_indicators`、`get_stock_moneyflow`，确保报告期、公告可用时点、累计/单季口径和资金单位明确。

## 2. 业务价值

为盈利质量、资产负债、现金流和资金行为研究提供真实数据，避免模型凭记忆计算财务比率或产生前视偏差。

## 3. 前置依赖

- Batch 000 数据/migration 门禁。
- Batch 006 Tool 基础。

## 4. 执行范围

- 新增 FinancialToolFacade/MoneyflowToolFacade。
- 实现三表统一输出、指标 allowlist、announcement availableAt 过滤和资金流结果。
- 增加财报时点、字段单位、缺失和重复版本测试。

## 5. 不在本批次范围内

- 不自行生成投资结论。
- 不支持模型传任意财务字段/Prisma select。
- 不含外部公告全文；Batch 010 负责。

## 6. 涉及的现有文件

- `src/apps/stock/stock.service.ts`、`stock-detail.service.ts`
- `src/apps/stock/stock.module.ts`
- `prisma/tushare/financial/*.prisma`（以仓库真实目录为准）
- `FinaIndicator`、`Income`、`BalanceSheet`、`Cashflow`、`Moneyflow` 等真实 Prisma Models

## 7. 需要新增的文件

- `src/apps/stock/financial-tool.facade.ts`
- `src/apps/stock/moneyflow-tool.facade.ts`
- `src/apps/agent/tools/adapters/financial-tools.ts`
- `src/apps/agent/tools/adapters/test/financial-tools.spec.ts`

## 8. 需要修改的文件

- `src/apps/stock/stock.module.ts` 仅 export 新 Facade
- `src/apps/agent/agent.module.ts` 注册三个 definitions

## 9. 数据库变更

不新增表。按 tsCode+endDate/annDate 查询现有财务表，验证复合索引；资金流按 tsCode+tradeDate。若计划不理想，只在数据库索引文档确认后单独 migration，禁止本批次临时建重复索引。

## 10. API 变更

不新增 REST；输入 schema 使用 internal-data-tools 文档。

## 11. 后端实现任务

- 财报查询区分 reportPeriod、annDate/availableAt、reportType、累计值/单季派生。
- 指标名称 server allowlist 映射真实列，返回 original field 与 unit。
- 资金流分单口径、净流入符号和币种固定；数据日期范围最大 250。
- 重复修订财报按明确版本优先级选择并保留 revision warning。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

- 三 Tool 均 READ/idempotent；statements 最大 12 期、indicators 20 期/30 指标、moneyflow 250 日。
- 结论事实包引用具体报告期/公告日/Tool call。

## 14. 详细执行步骤

- 从 Prisma model 与现有 Service 建字段/单位 allowlist。
- 抽 Facade 并实现 availableAt 过滤、修订选择、稳定排序。
- 实现 adapters 与 output schema，统一 Decimal→number/string 精度策略。
- 建立手工核验股票的三表/指标/资金 fixture。
- 测试报告期早于公告日的历史查询不可见，检查 explain。

## 15. 核心数据结构

- `FinancialStatementPeriod { reportPeriod, announcementDate, availableAt, reportType, values }`。
- `FinancialIndicatorPeriod` 与 `MoneyflowDay` 均保留 null/单位；不将 null 转 0。

## 16. 关键接口定义

- `FinancialToolFacade.getStatements(command)`
- `FinancialToolFacade.getIndicators(command)`
- `MoneyflowToolFacade.getDaily(command)`

## 17. 配置和环境变量

- `AGENT_TOOL_FINANCIAL_MAX_PERIODS=20`、`AGENT_TOOL_MONEYFLOW_MAX_DAYS=250`。

## 18. 异常和边缘场景

- 财报更正、多种 reportType、上市前/退市后、announcement 缺失、季度累计转单季、负净资产、单位万/元、资金数据晚于行情。

## 19. 安全要求

- 固定字段 allowlist 和最大跨度；不返回不需要的原始字段。
- Tool 不开放财务同步/修复管理功能。

## 20. 日志和可观测性要求

- 按 Tool/statementType 记录 rows/duration/dataLag/missingRatio/revisionCount。
- 发现公告日在报告期前、重复优先级无法判定时 DATA_QUALITY 告警。

## 21. 测试要求

- 公告可用日/修订/累计与单季/Decimal/单位 golden tests。
- 未知指标、过多指标、过长窗口、无数据和 schema invalid。
- 财务/资金现有模块回归测试。

## 22. 执行命令

- `pnpm test -- src/apps/agent/tools/adapters/test/financial-tools.spec.ts`
- `pnpm test -- src/apps/stock/test`
- `pnpm run build`

## 23. 验收标准

- 历史 asOf 查询不会读取未来公告；三表和指标口径在输出中自描述。
- 三 Tool 的来源 model、报告期/公告日/抓取时点完整。
- 真实 fixture 与数据库核验值一致。

## 24. 完成定义

- [x] `FinancialToolFacade`、`MoneyflowToolFacade` 与三个 strict Tool definitions 已完成；adapter 不直接注入 Prisma 或调用内部 HTTP。
- [x] 三表按 `fAnnDate ?? annDate` 做历史可得日过滤，同报告期按 updateFlag/可得日/同步时间/ID 稳定选版并返回 revision warning。
- [x] 利润表和现金流对可加流量字段派生单季值；资产负债表保持 `POINT_IN_TIME`；null 不转 0。
- [x] 30 个财务指标 allowlist 返回 canonical/source field/unit；FinaIndicator 历史修订能力缺口显式告警。
- [x] Moneyflow 日期范围下推，保留官方 `net_mf_amount`，可选四档买卖，最大 250 日且结果升序有界。
- [x] 实现提交：`2d81ed1 feat(agent): add financial and moneyflow query tools`。
- [x] 专项 21/21、Batch 006 27/27、Batch 007 26/26、Stock 227/227、production build、legacy ESLint、contracts 与格式门禁通过。
- [x] Income/Indicator/Moneyflow EXPLAIN 分别为 0.395ms/1.408ms/0.456ms，全部命中索引；20 Run 真实 DB LOAD 错误率 0。
- [x] 新 app 容器 `Found 0 errors`，App/PostgreSQL/Redis healthy，`/health` 与 `/ready` 均为 ok。
- [x] Tool inventory、[测试方案](../../../design/Agent财务与个股资金流工具测试方案-20260719.md)、[执行报告](../../../Agent财务与个股资金流工具测试执行报告-20260720.md)与 `docs/README.md` 已同步。

## 25. 回滚方案

从 Registry 注销三 Tool；Facade 无副作用，DB 不变。

## 26. 后续批次

- Batch 011 组合财务与行情事实。
- Batch 017 渲染财务指标块。
