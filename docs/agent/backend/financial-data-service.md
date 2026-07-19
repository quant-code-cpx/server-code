# 金融数据服务边界

## 1. 定位

Agent 不新建一套金融数据库访问层，也不让 Tool 直接注入 `PrismaService`。方案是在现有领域模块内部增加只读 `*ToolFacade`，将当前 Service 的结果规范化为稳定、带来源和时点的应用接口；Tool adapter 只依赖这些 Facade。

完整表、字段、索引、同步频率与实库数据量见[现有数据能力盘点](../overview/data-capability-inventory.md)。本文件只描述后端接线与必须补齐的查询语义。

## 2. 真实能力映射

| 能力          | 当前真实代码                                                                                           | 主要 Prisma Model / 表                                                                                                                 | Agent 接入结论                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 股票解析/搜索 | `src/apps/stock/stock.service.ts` 的 `search/findOne`，下沉至 `StockListService`                       | `StockBasic` / `stock_basic_profiles`                                                                                                  | 新增 `StockToolFacade.resolveSecurity`，统一代码、名称、交易所和上市有效期                |
| 个股概览      | `StockService.getDetailOverview` → `src/apps/stock/stock-detail.service.ts`                            | `StockBasic`、`StockCompany`、`Daily`、`DailyBasic`、`Express`                                                                         | 行情可复用；历史 tradeDate 仍混入当前最新 `Express`，需先修复点时性                       |
| 日/周/月行情  | `StockService.getDetailChart` → `StockDetailService.getDetailChart`                                    | `Daily`/`stock_daily_prices`、`Weekly`/`stock_weekly_prices`、`Monthly`/`stock_monthly_prices`、`AdjFactor`/`stock_adjustment_factors` | 周/月收益单位和 QFQ 公式修复前不得直接开放                                                |
| 财务指标      | `StockService.getDetailFinancials` → `src/apps/stock/stock-financial.service.ts`                       | canonical 只使用 `FinaIndicator` / `financial_indicator_snapshots`；现有 `Express` 仅供概览/快报能力                                    | 当前只取最新报告，需增加 `availableAt` 过滤才能支持历史时点                               |
| 三大报表      | `StockService.getDetailFinancialStatements` → `StockFinancialService`                                  | `Income`/`income_statement_reports`、`BalanceSheet`/`balance_sheet_reports`、`Cashflow`/`cashflow_reports`                             | 可复用字段映射；必须按公告/实际可得日筛选，区分累计/单季                                  |
| 个股资金流    | `StockService.getDetailMoneyFlow/getDetailMainMoneyFlow` → `src/apps/stock/stock-moneyflow.service.ts` | `Moneyflow` / `stock_capital_flows` + `Daily`                                                                                          | 可复用 SQL 逻辑；聚合前先修复 `null ?? 0` 造成的缺失值误判                                |
| 市场快照      | `src/apps/market/market.service.ts`                                                                    | Daily、DailyBasic、市场/行业资金流、北向等真实表                                                                                       | `MarketService` 约 1,800 行且模块未 export；新增薄 `MarketToolFacade`，不导出整个 Service |
| 板块归属      | `StockDetailService.getStockConcepts`、`MarketService.getConceptMembers` 及现有行业/指数模块           | `ThsMember`/`ths_index_members`、`IndexMemberAll`/`sw_industry_members`                                                                | Facade 统一概念、申万行业、指数成分类型与生效日期                                         |
| 自选股        | `src/apps/watchlist/watchlist.service.ts`                                                              | `Watchlist`/`watchlists`、`WatchlistStock`/`watchlist_stocks`                                                                          | 必须从执行上下文注入 userId；模块当前未 export，新增 owner-scoped Facade                  |
| 组合风险      | `src/apps/portfolio/portfolio-risk.service.ts`                                                         | `Portfolio`、`PortfolioHolding` 等                                                                                                     | 已调用 `PortfolioService.assertOwner`；模块只 export `PortfolioService`，需导出新 Facade  |
| 回测结果      | `src/apps/backtest/services/backtest-run.service.ts`                                                   | `BacktestRun`、`BacktestDailyNav`、`BacktestTrade`、`BacktestPositionSnapshot`                                                         | 已有 owner-scoped 查询；由 `BacktestToolFacade` 只读汇总                                  |

