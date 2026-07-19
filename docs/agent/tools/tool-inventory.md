# Tool 清单与真实复用来源

## 1. MVP Tool

| Tool key                       | 分类          | 真实复用服务                                         | 主要真实数据                                          | 权限/限制                                       | 典型输出                                       |
| ------------------------------ | ------------- | ---------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `resolve_security`             | 数据查询      | `StockToolFacade.resolveSecurity`                    | `StockBasic`、`IndexDaily`、`FundBasic`、`OptBasic`   | 登录用户；最多 20 候选                          | tsCode、名称、类型、交易所、上市状态、歧义标记 |
| `get_stock_price_history`      | 数据查询      | `StockToolFacade.getPriceHistory`                    | `Daily`/`Weekly`/`Monthly`、`AdjFactor`、`DailyBasic` | 最大 5,000 bars；必须声明复权/周期              | 字段白名单行情、单位、复权、dataAsOf、截断     |
| `get_stock_overview`           | 数据查询      | `StockToolFacade.getOverview`                        | `StockBasic`、`Daily`、`DailyBasic`、`IndexMemberAll` | 最大 20 标的；支持历史时点                      | 证券概览、分区和独立数据日期                   |
| `get_financial_statements`     | 数据查询      | `FinancialToolFacade.getStatements`                  | `Income`、`BalanceSheet`、`Cashflow`                  | 最大 12 报告期；公告可得日；稳定修订选版        | 累计/单季/时点值、单位、公告日、revision       |
| `get_financial_indicators`     | 数据查询      | `FinancialToolFacade.getIndicators`                  | `FinaIndicator` / `financial_indicator_snapshots`     | 最大 20 期/30 指标；服务端 allowlist            | canonical/source field、值、单位、PIT warning  |
| `get_stock_moneyflow`          | 数据查询      | `MoneyflowToolFacade.getDaily`                       | `Moneyflow` / `stock_capital_flows`                   | 最大 250 交易日；日期下推；官方净额不重算       | 净流入/净量、可选四档买卖、单位、时点          |
| `get_market_snapshot`          | 数据查询      | `MarketToolFacade.snapshot` → `MarketService`        | 指数、市场广度、估值、情绪、资金流                    | `sections` 白名单；公共短缓存                   | 每 section 独立状态、asOf、facts/rows          |
| `get_sector_membership`        | 数据查询      | `SectorToolFacade.membership`                        | `IndexMemberAll`、`ThsIndex/ThsMember`、`IndexWeight` | 最大 500 成分；历史概念 fail-closed             | 层级、成员、权重、有效日期                     |
| `get_user_watchlist`           | 用户数据      | `WatchlistToolFacade.read`                           | `Watchlist`、`WatchlistStock`、`StockBasic`、`Daily`  | userId 强制注入；只读；不缓存                   | 自选组、名称、备注及可选最新行情               |
| `get_portfolio_risk`           | 用户数据/计算 | `PortfolioToolFacade` → `PortfolioRiskService`       | `Portfolio`、持仓、风险快照                           | userId 所有权；真实数据日；历史持仓能力显式告警 | 暴露、集中度、beta、告警                       |
| `get_backtest_result`          | 用户数据/计算 | `BacktestToolFacade`                                 | backtest run/trade/equity/metrics models              | userId 所有权；最多 2,000 净值点；强制偏差标记  | 配置、指标、净值、交易摘要                     |
| `compute_performance_metrics`  | 确定性计算    | `computePerformanceMetrics`                          | 调用方提供的有界收益/净值序列                         | 最多 10,000 点；`performance-metrics-v1`        | CAGR、波动、Sharpe、回撤、VaR/CVaR             |
| `compute_valuation_percentile` | 确定性计算    | `ValuationToolFacade` → `computeValuationPercentile` | `DailyBasic` / `stock_daily_valuation_metrics`        | 最长十年；至少 60 样本；过滤/缩尾/秩定义固定    | 当前值、分位、样本数、窗口                     |
| `search_web`                   | 外部搜索      | 新增 `src/apps/web-search/` provider adapter         | 搜索供应商                                            | 配额、域策略、最多 10 条                        | URL token、标题、摘要、时间                    |
| `fetch_web_page`               | 外部抓取      | 新增受控 fetch service                               | 仅 `search_web` 签发 URL                              | SSRF/MIME/大小/超时限制                         | 清洗正文、hash、来源元数据                     |

