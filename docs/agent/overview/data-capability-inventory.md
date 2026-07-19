# 数据能力盘点

## 1. 盘点口径

基线：2026-07-19。盘点覆盖当前 111 个 Prisma Model、对应运行表、Tushare 同步 plan、主要查询 Service 和运行库只读统计。

- “精确”表示执行过 `COUNT/MIN/MAX`。
- “估算”表示使用 `pg_class.reltuples`；当前统计信息有明显陈旧，不能用于账务或验收。
- Tushare 来源频率表示当前代码 schedule，不保证上游数据完整。
- canonical Tool 以[Tool 方案](../tools/README.md)为准；标“暂不开放”表示数据或语义门禁未关闭。

运行库总览：41 GB、111 张业务表、332 个索引、22 个外键、0 张分区表。完整结构风险见[现有 Schema 分析](../database/existing-schema-analysis.md)。

## 2. 核心公开金融数据

| 能力/Model/表 | 主要字段与粒度 | PK/股票键/日期 | 来源与当前频率 | 实库量级 | 索引/关联 | 主要风险 | 可支持 canonical Tool |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 证券主数据 `StockBasic` / `stock_basic_profiles` | tsCode、symbol、name、industry、market、exchange、listStatus、listDate、delistDate；每证券一行 | PK `tsCode`；有效期由 list/delist date 表达 | Tushare `stock_basic`；每日 08:10 | 精确 5,866 | symbol/name/exchange/industry/status 多列索引；金融表无 FK | 3 个 Daily 代码无主数据；历史查询不能只看当前 listStatus | `resolve_security`、`get_stock_overview` |
| 公司资料 `StockCompany` / `stock_company_profiles` | 法人、注册资本、城市、员工、主营、简介 | PK `tsCode`；annDate | Tushare `stock_company`；周一 08:20 | 小表；本轮未执行精确 COUNT，非容量基线 | tsCode 主键 | syncedAt 新鲜度检查受无时区 timestamp 影响 | `get_stock_overview` |
| 交易日历 `TradeCal` / `exchange_trade_calendars` | exchange、calDate、isOpen、pretradeDate | PK `(exchange,calDate)` | Tushare `trade_cal`；周一 08:15 | 覆盖交易历史；本轮未执行精确 COUNT，非容量基线 | calDate/isOpen 查询 | 所有 as-of 和 scheduler 必须复用；不能用工作日替代 | 全部金融 Tool 的 snapshot resolver |
| 日线 `Daily` / `stock_daily_prices` | OHLC、preClose、change、pctChg、vol、amount | PK `(tsCode,tradeDate)`；tradeDate `date` | Tushare `daily`；交易日 18:30 | 精确 18,002,711；1990-12-19~2026-07-17 | tsCode+date、date 索引；无 StockBasic FK | amount 千元、vol 手；空响应删除；3 个孤儿代码 | `get_stock_price_history`、`get_stock_overview`、`get_market_snapshot`、`compute_performance_metrics` |
| 周/月线 `Weekly`/`Monthly` | 同 Daily 粒度变为周/月 | PK `(tsCode,tradeDate)` | `weekly` 周五 18:40；`monthly` 每月任务 | Weekly 约 3.7m 估算；Monthly 范围 1990-12-31~2026-06-30 | 复合 PK 与 date 索引 | pctChg 存比例，Daily 存百分数，100 倍错配；修复前禁跨周期计算 | 修复后 `get_stock_price_history` |
| 每日指标 `DailyBasic` / `stock_daily_valuation_metrics` | turnover、volumeRatio、PE/PB/PS、股本、市值 | PK `(tsCode,tradeDate)` | `daily_basic`；交易日 18:35 | 精确 17,912,325；1990-12-19~2026-07-17 | tsCode+date、date 及估值查询索引 | 股本万股、市值万元；历史行业中位数用当前行业/上市状态 | `get_stock_overview`、`compute_valuation_percentile`、`get_market_snapshot`；`get_financial_indicators` 只读 `FinaIndicator` |
| 复权因子 `AdjFactor` / `stock_adjustment_factors` | adjFactor | PK `(tsCode,tradeDate)` | `adj_factor`；交易日 18:45 | 精确 18,824,105 | 复合 PK、date 索引 | 图表 QFQ 公式反向；回测查询无稳定 orderBy | `get_stock_price_history` |
| 技术因子 `StkFactor` / `stock_technical_factors` | MA、MACD、KDJ、RSI、BOLL、复权行情等 | PK `(tsCode,tradeDate)` | `stk_factor`；交易日 19:40 | 精确 18,152,124；缺 22 个完整交易日 | 5.6 GB；复合 PK/date 索引 | 无 syncedAt；状态总览未覆盖；单位需逐字段 catalog | `get_stock_overview`；后续技术分析 Tool |
| 涨跌停/停牌 `StkLimit`/`SuspendD` | upLimit/downLimit；停复牌类型和原因 | PK `(tsCode,tradeDate)`；日期为 String | `stk_limit` 19:30、`suspend_d` 19:35 | StkLimit 估算 17.3m；Suspend 本轮未执行精确 COUNT | tsCode+date | String date；质量 suspendAware 逻辑错误 | 回测约束，非独立 MVP Tool |
| 指数日线 `IndexDaily` / `index_daily_prices` | 指数 OHLCV | PK `(tsCode,tradeDate)` | `index_daily`；交易日 18:55 | 精确 10,399；2024-04-10~2026-07-17 | 复合 PK/date | 代码强制只补近 2 年，不是全历史 | `get_market_snapshot`、`get_stock_price_history` 的 benchmark |
| 指数权重 `IndexWeight` / `index_constituent_weights` | indexCode、conCode、tradeDate、weight | PK `(indexCode,conCode,tradeDate)`；日期 String | `index_weight`；每月 1 日 | 精确 151,747 | index+date、conCode 索引 | 月频快照；历史 universe 必须取不晚于 asOf 的最新快照 | `get_sector_membership`、`get_backtest_result` |
| THS/申万成分 `ThsMember`、`IndexMemberAll` | board/index、constituent、inDate/outDate | 各自复合键；股票键 conCode/tsCode | THS 周日；申万周一 06:30 | 本轮未执行精确 COUNT，非容量基线 | ThsMember 对 board 有 FK；股票无 FK | THS 缺生效起止，仅 isNew/syncedAt；历史概念归属不可精确 | `get_sector_membership` |
| 筹码 `CyqPerf` / `cyq_perf` | 获利比例、成本分位、集中度 | PK `(tsCode,tradeDate)` | `cyq_perf`；交易日 20:00 | 精确 9,426,608；2018-01-02 起 | 2.09 GB；复合 PK/date | migration 缺 CREATE；状态/质量未覆盖 | 后续筹码分析 Tool |
| 筹码分布 `CyqChips` / `cyq_chips` | 每股票/日期/价格档位占比 | PK `(tsCode,tradeDate,price)` | `cyq_chips`；周五 20:30，bootstrap/full 关闭 | 精确 27,985,453；仅 53 日期 | 4.25 GB | Float price 进 PK；失败仍记 SUCCESS；无完整历史 | 后续筹码分析 Tool，MVP 不开放 |