## 3. Facade 接口

Facade 输入来自已经通过 Tool Schema 的参数和服务端上下文；以下为内部应用接口，精确 Tool 输入/输出以 [Tool 目录](../tools/README.md)为准。

```ts
interface StockToolFacade {
  resolveSecurity(input: ResolveSecurityQuery): Promise<SecurityResolution>
  getOverview(input: StockOverviewQuery): Promise<ProvenancedResult<StockOverview>>
  getPriceHistory(input: StockPriceHistoryQuery): Promise<ProvenancedResult<PriceSeries>>
  getFinancialStatements(input: FinancialStatementsQuery): Promise<ProvenancedResult<FinancialStatements>>
  getFinancialIndicators(input: FinancialIndicatorsQuery): Promise<ProvenancedResult<FinancialIndicators>>
  getMoneyflow(input: StockMoneyflowQuery): Promise<ProvenancedResult<MoneyflowSeries>>
}

interface UserFinancialToolFacade {
  getWatchlist(userId: number, input: WatchlistQuery): Promise<ProvenancedResult<WatchlistView>>
  getPortfolioRisk(userId: number, input: PortfolioRiskQuery): Promise<ProvenancedResult<PortfolioRiskView>>
  getBacktestResult(userId: number, input: BacktestResultQuery): Promise<ProvenancedResult<BacktestResultView>>
}
```

Facade 只返回领域 DTO，不泄露 Prisma generated type、Decimal/BigInt、数据库列名或 CacheService。所有 ID 在 Tool 边界视为不透明字符串；`userId` 永远不是 Tool 参数。

## 4. 时点与数据版本

每次查询建立一个 `DataSnapshotContext`：

```ts
type DataSnapshotContext = {
  requestedAsOf?: string
  resolvedTradeDate?: string
  availableAt: string
  adjustment?: 'NONE' | 'FORWARD' | 'BACKWARD'
  timezone: 'Asia/Shanghai'
  dataVersion: string
}
```

规则：

1. 自然日先通过交易日历解析到不晚于 `requestedAsOf` 的交易日；禁止用“今天”替代用户截止日。
2. 行情按 `tradeDate <= resolvedTradeDate`；返回真实首尾日期和缺口。
3. 财报同时满足 `endDate` 为报告期，且 `fAnnDate/annDate <= availableAt`；若两者都空，历史时点查询不得使用该记录。
4. 同一回答中的多个 Tool 默认共享 snapshot context；若数据源截止日不同，分别返回并由回答显示，不静默混合。
5. 复权方式是输入和输出必填语义；复权因子版本进入 `dataVersion`。
6. `syncedAt` 表示入库时间，不等于公告日或交易日；三者分别保留。

Facade 必须完成现有 DTO 与 canonical Tool Schema 的适配：Tool 日期是 ISO `YYYY-MM-DD`，进入现有股票 Service 前才转 `YYYYMMDD`；`get_stock_overview` 的最多 20 个代码由 Facade 有界批处理；`get_stock_moneyflow` 的起止日期要下推查询，不能仅把范围换算成当前 `days`；`sections/fields/indicators` 全部用服务端 allowlist 映射。

`PortfolioRiskService.getRiskSnapshot()` 当前只取最新交易日且没有 `asOfDate` 参数，接入 `get_portfolio_risk` 前必须新增历史快照查询，不能接受参数却返回当前风险。`ThsMember` 只有 `isNew/syncedAt`，没有成分生效起止日；概念板块的 historical `effectiveDate` 无法精确回答时返回 `DATA_QUALITY_FAILED` warning，而申万 `IndexMemberAll.inDate/outDate` 可按有效期过滤。

