# Tool 清单与真实复用来源

## 1. 当前只读 Tool

| Tool key                         | 分类          | 真实复用服务                                         | 主要真实数据                                          | 权限/限制                                        | 典型输出                                       |
| -------------------------------- | ------------- | ---------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| `resolve_security`               | 数据查询      | `StockToolFacade.resolveSecurity`                    | `StockBasic`、`IndexDaily`、`FundBasic`、`OptBasic`、`CbBasic` | 登录用户；最多 20 候选                    | tsCode、名称、类型、交易所、上市状态、歧义标记 |
| `get_stock_price_history`        | 数据查询      | `StockToolFacade.getPriceHistory`                    | `Daily`/`Weekly`/`Monthly`、`AdjFactor`、`DailyBasic` | 最大 5,000 bars；必须声明复权/周期               | 字段白名单行情、单位、复权、dataAsOf、截断     |
| `get_stock_overview`             | 数据查询      | `StockToolFacade.getOverview`                        | `StockBasic`、`Daily`、`DailyBasic`、`IndexMemberAll` | 最大 20 标的；支持历史时点                       | 证券概览、分区和独立数据日期                   |
| `get_stock_technical_indicators` | 数据查询      | `StockTechnicalToolFacade.getIndicators`             | `StkFactor` / `stock_technical_factors`               | 单股、1–500 日；MACD/KDJ/RSI/BOLL 白名单         | 指标序列、复权语义、水位线、真实空值           |
| `get_stock_technical_signals`    | 确定性计算    | `TechnicalSignalToolFacade.getSignals`               | 本地 QFQ OHLCV、14 个版本化信号定义                   | 单股；近期窗口含 250 日预热；统计 fail-soft      | 当日触发、最近事件、证据、可选历史统计         |
| `get_data_availability`          | 数据查询      | `DataAvailabilityToolFacade.getAvailability`         | 固定 16 项本地数据集、同步进度、质量记录、交易日历    | 最多 20 项；固定目录；并发不超过 4               | 水位、覆盖、lag、READY/DEGRADED/EMPTY/FAILED   |
| `get_stock_chip_profile`         | 数据查询/估算 | `StockChipToolFacade.getProfile`                     | `CyqPerf`、`CyqChips`、显式本地 OHLCV 估算            | 单股；最多 500 日/500 桶；默认禁止估算           | 成本分位、获利盘、真实/估算来源和分布          |
| `get_stock_margin_history`       | 数据查询/计算 | `StockMarginToolFacade.getHistory`                   | `MarginDetail`、`Daily`、`AdjFactor`                  | 单股；最多 500 实际观测日；固定趋势规则          | 两融余额、净买入、变化、行情滞后               |
| `get_stock_relative_strength`    | 确定性计算    | `RelativeStrengthToolFacade.getRelativeStrength`     | 股票 QFQ 日线、`IndexDaily`                           | 单股；20–1,250 共同交易日；算法 v1               | 复合收益、超额、波动、回撤、beta、IR           |
| `get_stock_events`               | 数据查询      | `StockEventToolFacade.getEvents`                     | 预告、披露、分红、回购、解禁、停牌、龙虎榜、大宗交易  | 单股；跨度 366 天；最多 100 行；knownAt 点时过滤 | 固定事件目录、分页、来源和点时验证             |
| `get_stock_shareholder_profile`  | 数据查询      | `StockShareholderToolFacade.getProfile`              | 股东人数、十大股东、增减持、`PledgeStat`              | 单股；最多 12 期/100 笔；公告日过滤              | 股东变化、持仓、增减持、质押未验证警告         |
| `get_index_market_data`          | 数据查询/计算 | `IndexResearchToolFacade`                            | `IndexDaily`、`IndexDailyBasic`、`IndexWeight`        | 单指数；最长 10 年；W/M 确定性聚合              | 行情、估值、成分权重、独立水位                 |
| `get_fund_research`              | 数据查询/估算 | `FundResearchToolFacade`                             | `FundBasic/Nav/Daily/Share/Portfolio`                 | 单基金；序列最多 1,000 点；持仓按公告日过滤      | 净值、价格、份额、持仓、显式 ETF 流量估算      |
| `get_industry_rotation`          | 数据查询/计算 | `IndustryRotationToolFacade`                         | `ThsIndex/Daily`、行业资金、估值中位数                | THS 固定口径；topN 50；热力图最多 3,000 cells   | 收益、动量、资金、估值、热力图和稳定排名       |
| `get_factor_analysis`            | 确定性计算    | `FactorAnalysisToolFacade`                           | 内置 FactorDefinition、快照、本地行情                 | 单操作；只允许启用内置因子；一次 Run 最多 3 次   | VALUES/IC/分组/衰减/分布/相关性和定义 hash     |
| `get_macro_snapshot`             | 数据查询      | `MacroResearchToolFacade`                            | `MacroCpi/Ppi/Gdp/Shibor`                             | 最多 4 序列 × 500 条；无官方发布日期            | 最新值、历史、单位、systemKnownAt 和固定告警    |
| `get_option_market`              | 数据查询      | `OptionMarketToolFacade`                             | `OptBasic`、`OptDaily`                                | 搜索/合约/最长 5 年历史；最多 1,000 点           | 合约字段、真实覆盖、日线；不提供 IV/Greeks      |
| `get_convertible_bond_market`    | 数据查询      | `ConvertibleBondToolFacade`                          | `CbBasic`、`CbDaily`                                  | 搜索/基本/最长 10 年历史；当前生产默认关闭       | 条款、转股字段、逐债覆盖和短覆盖告警             |
| `run_event_study`                | 确定性计算    | `EventStudyToolFacade`                               | 8 类事件、`Daily`、`IndexDaily`、`TradeCal`           | 最多 500 样本、81 日窗口；一次 Run 最多 2 次     | AR/CAR/AAR/CAAR、排除原因、显著性和定义 hash    |
| `screen_stocks`                  | 数据查询      | `StockScreenerService.screener`                      | 股票、行情、估值、财务、资金流、技术因子              | v1 保留；v2 支持最多 20 个 tsCode 和 50 行       | 稳定排序、五项诚实启发式、逐项证据             |
| `get_financial_statements`       | 数据查询      | `FinancialToolFacade.getStatements`                  | `Income`、`BalanceSheet`、`Cashflow`                  | 最大 12 报告期；公告可得日；稳定修订选版         | 累计/单季/时点值、单位、公告日、revision       |
| `get_financial_indicators`       | 数据查询      | `FinancialToolFacade.getIndicators`                  | `FinaIndicator` / `financial_indicator_snapshots`     | 最大 20 期/30 指标；服务端 allowlist             | canonical/source field、值、单位、PIT warning  |
| `get_stock_moneyflow`            | 数据查询      | `MoneyflowToolFacade.getDaily`                       | `Moneyflow` / `stock_capital_flows`                   | 最大 250 交易日；日期下推；官方净额不重算        | 净流入/净量、可选四档买卖、单位、时点          |
| `get_market_snapshot`            | 数据查询      | `MarketToolFacade.snapshot` → `MarketService`        | 指数、市场广度、估值、情绪、资金流                    | `sections` 白名单；公共短缓存                    | 每 section 独立状态、asOf、facts/rows          |
| `get_sector_membership`          | 数据查询      | `SectorToolFacade.membership`                        | `IndexMemberAll`、`ThsIndex/ThsMember`、`IndexWeight` | 最大 500 成分；历史概念 fail-closed              | 层级、成员、权重、有效日期                     |
| `get_user_watchlist`             | 用户数据      | `WatchlistToolFacade.read`                           | `Watchlist`、`WatchlistStock`、`StockBasic`、`Daily`  | userId 强制注入；只读；不缓存                    | 自选组、名称、备注及可选最新行情               |
| `get_portfolio_risk`             | 用户数据/计算 | `PortfolioToolFacade` → `PortfolioRiskService`       | `Portfolio`、持仓、风险快照                           | userId 所有权；真实数据日；历史持仓能力显式告警  | 暴露、集中度、beta、告警                       |
| `get_backtest_result`            | 用户数据/计算 | `BacktestToolFacade`                                 | backtest run/trade/equity/metrics models              | userId 所有权；最多 2,000 净值点；强制偏差标记   | 配置、指标、净值、交易摘要                     |
| `get_backtest_analytics`         | 用户数据/计算 | `BacktestAnalyticsToolFacade`                        | 回测 NAV/交易/持仓及已持久化高级结果               | owner scope；1–3 项；Monte Carlo 显式 seed；单 Run 最多 2 次 | Monte Carlo、Brinson、成本敏感度、扫描/WF/对比 |
| `get_portfolio_analytics`        | 用户数据/计算 | `PortfolioAnalyticsToolFacade`                       | 不可变持仓事件、每日组合/仓位点时快照              | owner scope；最长 5 年；最多 1,250 快照；迁移前区间拒绝 | 概览、绩效、PnL、漂移、事件分页和覆盖起点 |
| `compute_performance_metrics`    | 确定性计算    | `computePerformanceMetrics`                          | 调用方提供的有界收益/净值序列                         | 最多 10,000 点；`performance-metrics-v1`         | CAGR、波动、Sharpe、回撤、VaR/CVaR             |
| `compute_valuation_percentile`   | 确定性计算    | `ValuationToolFacade` → `computeValuationPercentile` | `DailyBasic` / `stock_daily_valuation_metrics`        | 最长十年；至少 60 样本；过滤/缩尾/秩定义固定     | 当前值、分位、样本数、窗口                     |
| `search_web`                     | 外部搜索      | 新增 `src/apps/web-search/` provider adapter         | 搜索供应商                                            | 配额、域策略、最多 10 条                         | URL token、标题、摘要、时间                    |
| `fetch_web_page`                 | 外部抓取      | 新增受控 fetch service                               | 仅 `search_web` 签发 URL                              | SSRF/MIME/大小/超时限制                          | 清洗正文、hash、来源元数据                     |