## 3. 财务、股东与事件数据

| Model/表 | 主要字段与粒度 | PK/日期 | 来源/频率 | 精确量级 | 查询能力 | 质量门禁 |
| --- | --- | --- | --- | ---: | --- | --- |
| `Income` / `income_statement_reports` | 收入、成本、利润、EPS；一个公告版本一行 | 自增 id；endDate、annDate、fAnnDate、reportType、updateFlag | Tushare `income`；周六 22:10 | 322,666；2012Q1~2026Q2 | `get_financial_statements` | 无自然 unique；69,386 个多版本组；必须按 availableAt 选版 |
| `BalanceSheet` / `balance_sheet_reports` | 资产、负债、权益、股本 | 自增 id；同上 | `balancesheet`；周六 22:15 | 349,990 | `get_financial_statements` | 102,026 个多版本组；金额 Float |
| `Cashflow` / `cashflow_reports` | 经营/投资/融资现金流 | 自增 id；同上 | `cashflow`；周六 22:20 | 333,160 | `get_financial_statements` | 80,963 个多版本组；累计/单季语义需显式 |
| `FinaIndicator` / `financial_indicator_snapshots` | EPS、ROE、ROA、利润率、增长、现金流指标 | PK `(tsCode,endDate)`；annDate | `fina_indicator`；周六 22:25 | 256,924 | `get_financial_indicators` | PK 压缩公告修订；历史可得值不完整 |
| `Express` / `earnings_express_reports` | 快报收入、利润、资产、同比 | PK `(tsCode,endDate,annDate)` | `express`；每日 21:10 | 24,005 | `get_stock_overview` / 后续业绩快报能力；不作为 `get_financial_indicators` 数据源 | 历史 overview 当前错误地总取 latestExpress |
| `Forecast` / `earnings_forecast_reports` | 业绩预告类型、变动区间、原因 | 复合业务键 | `forecast`；每日 20:00 | 7,165 | 后续事件研究 | 实际范围偏近期；需公告日过滤 |
| `Dividend` / `stock_dividend_events` | 送转、税前/税后现金、登记/除权/派息日 | 自增 id；多种事件日 | `dividend`；每日 21:20 | 17,151 | overview/后续事件 Tool | 已确认 16,260 条冗余；full 继续放大；读路径会触发补数写库 |
| `Top10Holders` / `top_ten_shareholder_snapshots` | 报告期股东、持股量/比例 | PK `(tsCode,endDate,holderName)`；annDate | 周六 22:30 | 1,261,514 | overview/股东分析 | annDate 不进键；修订被压缩 |
| `Top10FloatHolders` | 同上，流通股东 | 同上 | 周六 22:35 | 2,094,428 | overview/股东分析 | 状态总览遗漏 |
| `StkHolderNumber` | 股东人数 | PK `(tsCode,endDate)`；annDate | 周六 20:30 | 24,042 | 股东趋势 | holderNum 缺失会被 mapper 写 0；修订压缩 |
| `StkHolderTrade` | 股东增减持 | 事件复合键；annDate | 每日 21:15 | 3,297 | 事件研究 | holderType 缺失默认 P |
| `PledgeStat` | 质押次数、比例、股数 | 复合键 | 周六 21:30 | 2,225,644 | 风险/事件研究 | pledgeCount 缺失默认 0 |
| `ShareFloat` | 解禁计划 | unique 含 nullable holderName；floatDate String | 周一 03:00 | 精确 10,159,691；日期到 2035 | 事件日历 | future max date 不能当 freshness；NULL unique 旁路 |
| `Repurchase` | 回购公告、价格、金额、进度 | unique `(tsCode,annDate)` | 每日 21:35 | 2,839 | 事件研究 | 同公告多阶段是否被覆盖需源返回验证 |
| `FinaAudit`、`FinaMainbz`、`DisclosureDate` | 审计、主营构成、披露计划 | 各自报告期/公告键 | 周六/周一 | 91,521；691,147；33,660 | 财报解释、日历 | 版本键不完整；mapper 有公告日回退 |