当前 `StockFinancialService.getDetailFinancials/getDetailFinancialStatements` 主要按 `endDate` 取最新记录，没有完整的历史 `availableAt` 过滤；`StockDetailService.getDetailOverview(tsCode, tradeDate)` 的行情按历史日查询，却始终取当前最新 `Express`。因此“历史上当时可知的财务/概览”在新增 as-of query 前不得由 Agent 宣称可用。

## 5. 单位、null 与输出约束

- `Daily.vol` 是手，`Daily.amount` 是千元；`DailyBasic.totalShare/floatShare/freeShare` 是万股，`totalMv/circMv` 是万元。
- Income/BalanceSheet/Cashflow 金额字段按 Schema 注释为元；每股项单独标元/股。
- `Moneyflow` 金额字段是万元。Facade 允许统一换算，但必须返回目标 unit 和原始 source unit。
- Tushare 日线 `pct_chg` 当前是百分数，已发现周/月线是小数比例；Facade 只返回统一 scale，并在修复/回填前拒绝周/月跨周期计算。
- `StockDetailService.getDetailChart()` 当前 QFQ multiplier 使用 `latestAdj / factor`，与正确方向相反；修复与前/后复权黄金样例通过前，`get_stock_price_history` 不得返回标为已验证的 FORWARD 数据。
- 数据库 `null` 不能变成 0。`StockMoneyFlowService` 的若干汇总和 `BacktestRunService.getEquity/getTrades/getPositions` 当前使用 `?? 0`，需在 Agent Facade 接入前按“缺失/真实零值”重构。
- 单次价格序列、财报期数和板块成员数执行 [Tool Schema](../tools/README.md) 的硬上限；Facade 还要设置 SQL timeout 和最大字节数。

## 6. 缓存策略

保留 `src/shared/cache.service.ts`，但 Facade 的 key 必须包含：canonical security ID、真实截止日、period、adjustment、数据版本和输出 schema version。

- 已收盘历史行情/已公告财报可以较长缓存；当前交易日快照短缓存并返回 freshness。
- 自选股、组合、回测 key 必须含 `userId` 与资源 `updatedAt/version`；用户修改时主动失效。
- `StockDetailService.getDetailOverview` 已有缓存，可在 Facade 层复用，不能再套一个遗漏 tradeDate 的宽泛 key。
- 缓存命中仍要记录 Tool provenance 和数据截止日；缓存时间不能冒充数据时间。

## 7. 状态与异常

Facade 本身无长生命周期状态。每次查询状态为 `RESOLVING_SNAPSHOT -> QUERYING -> NORMALIZING -> COMPLETE`，由 ToolCall 审计承载，不创建第二套状态表。

异常映射：

| 情况                       | Tool error                                        | 说明                                    |
| -------------------------- | ------------------------------------------------- | --------------------------------------- |
| 代码歧义/无效日期/范围过大 | `INVALID_ARGUMENT`                                | `resolve_security` 返回候选而非猜测     |
| 无股票/无记录              | `DATA_NOT_FOUND`                                  | 真实无记录与上游失败分开                |
| 数据早于 freshness 要求    | `DATA_NOT_READY` 或 `DATA_STALE`                  | 返回实际 asOf，是否接受由 Workflow 决定 |
| 单位/点时性/完整性未过门禁 | `DATA_QUALITY_FAILED`                             | 不返回可能错误的事实数字                |
| 用户资源不存在或非本人     | `PERMISSION_DENIED` / `DATA_NOT_FOUND` 的安全映射 | 外部响应不泄露资源存在性                |
| SQL/缓存/Tushare 内部异常  | `UPSTREAM_FAILED`                                 | 不向模型暴露 SQL 和表结构               |
| timeout/结果过大           | `TIMEOUT` / `RESULT_TOO_LARGE`                    | 不自动扩大时限或行数                    |

