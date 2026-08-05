# Tool 方案

Tool 是模型与项目能力之间唯一允许的调用边界。模型不能访问 Prisma、SQL、Redis、文件系统、Tushare 管理接口或任意 URL；每次调用必须经过 Registry、JSON Schema、Policy、资源归属校验、超时/行数限制和审计。

## 文档导航

- [首期及后续 Tool 清单](./tool-inventory.md)
- [数据与智能体工具能力全景调研及补充规划](./数据与智能体工具能力全景调研及补充规划.md)
- [智能体 Tool 分批实施路线](./智能体工具分批实施路线-后端设计.md)
- [个股技术与数据可用性 Tool 后端设计](./个股技术与数据可用性工具-后端设计.md)
- [个股深度结构化研究 Tool 后端设计](./个股深度结构化研究工具-后端设计.md)
- [市场与多资产研究 Tool 后端设计](./市场与多资产研究工具-后端设计.md)
- [外部研究与衍生品 Tool 后端设计](./外部研究与衍生品工具-后端设计.md)
- [高级分析与私有数据 Tool 后端设计](./高级分析与私有数据工具-后端设计.md)
- [Tool 开发标准](./tool-development-standard.md)
- [公共输入输出 Schema](./schemas/common-types.md)
- [内部数据 Tool Schema](./schemas/internal-data-tools.md)
- [计算 Tool Schema](./schemas/quantitative-tools.md)
- [联网研究 Tool Schema](./schemas/web-research-tools.md)
- [Tool 错误 Schema](./schemas/tool-errors.md)

公共 API 内容块和引用结构见 [API 协议](../api/README.md)，后端执行边界见 [Tool System](../backend/tool-system.md)。

## 当前 canonical 范围

源码当前定义 34 个只读 Tool；部署环境可通过 `AGENT_TOOLS_ENABLED` 只启用其中一部分：

```text
resolve_security
get_stock_price_history
get_stock_overview
get_stock_technical_indicators
get_stock_technical_signals
get_data_availability
get_stock_chip_profile
get_stock_margin_history
get_stock_relative_strength
get_stock_events
get_stock_shareholder_profile
get_index_market_data
get_fund_research
get_industry_rotation
get_factor_analysis
get_macro_snapshot
get_option_market
get_convertible_bond_market
run_event_study
screen_stocks
get_financial_statements
get_financial_indicators
get_stock_moneyflow
get_market_snapshot
get_sector_membership
get_user_watchlist
get_portfolio_risk
get_backtest_result
get_backtest_analytics
get_portfolio_analytics
compute_performance_metrics
compute_valuation_percentile
search_web
fetch_web_page
```

`save_research_report` 是首个受控写 Tool，`requiresConfirmation=true`。模型只能产生 optional 的 `OPEN_REPORT_PREVIEW` 提案；前端在 `agent.completed` 后调用报告预览 REST，真正写入仍需用户按钮确认。公开事件不含 confirmation token。定时任务、通知渠道和持仓修改继续走结构化 UI/API command。

## 不变量

- Tool key 使用稳定 `snake_case`；重命名必须保留版本兼容或升 workflow version。
- `ToolAccessContext.userId` 由认证系统注入，不在模型参数中出现。
- 输出统一携带来源、截止时间、单位、警告、截断和审计 ID。
- 数值计算由程序完成；模型只解释结果。
- Tool 失败返回 typed error；不能用空数组冒充成功，也不能让模型补数字。
- 写 Tool 默认禁用，启用后也需要幂等键、显式确认和前后快照。

Workflow v9 使用能力目录 v4 做短目录预选，再把最多 18 个所选 Tool 的完整 Schema 交给 Planner；预选失败只回退核心研究包。第二至第五批本地只读 Tool 均只读 PostgreSQL，不在 Agent 请求中触发 Tushare；v8 及更旧定义仍可重放。本地已启用第五批两个私有分析 Tool 和报告预览提案；可转债与联网 Tool 仍待各自准入门禁。