Agent 财报 Tool 的选择规则必须是：`announcementAvailableAt <= requestedAsOf`，再按报告期、修订优先级和公告时间选 canonical 版本。`endDate <= asOf` 不足以防前视。

## 4. 资金流、市场、另类、基金、宏观与衍生品

| 数据域 | 真实 Model/表 | 来源与频率 | 实库能力 | 风险 | canonical Tool |
| --- | --- | --- | --- | --- | --- |
| 个股资金流 | `Moneyflow` / `stock_capital_flows` | `moneyflow`；交易日 19:08 | 精确 311,333；60 个交易日 | 空表默认只补 60 日；金额单位万元；部分聚合把 null 当 0 | `get_stock_moneyflow`、`get_market_snapshot` |
| 行业资金流 | `MoneyflowIndDc` / `sector_capital_flows` | 19:10 | 精确 61,060；60 日 | 行业代码/名称版本需固定 | `get_market_snapshot` |
| 市场资金流 | `MoneyflowMktDc` / `market_capital_flows` | 19:15 | 精确 60；60 日 | 只有部署后近期历史 | `get_market_snapshot` |
| 沪深港通 | `MoneyflowHsgt` / `moneyflow_hsgt`、`GgtDaily` / `ggt_daily` | 19:20/19:25 | 精确 364；Ggt 1,060 | Ggt migration 缺 CREATE；港股休市不能按 A 股日历判缺 | `get_market_snapshot` |
| 融资融券 | `MarginDetail` / `margin_detail` | 19:05 | 精确 796,464、185 日 | 初始/full 只取最后 120 个交易日 | overview/后续风险 Tool |
| 龙虎榜/大宗 | `TopList`、`TopInst`、`BlockTrade` | 20:00/20:05/20:10 | TopInst 估算 1.50m | TopList/TopInst 主键未覆盖 reason/side，存在覆盖风险；full 初始仅 5 年 | 后续事件研究 Tool |
| 涨跌停/炸板 | `LimitListD` / `limit_list_d` | 20:15 | 精确 126,767 | migration 缺 CREATE；connected 映射未知值为 false | `get_market_snapshot` 后续扩展 |
| 调研 | `StkSurv` / `stk_surv` | 工作日 19:50 | 本轮未执行精确 COUNT，非容量基线 | `(tsCode,survDate)` 主键无法区分同股同日多场调研，存在覆盖风险 | 后续研究事件 Tool |
| 基金基础/行情/净值 | `FundBasic`、`FundDaily`、`FundNav` | 周一/每日 | FundDaily 约 2.9m；FundNav 约 3.1m 估算 | 跨基金类型和单位需 catalog | 后续基金 Tool |
| 基金持仓/份额/复权 | `FundPortfolio`、`FundShare`、`FundAdj` | 月初/每日晚间 | 精确 2,918,479；1,949,512；2,845,798 | 三表 migration 均缺 CREATE；持仓键不含 annDate | 后续基金/机构持仓 Tool |
| 宏观 | `MacroCpi`、`MacroPpi`、`MacroGdp`、`MacroShibor` | 月度/季度/工作日 | 小表 | Shibor 仅从 2015；宏观发布日期与统计期必须分开 | 后续宏观 Tool |
| 转债 | `CbBasic`、`CbDaily` | 周一/每日 17:45 | 本轮未执行精确 COUNT，非容量基线 | CbDaily full 从 2018，不是完整市场史 | 后续证券行情 Tool |
| 期权 | `OptBasic`、`OptDaily` | 周一/每日 19:00 | OptDaily 估算 18.9m、2015 起 | 4.06 GB；合约生命周期/行权调整语义 | 后续衍生品 Tool |
| 市场全景/THS | `DailyInfo`、`ThsDaily`、`ThsIndex`、`ThsMember` | 工作日/周日 | DailyInfo 130,503；ThsDaily 2,918,521 | DailyInfo/ThsDaily migration 缺 CREATE | `get_market_snapshot`、`get_sector_membership` |