> Prisma model 与物理表的完整映射、数据量和索引见 [数据能力盘点](../overview/data-capability-inventory.md)。Tool adapter 优先调用新增 Facade，不直接依赖 Controller 或 Prisma。

## 2. 受控写与后续阶段

| Tool/能力              | 处理方式                                            | 原因                                                              |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `save_research_report` | 已启用的受控写 Tool；只发 `OPEN_REPORT_PREVIEW`，按钮确认后由 REST 幂等写入 | 复用已完成的 `ResearchReportService` 两阶段确认、内容 hash、日志 hash 和渲染队列 |
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

| 用户问题                     | Tool 组合                                                             | 程序步骤                                  |
| ---------------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| “茅台近五年估值贵吗”         | resolve → price history → financial indicators → valuation percentile | 对齐交易日、计算分位、生成图表块          |
| “比较两家公司盈利质量”       | resolve → statements + indicators（并行）                             | 按公告可用时点对齐，计算现金利润比等      |
| “今天市场和北向资金如何”     | market snapshot                                                       | 校验各 section 的 dataAsOf，标记未更新项  |
| “我的组合风险”               | portfolio risk + market snapshot                                      | 所有权检查、风险快照、集中度和情景说明    |
| “复盘这个回测”               | backtest result + performance metrics                                 | 校验 run 归属与数据/算法版本              |
| “结合最新公告和新闻研究”     | 内部 Tool + search + fetch                                            | 来源分级、时间对齐、逐结论引用            |
| “特变电工最新 MACD 和 RSI”   | technical indicators                                                  | 读取本地因子，返回最近 READY 日与复权语义 |
| “今天特变电工有没有标准信号” | technical signals                                                     | 固定目录计算 true/false、最近事件和证据   |
| “技术因子更新到哪天”         | data availability                                                     | 返回水位、同步/质量状态，不触发在线补数   |
| “茅台最新获利盘和中位成本”   | resolve → chip profile                                                | 优先真实筹码，估算必须由调用参数显式允许  |
| “融资余额最近20日如何变化”   | resolve → margin history                                              | 按两融实际观测日计算并提示行情滞后        |
| “近一年跑赢沪深300多少”      | resolve → relative strength                                           | 对齐共同交易日后执行版本化程序计算        |
| “未来90天有哪些已公告事件”   | resolve → stock events                                                | 先按 knownAt 过滤，再按事件日排序分页     |
| “最新股东与质押风险”         | resolve → shareholder profile                                         | 公告点时过滤；质押无公告日固定降级        |
| “沪深300近一年走势和估值”    | resolve → index market data                                           | 指数日线/估值独立水位，必要时程序聚合周月线 |
| “510300 净值、价格和份额”    | resolve → fund research                                                | 区分 NAV 与场内价格，流量估算显式标记     |
| “最近20日行业轮动”           | industry rotation                                                      | THS 母体稳定排名，跨来源只做名称精确匹配  |
| “pe_ttm 因子 IC 和五分组”    | factor analysis（IC、QUANTILE 分次）                                  | 固定内置因子、平均并列秩、缺失不补 0      |
| “最新 CPI、GDP 和 Shibor”    | macro snapshot                                                         | 输出观察期和系统已知时间，不伪造发布日期  |
| “查询某一期权最近一年行情”   | resolve → option market                                                 | 只读本地合约和日线，不猜标的映射或 Greeks |
| “回购后 20 日通常涨多少”     | run event study                                                         | 固定事件定义，缺失窗口排除，不补 0         |
| “某转债条款和历史溢价”       | resolve → convertible bond market                                      | 逐债返回真实覆盖；当前回补达标前不启用     |
| “复盘这个回测的稳健性”       | backtest result → backtest analytics                                  | owner 校验后执行可复现 Monte Carlo/归因/成本分析 |
| “我的组合过去一年表现如何”   | portfolio analytics                                                        | 只读事件账本与点时快照；覆盖前区间显式拒绝 |
| “保存这份研究报告”           | save research report                                                       | 公开事件只打开预览；真正写入需用户点击确认   |

## 5. 当前数据风险对 Tool 的影响

Batch 000 已完成周/月 `pct_chg` 百分数回填与数据合同验证，Batch 007 已修复并回归前复权公式/排序，因此 `get_stock_price_history` 当前允许注册。Batch 008 已实现财报实际公告日过滤、稳定修订选版、累计转单季和官方 Moneyflow 净额保真；`FinaIndicator` 因历史修订不可恢复会显式 warning。Batch 009 已固定绩效/估值算法版本与所有权边界；历史回测仍必须返回 `BACKTEST_BIAS_UNVERIFIED`。第二、三批已完成真库验收。第四批代码已实现，本地仅启用已过闸的期权和事件研究；可转债、外部搜索仍关闭。第五批已新增不可变持仓事件和 `portfolio-nav.v1` 点时快照，迁移只从真实覆盖日起提供历史；早于覆盖起点的请求返回 `DATA_NOT_READY`。本地已通过回测可复现性、组合分析、查询计划和报告预览门禁，并显式启用两个新私有只读 Tool 及报告预览提案。默认示例配置的 `AGENT_TOOLS_ENABLED` 仍为空，部署必须显式启用。
