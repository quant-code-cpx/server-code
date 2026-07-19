---
batch: 9
status: completed
type: backend
depends_on: ['batch-000-platform-data-readiness', 'batch-006-tool-registry-and-policy']
blocks: ['batch-011-agent-orchestrator-workflow', 'batch-024-python-quant-compute-service']
parallel_with:
  [
    'batch-007-stock-market-query-tools',
    'batch-008-financial-fund-flow-tools',
    'batch-010-web-search-and-citations',
    'batch-015-frontend-stream-client-and-contracts',
    'batch-016-frontend-chat-shell',
  ]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 009：用户风险与确定性量化 Tool

## 1. 批次目标

注册 `get_portfolio_risk`、`get_backtest_result`、`compute_performance_metrics`、`compute_valuation_percentile`，让风险与数值计算可复现。

## 2. 业务价值

把收益、回撤、估值分位和组合风险从模型心算转为版本化程序，同时对现有回测偏差明确降级。

## 3. 前置依赖

- Batch 000 数据门禁。
- Batch 006 Tool 基础。

## 4. 执行范围

- 建立 Portfolio/Backtest 只读 Facade 和量化纯函数包。
- 实现四个 Tool、算法版本/hash、所有权和资源上限。
- 传播现有回测 universe/公告/复权未验证 warnings。

## 5. 不在本批次范围内

- 不创建新回测、不运行用户代码。
- 不在本批次修复所有历史回测偏差；Batch 029 负责。
- 不引入 Python；Batch 024 是后续条件项。

## 6. 涉及的现有文件

- `src/apps/portfolio/portfolio.service.ts`、`portfolio-risk.service.ts`、performance service
- `src/apps/backtest/services/*`
- `src/apps/stock/valuation-tool.facade.ts`
- `DailyBasic`（物理表 `stock_daily_valuation_metrics`）及回测 Prisma models

## 7. 需要新增的文件

- `src/apps/portfolio/portfolio-tool.facade.ts`
- `src/apps/backtest/backtest-tool.facade.ts`
- `src/apps/agent/quant/performance-metrics.ts`
- `src/apps/agent/quant/valuation-percentile.ts`
- `src/apps/agent/tools/adapters/quant-tools.ts`
- `src/apps/agent/tools/adapters/test/quant-tools.spec.ts`
- `src/apps/stock/valuation-tool.facade.ts`
- `src/apps/portfolio/test/portfolio-tool.facade.spec.ts`
- `src/apps/backtest/test/backtest-tool.facade.spec.ts`
- `src/apps/agent/quant/test/performance-metrics.spec.ts`
- `src/apps/agent/quant/test/valuation-percentile.spec.ts`

## 8. 需要修改的文件

- PortfolioModule/BacktestModule/StockModule export 稳定 Facade，保留既有模块兼容导出
- `src/apps/agent/agent.module.ts` 注册四个 Tool

## 9. 数据库变更

不新增表。估值按 tsCode+tradeDate 范围查询；backtest 读取必须带 userId。算法版本写 Tool 审计，不改历史回测表。

## 10. API 变更

不新增 REST；schema 使用 quantitative-tools/internal-data-tools 文档。

## 11. 后端实现任务

- 绩效函数纯函数、日期稳定排序、return 为小数比例、明确 annualization/riskFreeRate。
- 估值分位过滤策略、样本阈值、winsorize 和 percentile method 固定。
- Portfolio Facade 复验 userId；Backtest Facade 返回数据/策略/算法版本与 bias flags。
- 存在 `BACKTEST_BIAS_UNVERIFIED` 时模型 policy 禁止强结论。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

- 四个 READ/idempotent Tool；performance 最多 10,000 点，valuation 最长十年/至少 60 样本。
- output 带 algorithmVersion/inputHash/outputHash。

## 14. 详细执行步骤

- 建立独立 v1 纯函数口径，与现有回测指标服务保持 API 隔离并列出差异。
- 实现纯函数和手算 golden fixtures。
- 实现组合/回测 Facade 所有权和受限 section。
- 实现估值查询+分位算法与缺失过滤。
- 注册 Tool、输出 provenance/bias warnings，写跨租户与资源测试。

## 15. 核心数据结构