## 5. 用户私有数据与研究产物

| 能力 | Model/表 | 键与关系 | 实库量级 | canonical Tool / 接入规则 |
| --- | --- | --- | ---: | --- |
| 自选股 | `Watchlist`、`WatchlistStock` | FK User→Watchlist→Stock；unique `(userId,name)`、`(watchlistId,tsCode)` | 精确 Watchlist 3 | `get_user_watchlist`；userId 仅由 context 注入 |
| 组合与风险 | `Portfolio`、`PortfolioHolding`、`PortfolioRiskRule`、`RiskViolationLog`、`PortfolioTradeLog` | 组合 cuid；holding unique `(portfolioId,tsCode)`；大部分级联 FK | 精确 Portfolio 1 | `get_portfolio_risk`；必须 owner check；历史 asOf 尚需补 |
| 报告与笔记 | `Report`、`ResearchNote` | FK User；Report RESTRICT、Note CASCADE | 小表 | 后续 `save_research_report` 复用 Report 文件元数据、ResearchNote 编辑能力；写 Tool 需确认 |
| 回测 | `BacktestRun`、NAV、Trade、Position、Rebalance、WalkForward、Comparison | run 及子表复合键；大部分 runId 无 FK | 精确 BacktestRun 7 | `get_backtest_result`、`compute_performance_metrics`；先关闭幸存者/前视偏差 |
| 因子 | `FactorDefinition`、`FactorSnapshot`、`FactorSnapshotSummary` | factor name/date/tsCode；summary unique factor+date | 精确 FactorSnapshot 1,301,709 | 后续因子分析能力；不替代 `FinaIndicator` 或 `DailyBasic` 的 canonical 数据源，来源表达式、PIT 与 universe 必须固定 |
| 事件/热力图 | `EventSignalRule/EventSignal`、`HeatmapSnapshot/Status` | 规则与信号有 FK；snapshot 日期键 | 小/中表 | `get_market_snapshot` 后续扩展；只返回程序计算事实 |
| 策略/信号/订阅 | Screener/Strategy/Draft/Version/TradingSignal/SignalActivation | 多处只有逻辑 ID，无 FK | 小表 | 不是自由写 Tool；固定 Workflow/结构化 API |
| 通知/告警 | Notification、Preference、PriceAlert、Trigger、MarketAnomaly | 部分 User/Watchlist/Portfolio FK | 小表 | 复用站内 Notification；Agent Delivery 另建审计表 |
| 审计/质量 | AuditLog、DataQualityCheck、DataValidationLog、ValuationDailyMedian | append 风格；无保留/分区 | Valuation exact 829,257 | Tool quality warning、dataVersion；现有 AuditLog 不替代 Agent 关键审计 |

## 6. 当前同步计划清单

时区均按 `Asia/Shanghai` 设计。

