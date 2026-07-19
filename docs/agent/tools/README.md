# Tool 方案

Tool 是模型与项目能力之间唯一允许的调用边界。模型不能访问 Prisma、SQL、Redis、文件系统、Tushare 管理接口或任意 URL；每次调用必须经过 Registry、JSON Schema、Policy、资源归属校验、超时/行数限制和审计。

## 文档导航

- [首期及后续 Tool 清单](./tool-inventory.md)
- [Tool 开发标准](./tool-development-standard.md)
- [公共输入输出 Schema](./schemas/common-types.md)
- [内部数据 Tool Schema](./schemas/internal-data-tools.md)
- [计算 Tool Schema](./schemas/quantitative-tools.md)
- [联网研究 Tool Schema](./schemas/web-research-tools.md)
- [Tool 错误 Schema](./schemas/tool-errors.md)

公共 API 内容块和引用结构见 [API 协议](../api/README.md)，后端执行边界见 [Tool System](../backend/tool-system.md)。

## MVP 范围

MVP 注册 15 个只读 Tool：

```text
resolve_security
get_stock_price_history
get_stock_overview
get_financial_statements
get_financial_indicators
get_stock_moneyflow
get_market_snapshot
get_sector_membership
get_user_watchlist
get_portfolio_risk
get_backtest_result
compute_performance_metrics
compute_valuation_percentile
search_web
fetch_web_page
```

`save_research_report` 是首个后续写 Tool，默认 `requiresConfirmation=true`。定时任务、通知渠道和持仓修改走结构化 UI/API command，不作为模型可自由选择的 Tool。

## 不变量

- Tool key 使用稳定 `snake_case`；重命名必须保留版本兼容或升 workflow version。
- `ToolAccessContext.userId` 由认证系统注入，不在模型参数中出现。
- 输出统一携带来源、截止时间、单位、警告、截断和审计 ID。
- 数值计算由程序完成；模型只解释结果。
- Tool 失败返回 typed error；不能用空数组冒充成功，也不能让模型补数字。
- 写 Tool 默认禁用，启用后也需要幂等键、显式确认和前后快照。
