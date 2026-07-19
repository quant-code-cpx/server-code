# Tool 清单与真实复用来源

## 1. MVP Tool

| Tool key | 分类 | 真实复用服务 | 主要真实数据 | 权限/限制 | 典型输出 |
| --- | --- | --- | --- | --- | --- |
| `resolve_security` | 数据查询 | `src/apps/stock/stock.service.ts` | `StockBasic` / `stock_basic_profiles` | 登录用户；最多 20 候选 | tsCode、名称、交易所、上市状态 |
| `get_stock_price_history` | 数据查询 | `StockService.getDetailChart` 的只读 Facade | `Daily` / `stock_daily_prices` | 最大 5,000 bars；必须声明复权/周期 | OHLCV、dataAsOf、缺口 |
| `get_stock_overview` | 数据查询 | `StockService.getDetailOverview` | 股票基础、行情、估值及关联表 | 最大 20 标的 | 证券概览和最新数据日期 |
| `get_financial_statements` | 数据查询 | `StockFinancialService.getDetailFinancialStatements` | `Income`、`BalanceSheet`、`Cashflow` | 最大 12 报告期；按公告可用时点 | 三表规范化行、报告期/公告日 |
| `get_financial_indicators` | 数据查询 | `StockFinancialService` 的只读 Facade | `FinaIndicator` / `financial_indicator_snapshots` | 最大 20 期 | ROE、利润率、周转、增长等 |
| `get_stock_moneyflow` | 数据查询 | `StockMoneyFlowService.getDetailMoneyFlow`/`getDetailMainMoneyFlow` | `Moneyflow` / `stock_capital_flows` | 最大 250 交易日 | 分单资金流、净流入、时点 |
| `get_market_snapshot` | 数据查询 | `src/apps/market/market.service.ts` | 指数、市场广度、估值、情绪、资金流 | `sections` 白名单 | 市场截面、data dates |
| `get_sector_membership` | 数据查询 | stock/industry/index Facade | 行业、概念、指数成分关联表 | 最大 500 成分 | 层级、成员、有效日期 |
| `get_user_watchlist` | 用户数据 | `src/apps/watchlist/watchlist.service.ts` | `Watchlist`、`WatchlistStock` | userId 强制注入；只读 | 自选组及证券 ID |
| `get_portfolio_risk` | 用户数据/计算 | `PortfolioService`、`PortfolioRiskService` | `Portfolio`、持仓、风险快照 | 资源所有权；只读 | 暴露、集中度、beta、告警 |
| `get_backtest_result` | 用户数据/计算 | `src/apps/backtest/services/` | backtest run/trade/equity/metrics models | 资源所有权；只取终态或可见进度；强制口径风险标记 | 配置、指标、净值、交易摘要 |
| `compute_performance_metrics` | 确定性计算 | 回测指标实现抽取为纯函数 | 调用方提供的有界收益/净值序列 | 最多 10,000 点；算法版本固定 | CAGR、波动、Sharpe、回撤等 |
| `compute_valuation_percentile` | 确定性计算 | 新增 Agent quant adapter，复用估值序列 Facade | `DailyBasic` / `stock_daily_valuation_metrics` | 窗口/缺失/异常值策略固定 | 当前值、分位、样本数、窗口 |
| `search_web` | 外部搜索 | 新增 `src/apps/web-search/` provider adapter | 搜索供应商 | 配额、域策略、最多 10 条 | URL token、标题、摘要、时间 |
| `fetch_web_page` | 外部抓取 | 新增受控 fetch service | 仅 `search_web` 签发 URL | SSRF/MIME/大小/超时限制 | 清洗正文、hash、来源元数据 |

> Prisma model 与物理表的完整映射、数据量和索引见 [数据能力盘点](../overview/data-capability-inventory.md)。Tool adapter 优先调用新增 Facade，不直接依赖 Controller 或 Prisma。

## 2. 第一后续阶段

| Tool/能力 | 处理方式 | 原因 |
| --- | --- | --- |
| `save_research_report` | 受控写 Tool；预览后显式确认，`clientRequestId` 幂等 | 复用 `ReportService`/`ResearchNoteService` 前先完成异步存储和审计 |
| 研究报告生成 | workflow 节点，不让模型自己选文件路径 | 需要模板、引用完整性和产物存储 |
| 创建/修改 schedule | 结构化 REST API | cron、时区、额度、资源归属需表单校验 |
| 通知发送 | workflow/outbox | 防止提示注入触发任意群发和重复送达 |
| 回测提交 | 专用确认 command；非 MVP Tool | 当前取消/幂等语义需先修复，成本较高 |

## 3. 明确禁止

- Tushare 手动同步、质量修复和 retry queue reset。
- 用户、角色、状态和配额管理。
- 自定义因子创建/更新/删除/预计算。
- 任意 SQL、Prisma filter、表名、Redis command。
- 任意 URL、浏览器脚本、shell、Python 用户代码。
- 删除持仓、自选股、策略、报告或文件。
- 交易下单、券商凭据和资金操作。

## 4. Tool—能力覆盖

| 用户问题 | Tool 组合 | 程序步骤 |
| --- | --- | --- |
| “茅台近五年估值贵吗” | resolve → price history → financial indicators → valuation percentile | 对齐交易日、计算分位、生成图表块 |
| “比较两家公司盈利质量” | resolve → statements + indicators（并行） | 按公告可用时点对齐，计算现金利润比等 |
| “今天市场和北向资金如何” | market snapshot | 校验各 section 的 dataAsOf，标记未更新项 |
| “我的组合风险” | portfolio risk + market snapshot | 所有权检查、风险快照、集中度和情景说明 |
| “复盘这个回测” | backtest result + performance metrics | 校验 run 归属与数据/算法版本 |
| “结合最新公告和新闻研究” | 内部 Tool + search + fetch | 来源分级、时间对齐、逐结论引用 |

## 5. 当前数据风险对 Tool 的影响

`get_stock_price_history` 和任何收益计算上线前，必须完成周/月 `pct_chg` 单位修复及回填、前复权公式/排序修复；不满足时只允许用已验证 OHLC 路径计算并返回 `DATA_UNIT_UNVERIFIED` 警告。`get_backtest_result` 必须传播 universe、公告可用日、复权和策略是否应用 universe 的可复现性标记；相关历史结果未验证时返回 `BACKTEST_BIAS_UNVERIFIED`。fresh migration 链验证、Dividend 去重和 retry 真修复也是所有 Agent DB 变更的前置 gate。相关实施见 [Batch 000](../tasks/batches/batch-000-platform-data-readiness.md)。