- `PerformanceMetricResult`、`ValuationPercentileResult`、`PortfolioRiskSnapshot`、`BacktestResearchResult`。
- `BacktestBiasFlags { survivorship, pointInTimeUniverse, announcementDate, adjustment, reproducible }`。

## 16. 关键接口定义

- `computePerformanceMetrics(input, algorithmVersion)`
- `computeValuationPercentile(series, policy)`
- `PortfolioToolFacade.risk(userId, command)`
- `BacktestToolFacade.result(userId, command)`

## 17. 配置和环境变量

- `AGENT_QUANT_MAX_POINTS=10000`、`AGENT_VALUATION_MIN_SAMPLES=60`。

## 18. 异常和边缘场景

- 零/负净值、重复日期、NaN/Infinity、短序列、停牌、负估值、缺失无风险率、组合空仓、回测进行中/已删除。

## 19. 安全要求

- 模型不能提交公式、代码、SQL 或 arbitrary metric key。
- 用户资源统一 not found，避免枚举他人 ID。

## 20. 日志和可观测性要求

- 算法 version、points、duration、warnings、bias flags；不记录持仓明细。
- 回测不可复现结果使用计数器并在 UI 显示。

## 21. 测试要求

- 手算和现有服务差分测试；差异必须有口径说明。
- 周/月 0.01 单位 fixture、复权 gate、短样本/异常数。
- 用户 A 不能读取 B 的组合/回测。

## 22. 执行命令

- `pnpm test -- src/apps/agent/tools/adapters/test/quant-tools.spec.ts`
- `pnpm test -- src/apps/portfolio/test src/apps/backtest/test`
- `pnpm run build`

## 23. 验收标准

- 相同输入/version 输出 hash 和数值稳定；模型不参与计算。
- 跨租户全部拒绝；历史回测偏差 flag 不可被调用方隐藏。
- 四个 Tool schema、来源、单位和算法版本完整。

## 24. 完成定义

- [x] `PortfolioToolFacade`、`BacktestToolFacade`、`ValuationToolFacade` 与四个 strict READ/idempotent Tool 已实现并注册。
- [x] 绩效 v1 固定日期排序、重复日期拒绝、小数收益、样本波动、周期无风险利率、负最大回撤和正损失 VaR/CVaR 口径。
- [x] 估值分位固定十年窗口、至少 60 样本、非正值过滤、Type-7 P1/P99 缩尾与 WEAK/MEAN 秩定义。
- [x] 组合/回测所有权条件包含 `userId`；跨租户与不存在统一 `DATA_NOT_FOUND`，模型无法覆盖 userId。
- [x] 组合 Beta 已按股票与基准共有交易日对齐；风险 `dataAsOf` 使用数据库真实最新估值日，不使用尚未入库的交易日。
- [x] 回测结果始终返回 `BACKTEST_BIAS_UNVERIFIED` 与不可复现 flags；null 不转 0，净值最多返回 2,000 点。
- [x] output 带 `algorithmVersion/inputHash/outputHash`；默认 `AGENT_TOOLS_ENABLED` 仍为空。
- [x] 实现提交：`d630fc1 feat(agent): add deterministic quant tools`；数据时点修复：`3477eaf fix(portfolio): use available market date for risk`。
- [x] Agent/Portfolio/Backtest/quant 回归 33 suites、552/552；Stock 11 suites、229/229；build、contracts、legacy ESLint、Prettier 全部通过。
- [x] 10,000 点绩效计算 p95 18.809ms；真实 DB 四 Tool schema 全通过，估值 1,584 样本，组合与估值 `dataAsOf=2026-07-17`。
- [x] Docker Desktop 恢复后 App/PostgreSQL/Redis healthy；watch `Found 0 errors`；`/health`、`/ready` 均为 ok。
- [x] Tool inventory、量化口径文档、[执行报告](../../../Agent确定性量化工具测试执行报告-20260720.md)与 `docs/README.md` 已同步。

## 25. 回滚方案

从 Registry 注销四 Tool；保留纯函数供内部测试，无 DB 回滚。

## 26. 后续批次

- Batch 011 使用确定性结果合成回答。
- Batch 010 补齐受控联网搜索与引用后，Batch 011 才能完成 MVP 编排。
- Batch 024 达到阈值后拆 Python。
- Batch 029 修复底层回测偏差后解除 warning。