- Basic 8：STOCK_BASIC 每日 08:10；TRADE_CAL 周一 08:15；STOCK_COMPANY 周一 08:20；INDEX_CLASSIFY 周一 06:00；INDEX_MEMBER_ALL 周一 06:30；CB_BASIC 周一 07:00；THS_INDEX 周日 09:30；THS_MEMBER 周日 10:00。
- Market 13：DAILY 工作日 18:30；WEEKLY 周五 18:40；MONTHLY 每月任务 18:50；DAILY_BASIC 18:35；ADJ_FACTOR 18:45；INDEX_DAILY 18:55；MARGIN_DETAIL 19:05；INDEX_DAILY_BASIC 17:30；CB_DAILY 17:45；DAILY_INFO 18:50；CYQ_PERF 20:00；CYQ_CHIPS 周五 20:30；THS_DAILY 20:10。
- Financial 16：INCOME 22:10、BALANCE_SHEET 22:15、CASHFLOW 22:20、FINA_INDICATOR 22:25、TOP10 22:30/22:35、FINA_AUDIT 22:40、FINA_MAINBZ 22:45（周六）；EXPRESS 21:10、DIVIDEND 21:20、FORECAST 20:00、HOLDER_TRADE 21:15、REPURCHASE 21:35（日频）；其余按周/月。
- Moneyflow 5：MONEYFLOW 19:08、IND 19:10、MKT 19:15、HSGT 19:20、GGT 19:25。
- Factor 6：STK_SURV 19:50、STK_LIMIT 19:30、SUSPEND 19:35、STK_FACTOR 19:40；INDEX_WEIGHT 每月 1 日；HK_HOLD 手工。
- Alternative 5：TOP_LIST 20:00、TOP_INST 20:05、BLOCK 20:10、LIMIT_LIST_D 20:15、SHARE_FLOAT 周一 03:00。
- Fund 6：FUND_BASIC 周一 09:00；FUND_NAV 周一 21:00；FUND_DAILY 18:30；FUND_SHARE 22:00；FUND_PORTFOLIO 每月 1 日 04:00；FUND_ADJ 21:30。
- Macro 4：CPI/PPI 每月 15 日；GDP 季度月 20 日；SHIBOR 工作日 12:00。
- Option 2：OPT_BASIC 周一 09:05；OPT_DAILY 工作日 19:00。

## 7. Tool 上线门禁

| Tool | 当前结论 | 必须先完成 |
| --- | --- | --- |
| `resolve_security` | 可实现 | 上市有效期与退市代码规则；返回歧义候选 |
| `get_stock_price_history` | 日线可接；周/月阻断 | pct 单位回填、QFQ 修复、稳定 AdjFactor 排序、缺口元数据 |
| `get_stock_overview` | 可改造接入 | historical overview 不得混 latestExpress；null/单位规范化 |
| `get_financial_statements` | 阻断 | 公告可得日、修订选版、累计/单季口径、自然键 |
| `get_financial_indicators` | 条件接入 | FinaIndicator PIT 版本缺口必须显式 warning |
| `get_stock_moneyflow` | 条件接入 | 日期范围下推、null 不转 0、60 日历史边界 |
| `get_market_snapshot` | 条件接入 | 各数据源真实截止日、质量门禁、资金流短历史 |
| `get_sector_membership` | 申万可历史化；THS 有限制 | THS 无有效期时返回 DATA_QUALITY warning |
| `get_user_watchlist` | 可接 | owner-scoped Facade、缓存按 user/resource version 隔离 |
| `get_portfolio_risk` | 当前仅最新 | 增加 asOf 历史风险快照，不得忽略输入日期 |
| `get_backtest_result` | 结果查询可接，研究可信度阻断 | 修复股票池、universe、财务 PIT、复权和数据 readiness |
| `compute_performance_metrics` | 程序计算可接 | 输入序列单位和缺口验证 |
| `compute_valuation_percentile` | 条件接入 | 当前行业/上市状态回算的历史偏差需重建或警告 |

## 8. 数据质量和可用性标签

Facade 输出必须给每个数据集附一项：

- `READY`：单位、时点、覆盖、索引已验证。
- `DEGRADED`：可查询，但范围短、修订历史缺失或有明确 warning。
- `BLOCKED`：已确认单位/公式/前视/重复会改变结论。
- `UNKNOWN`：尚未与真实上游返回或查询计划核验。

不得用空数组掩盖上游失败；Tool 同时返回 `dataThrough`、`coverageStart`、`qualityFlags`、`sourceTask` 和 `syncWatermark`。