Tool error 到公共 API code 的唯一映射见[错误码](../api/error-codes.md)。

## 8. 只读与副作用边界

- Query Facade 不触发同步、补数、写缓存以外的业务写入或报告生成。
- `StockFinancialService.getDetailDividendFinancing` 在本地无数据时会调用 `FinancialSyncService.syncDividendsForStock()`；该方法不能直接作为 Agent 只读 Tool 后端。需要把“读”和“请求补数”拆开。
- Agent 无权调用 `src/apps/tushare/` 管理端同步；数据未就绪/质量不满足时返回 canonical ToolError，由运维/既有同步计划处理。
- 不允许模型选择表名、字段名或 `Prisma.raw` 内容。`StockDetailService.getDetailChart` 的 table map 必须继续由枚举白名单决定。

## 9. 文件落点

新增：

```text
src/apps/stock/stock-tool.facade.ts
src/apps/market/market-tool.facade.ts
src/apps/watchlist/watchlist-tool.facade.ts
src/apps/portfolio/portfolio-tool.facade.ts
src/apps/backtest/backtest-tool.facade.ts
src/apps/agent/tools/adapters/resolve-security.tool.ts
src/apps/agent/tools/adapters/get-stock-price-history.tool.ts
src/apps/agent/tools/adapters/get-stock-overview.tool.ts
src/apps/agent/tools/adapters/get-financial-statements.tool.ts
src/apps/agent/tools/adapters/get-financial-indicators.tool.ts
src/apps/agent/tools/adapters/get-stock-moneyflow.tool.ts
src/apps/agent/tools/adapters/get-market-snapshot.tool.ts
src/apps/agent/tools/adapters/get-sector-membership.tool.ts
src/apps/agent/tools/adapters/get-user-watchlist.tool.ts
src/apps/agent/tools/adapters/get-portfolio-risk.tool.ts
src/apps/agent/tools/adapters/get-backtest-result.tool.ts
```

修改：

- `src/apps/stock/stock.module.ts`：注册并 export `StockToolFacade`；不额外 export `StockAnalysisService` 等内部实现。
- `src/apps/market/market.module.ts`：注册并 export `MarketToolFacade`。
- `src/apps/watchlist/watchlist.module.ts`：注册并 export `WatchlistToolFacade`。
- `src/apps/portfolio/portfolio.module.ts`：注册并 export `PortfolioToolFacade`。
- `src/apps/backtest/backtest.module.ts`：注册并 export `BacktestToolFacade`。
- 对应 Service：增加 as-of 查询、修复 null/单位和消除查询时同步副作用。

## 10. 测试与验收

```text
src/apps/stock/test/stock-tool.facade.spec.ts
src/apps/market/test/market-tool.facade.spec.ts
src/apps/watchlist/test/watchlist-tool.facade.spec.ts
src/apps/portfolio/test/portfolio-tool.facade.spec.ts
src/apps/backtest/test/backtest-tool.facade.spec.ts
src/apps/agent/test/tools/financial-tools.integration.spec.ts
```

测试必须从业务场景构造，不把现有实现当真值。覆盖股票代码歧义、退市/上市边界、交易日回退、前/后/不复权黄金样例、周/月收益单位、财报公告时点与修订版、累计/单季、null 与 0、金额单位、超长区间、空数据、跨用户资源、缓存失效和千万级表的 `EXPLAIN (ANALYZE, BUFFERS)` 基线。

上线门禁：migration 可从空库重建、周/月 `pct_chg` 完成修复回填、QFQ 公式与排序通过黄金样例、财务/概览按公告可得日过滤、同步 retry/空响应/部分失败语义修复、核心查询索引实测、所有返回带 provenance/asOf/unit，才可让相应 Tool 进入生产 Registry。现有 `Dividend` 已有大量重复，虽不在 MVP 15 Tool 内，也必须在 `save_research_report` 或分红研究扩展前清理并建立真实自然键。