> Prisma model 与物理表的完整映射、数据量和索引见 [数据能力盘点](../overview/data-capability-inventory.md)。Tool adapter 优先调用新增 Facade，不直接依赖 Controller 或 Prisma。

## 2. 第一后续阶段

| Tool/能力              | 处理方式                                            | 原因                                                              |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `save_research_report` | 受控写 Tool；预览后显式确认，`clientRequestId` 幂等 | 复用 `ReportService`/`ResearchNoteService` 前先完成异步存储和审计 |
| 研究报告生成           | workflow 节点，不让模型自己选文件路径               | 需要模板、引用完整性和产物存储                                    |
| 创建/修改 schedule     | 结构化 REST API                                     | cron、时区、额度、资源归属需表单校验                              |
| 通知发送               | workflow/outbox                                     | 防止提示注入触发任意群发和重复送达                                |
| 回测提交               | 专用确认 command；非 MVP Tool                       | 当前取消/幂等语义需先修复，成本较高                               |

## 3. 明确禁止

- Tushare 手动同步、质量修复和 retry queue reset。
- 用户、角色、状态和配额管理。
- 自定义因子创建/更新/删除/预计算。
- 任意 SQL、Prisma filter、表名、Redis command。
- 任意 URL、浏览器脚本、shell、Python 用户代码。
- 删除持仓、自选股、策略、报告或文件。
- 交易下单、券商凭据和资金操作。

## 4. Tool—能力覆盖

| 用户问题                 | Tool 组合                                                             | 程序步骤                                 |
| ------------------------ | --------------------------------------------------------------------- | ---------------------------------------- |
| “茅台近五年估值贵吗”     | resolve → price history → financial indicators → valuation percentile | 对齐交易日、计算分位、生成图表块         |
| “比较两家公司盈利质量”   | resolve → statements + indicators（并行）                             | 按公告可用时点对齐，计算现金利润比等     |
| “今天市场和北向资金如何” | market snapshot                                                       | 校验各 section 的 dataAsOf，标记未更新项 |
| “我的组合风险”           | portfolio risk + market snapshot                                      | 所有权检查、风险快照、集中度和情景说明   |
| “复盘这个回测”           | backtest result + performance metrics                                 | 校验 run 归属与数据/算法版本             |
| “结合最新公告和新闻研究” | 内部 Tool + search + fetch                                            | 来源分级、时间对齐、逐结论引用           |

## 5. 当前数据风险对 Tool 的影响

Batch 000 已完成周/月 `pct_chg` 百分数回填与数据合同验证，Batch 007 已修复并回归前复权公式/排序，因此 `get_stock_price_history` 当前允许注册。Batch 008 已实现财报实际公告日过滤、稳定修订选版、累计转单季和官方 Moneyflow 净额保真；`FinaIndicator` 因每报告期只保留一行，历史修订不可恢复时必须返回 `POINT_IN_TIME_REVISION_UNAVAILABLE`，当前 Moneyflow 实库约 60 日覆盖也不得用 0 补成 250 日。Batch 009 已固定绩效/估值算法版本、组合/回测所有权、真实估值数据日与共有交易日 Beta 对齐；历史回测仍必须返回 `BACKTEST_BIAS_UNVERIFIED`，历史组合查询也必须提示当前持仓不是 point-in-time 快照。默认 `AGENT_TOOLS_ENABLED` 仍为空，需由部署显式启用。fresh migration 链验证、Dividend 去重和 retry 真修复仍是后续 Agent DB 变更的前置 gate。相关实施见 [Batch 000](../tasks/batches/batch-000-platform-data-readiness.md)。