## 9. 量级说明

精确计数已核验：Daily 18,002,711；DailyBasic 17,912,325；AdjFactor 18,824,105；StkFactor 18,152,124；CyqChips 27,985,453；CyqPerf 9,426,608；Income 322,666；Balance 349,990；Cashflow 333,160；FinaIndicator 256,924；FundPortfolio 2,918,479；FundShare 1,949,512；FundAdj 2,845,798；ThsDaily 2,918,521；DailyInfo 130,503；GgtDaily 1,060。

OptDaily、ShareFloat、StkLimit 等大表数字采用 `pg_class` 估算；上线索引和容量验收前必须重新 `ANALYZE` 并做精确或采样核验。

## 10. 查询能力的时点规则

1. 行情：`tradeDate <= resolvedTradeDate`。
2. 财报：`announcementAvailableAt <= requestedAsOf`，报告期只是经济归属期。
3. 指数/行业成分：取不晚于 asOf 的最近有效快照，并应用 inDate/outDate。
4. 复权：返回 adjustment，基准因子截止日进入 dataVersion。
5. 资金流：返回真实 coverageStart，不能把 60 日数据描述成全历史。
6. 同一回答若多个来源截止日不同，分别显示，不静默取最晚或最早。
7. `syncedAt` 只表示入库时间，不替代交易日、公告日或生效日。

## 11. 111 个 Model 完整映射

### 11.1 用户、组合、研究、策略与质量：43

| Schema 文件 | Model → 表 |
| --- | --- |
| `prisma/user.prisma` | `User` → `users` |
| `prisma/watchlist.prisma` | `Watchlist` → `watchlists`；`WatchlistStock` → `watchlist_stocks` |
| `prisma/portfolio/portfolio.prisma` | `Portfolio` → `portfolios`；`PortfolioHolding` → `portfolio_holdings`；`PortfolioRiskRule` → `portfolio_risk_rules`；`RiskViolationLog` → `risk_violation_logs` |
| `prisma/portfolio/portfolio_trade_log.prisma` | `PortfolioTradeLog` → `portfolio_trade_log` |
| `prisma/portfolio/report.prisma` | `Report` → `reports` |
| `prisma/alert.prisma` | `PriceAlertRule` → `price_alert_rules`；`PriceAlertTriggerHistory` → `price_alert_trigger_history`；`MarketAnomaly` → `market_anomalies` |
| `prisma/notification.prisma` | `Notification` → `notifications`；`NotificationPreference` → `notification_preferences` |
| `prisma/audit_log.prisma` | `AuditLog` → `audit_logs` |
| `prisma/quality/data_quality.prisma` | `DataQualityCheck` → `data_quality_checks`；`DataValidationLog` → `data_validation_logs` |
| `prisma/quality/valuation_daily_median.prisma` | `ValuationDailyMedian` → `valuation_daily_medians` |
| `prisma/research/backtest.prisma` | `BacktestRun` → `backtest_runs`；`BacktestDailyNav` → `backtest_daily_navs`；`BacktestTrade` → `backtest_trades`；`BacktestPositionSnapshot` → `backtest_position_snapshots`；`BacktestRebalanceLog` → `backtest_rebalance_logs`；`BacktestWalkForwardRun` → `backtest_walk_forward_runs`；`BacktestWalkForwardWindow` → `backtest_walk_forward_windows`；`BacktestComparisonGroup` → `backtest_comparison_groups` |
| `prisma/research/event_signal.prisma` | `EventSignalRule` → `event_signal_rules`；`EventSignal` → `event_signals` |
| `prisma/research/factor.prisma` | `FactorDefinition` → `factor_definitions` |
| `prisma/research/factor_snapshot.prisma` | `FactorSnapshot` → `factor_snapshots`；`FactorSnapshotSummary` → `factor_snapshot_summaries` |
| `prisma/research/heatmap_snapshot.prisma` | `HeatmapSnapshot` → `heatmap_snapshots`；`HeatmapSnapshotStatus` → `heatmap_snapshot_statuses` |
| `prisma/research/param_sweep.prisma` | `ParamSweep` → `param_sweeps` |
| `prisma/research/research_note.prisma` | `ResearchNote` → `research_notes` |
| `prisma/strategy/screener_strategy.prisma` | `ScreenerStrategy` → `screener_strategies` |
| `prisma/strategy/screener_subscription.prisma` | `ScreenerSubscription` → `screener_subscriptions`；`ScreenerSubscriptionLog` → `screener_subscription_logs` |
| `prisma/strategy/strategy.prisma` | `Strategy` → `strategies` |
| `prisma/strategy/strategy_draft.prisma` | `StrategyDraft` → `strategy_drafts` |
| `prisma/strategy/strategy_version.prisma` | `StrategyVersion` → `strategy_versions` |
| `prisma/strategy/trading_signal.prisma` | `TradingSignal` → `trading_signals`；`SignalActivation` → `signal_activations` |

