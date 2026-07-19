# 现有 Schema 分析

## 1. 核验范围与方法

基线：2026-07-19。

核验对象：

- `prisma.config.ts`、`prisma/base.prisma` 与 `prisma/**/*.prisma`
- `prisma/migrations/*/migration.sql`
- Tushare plan、API、mapper、质量、重试和状态总览实现
- 运行中的 PostgreSQL 结构、索引、外键、迁移历史、精确行数、日期范围和表尺寸

口径：标为“精确”的数字来自只读 `COUNT/MIN/MAX`；标为“估算”的数字来自 `pg_class.reltuples`。当前 `pg_stat_user_tables` 与精确行数偏差明显，不能作为精确容量事实。

## 2. Schema 总览

Prisma 使用 multi-file schema：`prisma.config.ts` 指向 `prisma/`，`prisma/base.prisma` 定义 PostgreSQL datasource 与 `prisma-client-js` generator。

- `.prisma` 文件：88。
- Model：111。
- 运行库普通表：112，含 `_prisma_migrations`，即 111 张 Model 对应表。
- 索引：332，包含 PK/unique/index。
- 外键：22。
- 数据库大小：41 GB。
- 分区表：0。
- 扩展：`plpgsql`、`pg_stat_statements`；没有 `vector`、TimescaleDB。

Model 构成：

- 用户、组合、通知、研究、策略、质量：43。
- Tushare 同步基础设施：3。
- Tushare 数据集：65。