### 11.2 Tushare 基础设施：3

| Schema 文件 | Model → 表 |
| --- | --- |
| `prisma/tushare/_infra/tushare_sync_infra.prisma` | `TushareSyncProgress` → `tushare_sync_progress`；`TushareSyncRetryQueue` → `tushare_sync_retry_queue` |
| `prisma/tushare/_infra/tushare_sync_log.prisma` | `TushareSyncLog` → `tushare_sync_logs` |

### 11.3 Tushare 数据：65

| Schema 文件 | Model → 表 |
| --- | --- |
| `prisma/tushare/alternative/tushare_block_trade.prisma` | `BlockTrade` → `block_trade_daily` |
| `prisma/tushare/alternative/tushare_cyq_chips.prisma` | `CyqChips` → `cyq_chips` |
| `prisma/tushare/alternative/tushare_cyq_perf.prisma` | `CyqPerf` → `cyq_perf` |
| `prisma/tushare/alternative/tushare_limit_list_d.prisma` | `LimitListD` → `limit_list_d` |
| `prisma/tushare/alternative/tushare_pledge_stat.prisma` | `PledgeStat` → `stock_pledge_statistics` |
| `prisma/tushare/alternative/tushare_share_float.prisma` | `ShareFloat` → `share_float_schedule` |
| `prisma/tushare/alternative/tushare_stk_surv.prisma` | `StkSurv` → `stk_surv` |
| `prisma/tushare/alternative/tushare_top_inst.prisma` | `TopInst` → `top_inst_details` |
| `prisma/tushare/alternative/tushare_top_list.prisma` | `TopList` → `top_list_daily` |
| `prisma/tushare/basic/tushare_disclosure_date.prisma` | `DisclosureDate` → `financial_disclosure_schedules` |
| `prisma/tushare/basic/tushare_stk_holdernumber.prisma` | `StkHolderNumber` → `stock_holder_number` |
| `prisma/tushare/basic/tushare_stk_holdertrade.prisma` | `StkHolderTrade` → `stock_holder_trades` |
| `prisma/tushare/basic/tushare_stk_limit.prisma` | `StkLimit` → `stock_limit_prices` |
| `prisma/tushare/basic/tushare_stock_basic.prisma` | `StockBasic` → `stock_basic_profiles` |
| `prisma/tushare/basic/tushare_stock_company.prisma` | `StockCompany` → `stock_company_profiles` |
| `prisma/tushare/basic/tushare_suspend.prisma` | `SuspendD` → `stock_suspend_events` |
| `prisma/tushare/basic/tushare_top10_holders.prisma` | `Top10Holders` → `top_ten_shareholder_snapshots`；`Top10FloatHolders` → `top_ten_float_shareholder_snapshots` |
| `prisma/tushare/basic/tushare_trade_cal.prisma` | `TradeCal` → `exchange_trade_calendars` |
| `prisma/tushare/bond/tushare_cb_basic.prisma` | `CbBasic` → `convertible_bond_basic` |
| `prisma/tushare/bond/tushare_cb_daily.prisma` | `CbDaily` → `convertible_bond_daily_prices` |
| `prisma/tushare/financial/tushare_balance_sheet.prisma` | `BalanceSheet` → `balance_sheet_reports` |
| `prisma/tushare/financial/tushare_cashflow.prisma` | `Cashflow` → `cashflow_reports` |
| `prisma/tushare/financial/tushare_dividend.prisma` | `Dividend` → `stock_dividend_events` |
| `prisma/tushare/financial/tushare_express.prisma` | `Express` → `earnings_express_reports` |
| `prisma/tushare/financial/tushare_fina_audit.prisma` | `FinaAudit` → `financial_audit_opinions` |
| `prisma/tushare/financial/tushare_fina_indicator.prisma` | `FinaIndicator` → `financial_indicator_snapshots` |
| `prisma/tushare/financial/tushare_fina_mainbz.prisma` | `FinaMainbz` → `financial_main_business` |
| `prisma/tushare/financial/tushare_forecast.prisma` | `Forecast` → `earnings_forecast_reports` |
| `prisma/tushare/financial/tushare_income.prisma` | `Income` → `income_statement_reports` |
| `prisma/tushare/financial/tushare_repurchase.prisma` | `Repurchase` → `stock_repurchase` |
| `prisma/tushare/fund/tushare_fund_adj.prisma` | `FundAdj` → `fund_adj` |
| `prisma/tushare/fund/tushare_fund_basic.prisma` | `FundBasic` → `fund_basic` |
| `prisma/tushare/fund/tushare_fund_daily.prisma` | `FundDaily` → `fund_daily` |
| `prisma/tushare/fund/tushare_fund_nav.prisma` | `FundNav` → `fund_nav` |
| `prisma/tushare/fund/tushare_fund_portfolio.prisma` | `FundPortfolio` → `fund_portfolio` |
| `prisma/tushare/fund/tushare_fund_share.prisma` | `FundShare` → `fund_share` |
| `prisma/tushare/index/tushare_index_classify.prisma` | `IndexClassify` → `sw_industry_classification` |
| `prisma/tushare/index/tushare_index_daily.prisma` | `IndexDaily` → `index_daily_prices` |
| `prisma/tushare/index/tushare_index_dailybasic.prisma` | `IndexDailyBasic` → `index_daily_valuation_metrics` |
| `prisma/tushare/index/tushare_index_member_all.prisma` | `IndexMemberAll` → `sw_industry_members` |
| `prisma/tushare/index/tushare_index_weight.prisma` | `IndexWeight` → `index_constituent_weights` |
| `prisma/tushare/index/tushare_ths_daily.prisma` | `ThsDaily` → `ths_daily` |
| `prisma/tushare/index/tushare_ths_index.prisma` | `ThsIndex` → `ths_index_boards` |
| `prisma/tushare/index/tushare_ths_member.prisma` | `ThsMember` → `ths_index_members` |
| `prisma/tushare/macro/tushare_macro.prisma` | `MacroCpi` → `macro_cpi`；`MacroPpi` → `macro_ppi`；`MacroGdp` → `macro_gdp`；`MacroShibor` → `macro_shibor` |
| `prisma/tushare/market/tushare_adj_factor.prisma` | `AdjFactor` → `stock_adjustment_factors` |
| `prisma/tushare/market/tushare_daily.prisma` | `Daily` → `stock_daily_prices` |
| `prisma/tushare/market/tushare_daily_basic.prisma` | `DailyBasic` → `stock_daily_valuation_metrics` |
| `prisma/tushare/market/tushare_daily_info.prisma` | `DailyInfo` → `daily_info` |
| `prisma/tushare/market/tushare_monthly.prisma` | `Monthly` → `stock_monthly_prices` |
| `prisma/tushare/market/tushare_stk_factor.prisma` | `StkFactor` → `stock_technical_factors` |
| `prisma/tushare/market/tushare_weekly.prisma` | `Weekly` → `stock_weekly_prices` |
| `prisma/tushare/moneyflow/tushare_ggt_daily.prisma` | `GgtDaily` → `ggt_daily` |
| `prisma/tushare/moneyflow/tushare_hk_hold.prisma` | `HkHold` → `hk_hold_detail` |
| `prisma/tushare/moneyflow/tushare_margin.prisma` | `MarginDetail` → `margin_detail` |
| `prisma/tushare/moneyflow/tushare_moneyflow.prisma` | `Moneyflow` → `stock_capital_flows` |
| `prisma/tushare/moneyflow/tushare_moneyflow_hsgt.prisma` | `MoneyflowHsgt` → `moneyflow_hsgt` |
| `prisma/tushare/moneyflow/tushare_moneyflow_ind_dc.prisma` | `MoneyflowIndDc` → `sector_capital_flows` |
| `prisma/tushare/moneyflow/tushare_moneyflow_mkt_dc.prisma` | `MoneyflowMktDc` → `market_capital_flows` |
| `prisma/tushare/options/tushare_opt_basic.prisma` | `OptBasic` → `opt_basic` |
| `prisma/tushare/options/tushare_opt_daily.prisma` | `OptDaily` → `opt_daily` |

合计：43 + 3 + 65 = 111。

## 12. 未确认项

- 未调用在线 Tushare API，因此部分自然键碰撞只能按 schema 推断。
- 未对全部 111 张表做精确 COUNT；大表精确计数只覆盖关键能力。
- 未在空库实际执行 migration；缺 CREATE 和提前 INSERT 已静态确定。
- 未执行生产并发、缓存命中率或全量查询压测。