完整逐 Model 映射见[数据能力盘点](../overview/data-capability-inventory.md#11-111-个-model-完整映射)。

## 3. 真实表名边界

Prisma Model 名不能作为原生 SQL 表名。Agent Repository、Facade 和查询评审使用以下 canonical 映射：

| Prisma Model | 实际表 |
| --- | --- |
| `StockBasic` | `stock_basic_profiles` |
| `Daily` | `stock_daily_prices` |
| `DailyBasic` | `stock_daily_valuation_metrics` |
| `AdjFactor` | `stock_adjustment_factors` |
| `Income` | `income_statement_reports` |
| `BalanceSheet` | `balance_sheet_reports` |
| `Cashflow` | `cashflow_reports` |
| `FinaIndicator` | `financial_indicator_snapshots` |
| `Moneyflow` | `stock_capital_flows` |
| `MoneyflowIndDc` | `sector_capital_flows` |
| `MoneyflowMktDc` | `market_capital_flows` |
| `MoneyflowHsgt` | `moneyflow_hsgt` |
| `IndexDaily` | `index_daily_prices` |
| `IndexWeight` | `index_constituent_weights` |

任何动态表名只能来自编译期枚举白名单；模型不能生成表名、列名或 SQL。

## 4. Migration 链不具备可重放性

### 4.1 当前库与当前 schema

从 datasource 到 datamodel 的 Prisma diff 为空，说明当前运行库和当前 schema 一致。这只能证明“当前状态相同”，不能证明迁移链能重建该状态。

迁移目录有 26 个 SQL 文件；`_prisma_migrations` 有 29 行：26 个成功版本，3 个重复尝试后 rolled back。首个 `20260408154559_add_ths_index_member` 实际是约 2182 行全库基线，名称不能表达真实变更范围。

### 4.2 缺少 10 张表的 CREATE

下列当前 Model/表没有任何 migration `CREATE TABLE`：

| Model | 表 | Schema 文件 |
| --- | --- | --- |
| `ValuationDailyMedian` | `valuation_daily_medians` | `prisma/quality/valuation_daily_median.prisma` |
| `CyqChips` | `cyq_chips` | `prisma/tushare/alternative/tushare_cyq_chips.prisma` |
| `CyqPerf` | `cyq_perf` | `prisma/tushare/alternative/tushare_cyq_perf.prisma` |
| `LimitListD` | `limit_list_d` | `prisma/tushare/alternative/tushare_limit_list_d.prisma` |
| `FundAdj` | `fund_adj` | `prisma/tushare/fund/tushare_fund_adj.prisma` |
| `FundPortfolio` | `fund_portfolio` | `prisma/tushare/fund/tushare_fund_portfolio.prisma` |
| `FundShare` | `fund_share` | `prisma/tushare/fund/tushare_fund_share.prisma` |
| `ThsDaily` | `ths_daily` | `prisma/tushare/index/tushare_ths_daily.prisma` |
| `DailyInfo` | `daily_info` | `prisma/tushare/market/tushare_daily_info.prisma` |
| `GgtDaily` | `ggt_daily` | `prisma/tushare/moneyflow/tushare_ggt_daily.prisma` |

`20260426000002_backfill_valuation_daily_medians/migration.sql` 在没有建表的情况下直接 INSERT `valuation_daily_medians`。全新数据库执行到此处会失败；其余 9 个表即使不立即报错，也不会出现。

### 4.3 反向索引漂移

`20260503000003_backtest_run_strategy_id/migration.sql` 创建 `backtest_runs_strategy_id_idx`。当前 schema 没有对应 `@@index`，实库也没有该索引，后续 migration 没有 DROP。说明库结构曾被 `db push` 或手工同步回当前 datamodel。

### 4.4 枚举漂移

- TypeScript `TushareSyncTaskName.VALUATION_MEDIAN` 存在。
- Prisma/实库 `TushareSyncTask` 枚举没有该值，Registry 也没有独立 plan。
- `DATA_QUALITY_CHECK` 在 Prisma/TypeScript enum 中存在，但无实际同步 plan/执行日志。
- `valuation_daily_medians` 实际由 `MarketSyncService.upsertValuationMedians()` 作为 DailyBasic 副作用更新。

## 5. 主键与自然键

### 5.1 行情和时序数据

Daily、DailyBasic、AdjFactor、Weekly、Monthly、StkFactor 等核心时序表通常使用 `(tsCode, tradeDate)` 复合主键，并另建 `tradeDate` 或倒序查询索引。该结构适合单证券区间查询和单日全市场查询，但在 18m–28m 行规模下仍需查询计划验证。

日期类型不统一：

- 多数行情、财务使用 `DateTime @db.Date`。
- StkLimit、SuspendD、IndexWeight、TopList、TopInst、BlockTrade 等使用 `String` 日期。
- 同一业务日连接时需要反复转换；格式和真实日历校验不统一。

### 5.2 财务报表

`Income`、`BalanceSheet`、`Cashflow` 只有自增 BigInt id；没有业务唯一键。`createMany({skipDuplicates:true})` 因此不能防业务重复。

当前运行库按 `tsCode/annDate/fAnnDate/endDate/reportType/compType/endType/updateFlag` 检查，三表没有完全重复。但同一股票、同一报告期、同一 reportType 有大量版本：

- Income：69,386 个多版本组，额外版本 69,626，最多 4 版。
- BalanceSheet：102,026 个组，额外版本 102,383，最多 5 版。
- Cashflow：80,963 个组，额外版本 81,147，最多 4 版。

这些版本不能简单删除；需要以公告可得日和修订状态建 canonical 视图。当前 `StockFinancialService` 仅按 `endDate DESC`，没有稳定选版。

### 5.3 Dividend 已确认重复

`Dividend` 仅有自增 id，没有自然唯一键。实库 17,151 行中：

- 完全相同业务记录组：807。
- 冗余行：16,260。
- 单组最多：84 条。

根因：`FinancialSyncService.fullDividendBuild()` 在非空表上不清空；`skipDuplicates` 没有唯一约束可使用。手工 full 会继续放大。

### 5.4 其他潜在碰撞

- `BlockTrade` 唯一键包含 nullable buyer/seller；PostgreSQL 默认 NULL distinct，仍可重复。
- `ShareFloat` 唯一键包含 nullable holderName，同样有 NULL 旁路。
- `StkSurv` PK `(tsCode,survDate)` 无法区分同股同日多场调研，存在覆盖风险。
- `TopList` PK `(tradeDate,tsCode)` 未含 reason。
- `TopInst` PK `(tradeDate,tsCode,exalter)` 未含 side/reason。
- `FundPortfolio` PK `(tsCode,endDate,symbol)` 未含 annDate，披露修订被覆盖或跳过。
- `FinaIndicator`、`FinaAudit`、`StkHolderNumber`、Top10 holder 表未完整保存公告版本。
- `CyqChips` 用 Float price 参与 PK；来源精度变化会产生新键。

这些风险除 Dividend 外未与实时上游逐行对照，实施修复前需用真实 Tushare 返回验证。

## 6. 外键与租户关系

实库 22 个 FK 主要覆盖 User、Watchlist、Portfolio、Report、Notification、ResearchNote、Strategy、Screener、PriceAlert、EventSignal、WalkForward 和 THS board 关系。

几乎所有金融表的 `tsCode` 都不 FK 到 `StockBasic`。实库验证：

- Daily 有 5868 个 distinct tsCode。
- 3 个无 StockBasic：`000022.SZ`、`000043.SZ`、`300114.SZ`。
- 337 个 Daily 代码当前已非 `listStatus=L`。
- Income 有 7 个代码无 StockBasic。

缺少物理 FK 的重要应用关系：

- `BacktestRun.userId/strategyId`
- Backtest NAV/Trade/Position/Rebalance 的 `runId`
- `StrategyVersion.strategyId`
- `TradingSignal.activationId/strategyId/userId`
- `ScreenerSubscription.strategyId`
- `ScreenerSubscriptionLog.subscriptionId`
- `EventSignalRule.userId`
- `PriceAlertRule.userId`
- `ParamSweep.userId/baseRunId`

当前抽查这些关系没有孤儿行，但数据库不保证未来一致。Agent 新表必须采用强 FK；Repository 仍需显式 `userId` 过滤，FK 不能代替租户 ACL。

## 7. 数据量和历史范围

### 7.1 大表

| 表 | 总尺寸 | 行数口径 |
| --- | ---: | --- |
| `stock_technical_factors` | 5.6 GB | 精确 18,152,124 |
| `stock_daily_valuation_metrics` | 5.0 GB | 精确 17,912,325 |
| `cyq_chips` | 4.25 GB | 精确 27,985,453 |
| `opt_daily` | 4.06 GB | 估算约 18.9m |
| `stock_daily_prices` | 4.03 GB | 精确 18,002,711 |
| `share_float_schedule` | 3.84 GB | 估算约 10.1m |
| `stock_limit_prices` | 2.63 GB | 估算约 17.3m |
| `cyq_perf` | 2.09 GB | 精确 9,426,608 |
| `stock_adjustment_factors` | 2.03 GB | 精确 18,824,105 |

### 7.2 历史范围

- Daily、DailyBasic、AdjFactor：1990-12-19 至 2026-07-17，8684 个交易日。
- StkFactor：同一总体区间，但少 22 个完整交易日。
- Weekly：1990-12-21 至 2026-07-17。
- Monthly：1990-12-31 至 2026-06-30。
- 三大财务表：2012-03-31 至 2026-06-30。
- IndexDaily：2024-04-10 至 2026-07-17；代码强制仅回补近 2 年。
- Moneyflow/行业/市场资金流：2026-04-21 至 2026-07-17，各 60 个交易日。
- CyqChips：2026-04-20 至 2026-07-17，仅 53 个日期。
- HkHold：0 行；代码对 2024-08-20 后直接跳过。
- MarginDetail：2025-10-14 至 2026-07-16，185 个交易日。

最新交易日覆盖较齐：active 股票 5528，Daily/DailyBasic/StkFactor 各 5522，Daily 代码没有缺 DailyBasic、StkFactor、AdjFactor。

## 8. Tushare 同步一致性

### 8.1 执行边界

`TushareSyncRegistryService` 汇总 9 个分类 Service 的 65 个 plan。`TushareSyncService` 先执行 basic，再以默认 3 个分类并发、分类内串行执行；另有动态 cron、每小时 catch-up 和启动 bootstrap。

同步总控仅使用进程内 `running` 布尔锁。多 API/Worker 副本会同时注册 schedule 并执行相同 delete+insert；生产必须增加数据库原子 claim 或 advisory lock，并由运行角色限制 scheduler。

### 8.2 Retry 假成功

`SyncRetryService.processPendingRetries()` 把失败键作为 incremental `targetTradeDate`。`MarketSyncService.syncByTradeDate()` 却从 progress/DB 最新日期加一天开始。旧失败日期若被后续成功日期越过，会直接返回“已是最新”，队列仍标 SUCCEEDED。

实库 240 条 retry 全部 SUCCEEDED，但 WEEKLY `20260706`、`20260622` 与 MONTHLY `20260601` 等目标仍为 0 行。

### 8.3 空响应和部分成功

- `SyncHelperService.replaceTradeDateRows()`、`replaceAllRows()` 在 mapped data 为空时删除旧数据。
- 上游 code=0、items=[] 没有“应有数据集最小行数”保护。
- 多数 Financial、Index、CB、Cyq 等循环捕获分片异常后仍写 SUCCESS。
- Financial full rebuild 可先清空全表，再因部分股票失败只恢复部分数据。
- 当前 10,686 条同步日志全部 SUCCESS，不能当成完整性证明。

### 8.4 历史人为截断

- IndexDaily：近 2 年。
- TopList/TopInst/BlockTrade 初次：近 5 年。
- 三大财务表：主要近 15 年。
- Shibor：从 2015 年。
- Moneyflow 空表默认：近 60 个交易日。
- Margin 初次/full：最后 120 个交易日。
- CyqChips：bootstrap/full 均关闭，仅定期单日。

全量能力允许时应以节流、断点和分批解决，不应把人工窗口伪装为全量。

## 9. 单位、Mapper 和质量

`src/tushare/tushare-sync.mapper.ts` 的主要问题：

- `readDate()` 只检查 8 位数字；`Date.UTC` 会把 20260231 自动归一到 3 月。
- `readInt()` 静默截断。
- 部分缺失值被默认成 0、`P`、`L1`、`Y`，或把 annDate 回退为 endDate。
- 金额大量使用 Float，Decimal 口径不统一。
- String 日期缺统一日历验证。
- `ValidationCollector` 单次最多记录 5000 条，异常统计只是下限。

### 9.1 周/月 pct_chg 100 倍错配

Daily、Weekly、Monthly 共用 `mapOhlcvRecord()`，没有单位归一。

实库按 `(close/preClose-1)*100` 对照：

- Daily 比值约 1.0000。
- Weekly 比值约 0.0100。
- Monthly 比值约 0.0100。

Weekly/Monthly 存小数比例，Daily 存百分数。校验日志已累计 Weekly 72,629、Monthly 20,000 条 mismatch；同步仍继续写入。

### 9.2 质量检查错误

`DataQualityService` 只配置 29/65 个数据集；`SyncStatusOverviewService` 只展示 52/65 个。

状态总览遗漏：`daily_info`、`cyq_perf`、`cyq_chips`、`ths_daily`、`top_ten_float_shareholder_snapshots`、`ggt_daily`、`stock_suspend_events`、`stk_surv`、`stock_technical_factors`、`limit_list_d`、`fund_share`、`fund_portfolio`、`fund_adj`。

逻辑问题：

- `checkTimeliness()` 把 `compareDateString()` 的 -1/0/1 当滞后天数，导致长期陈旧数据也能 pass。
- Daily completeness 只看某日是否有任意一行，不看逐股票覆盖。
- suspendAware 只要某日存在任一停牌，就会排除整日缺失。
- 财务覆盖按行数而非 distinct tsCode，多版本虚增覆盖。
- 财务事件只检查表非空。
- ShareFloat 的未来解禁日可到 2035，MAX 日期不代表新鲜度。
- 周/月 period end 在盘后会把尚未结束的当周/当月纳入，制造假缺口。

## 10. 财务时点和回测偏差

### 10.1 财报查询

`StockFinancialService.getDetailFinancialStatements()`：

- 只按 `endDate DESC`，未按 `annDate/fAnnDate/updateFlag` 选版。
- `take=periods+4` 会被多版本挤占；Income 中已有 59 只股票具备至少 8 个报告期，却只能取到 6–7 个唯一报告期。
- 所有主要财务接口缺统一 `asOfDate/availableAt`。

`StockDetailService.getDetailOverview(tsCode, tradeDate)` 的行情可按历史日，但 `latestExpress` 永远取当前最新，形成混合时点。

### 10.2 回测

- `BacktestDataService.getAllListedStocks()` 使用当前 `listStatus='L'`，历史 ALL_A 排除 337 个现退市证券。
- ALL_A 初始池不会加入后续 IPO。
- 指数刷新只加载新证券，没有从 bars 池移除退出成分。
- `ScreeningRotationStrategy`、`FactorScreeningRotationStrategy` 忽略或没有正确约束 universe。
- `FactorRankingStrategy` 财务因子使用 `endDate <= signalDate`，不是 `annDate <= signalDate`。

实库按当前策略挑选的“最新报告”中，尚未公告比例：2024-10-15 为 95.80%，2025-01-15 为 97.84%，2025-04-15 为 97.00%，2026-01-15 为 91.23%。

### 10.3 复权

`StockDetailService.getDetailChart()` 的 QFQ 使用 `latestAdj/factor`，方向与 Tushare `factor/latestAdj` 相反。`BacktestDataService` 公式正确，但 AdjFactor 查询无 orderBy，之后 `reduceRight()` 假定升序，基准因子不确定。

## 11. 时间口径

- PostgreSQL 会话时区：`Asia/Shanghai`。
- Node 容器：UTC，未设置 `TZ`。
- 交易日期使用 `date` 最安全。
- 现有事件/审计大量是 `timestamp without time zone`，而代码混用 JS Date、dayjs.tz 和 raw SQL `NOW()`，解释存在歧义。

新 Agent schema 的事件、审计、租约、调度、投递时间统一使用 `timestamptz`；市场交易日用 `date`；另存 `marketTimezone='Asia/Shanghai'`。现有时间字段迁移应先做样本对照，不可直接批量加 8 小时。

## 12. 结论

现有库具备丰富金融事实、因子、回测和用户资产，足以支持首期 Agent；阻断点不是“缺数据表”，而是迁移可重放性、单位、公告可得日、历史股票池、自然键、重试验证和质量门禁。Agent 接入必须先建立只读 Facade 和数据语义层，不能把现有 ORM 查询直接包装成 Tool。
