---
batch: 29
status: pending
type: backend
depends_on: ["batch-000-platform-data-readiness", "batch-018-mvp-e2e-and-model-regression"]
blocks: []
parallel_with: ["batch-019-conversation-summary-and-memory", "batch-020-scheduled-agent-tasks", "batch-021-outbound-notification-channels", "batch-022-research-report-and-investment-journal", "batch-023-multi-provider-routing-and-fallback", "batch-024-python-quant-compute-service", "batch-025-ai-observability-cost-and-evaluation", "batch-027-vector-retrieval-pilot", "batch-028-controlled-sql-explorer"]
recommended_executor: backend-coding-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 029：回测点时性、股票池与复权修复

## 1. 批次目标

修复已实证的 ALL_A 幸存者/IPO、指数退出成分、策略忽略 universe、财务公告日前视、QFQ 公式和最新复权因子排序，使新回测可复现。

## 2. 业务价值

在解除 `BACKTEST_BIAS_UNVERIFIED` 前建立可信量化基线；否则 Agent 会把严重前视结果包装成研究结论。

## 3. 前置依赖

- Batch 000 行情单位/迁移门禁。
- Batch 018 已有 bias golden baseline。

## 4. 执行范围

- 历史 point-in-time ALL_A universe：上市/退市/IPO 动态有效。
- 指数成分每 rebalance date 加入并剔除，bars/universe 同步。
- 所有 rotation/ranking strategy 强制使用传入 universe。
- 财务因子按 annDate/fAnnDate 可用版本，不按 endDate 直接前视。
- 修 StockDetail QFQ 和 Backtest adjRows orderBy/latest factor。
- 对新/旧 Run 标版本和可信状态，补 golden tests。

## 5. 不在本批次范围内

- 不改变历史已生成 Run 的原始数据；只标 legacy/unverified。
- 不开放模型自由提交回测；另需产品确认与写命令批次。
- 不同时重写整个 backtest engine。

## 6. 涉及的现有文件

- `src/apps/backtest/services/backtest-data.service.ts`、`backtest-engine.service.ts`
- `src/apps/backtest/strategies/screening-rotation.strategy.ts`、factor rotation/ranking strategy 真实文件
- `src/apps/stock/stock-detail.service.ts`
- `prisma/research/backtest.prisma` 与 StockBasic/IndexMemberAll/financial/AdjFactor

## 7. 需要新增的文件

- `src/apps/backtest/services/point-in-time-universe.service.ts`
- `src/apps/backtest/services/point-in-time-financial.service.ts`
- `src/apps/backtest/test/backtest-point-in-time.golden.spec.ts`
- `prisma/migrations/20260722010000_add_backtest_reproducibility_metadata/migration.sql`

## 8. 需要修改的文件

- 上述 backtest data/engine/strategy files
- `src/apps/stock/stock-detail.service.ts`
- BacktestRun schema 增 engine/data/universe/adjustment/quality versions
- Batch 009 BacktestToolFacade 解除 warning 的条件

## 9. 数据库变更

- BacktestRun 增 `engineVersion/dataContractVersion/universePolicyVersion/financialAsOfPolicyVersion/adjustmentPolicyVersion/reproducibilityStatus/qualityFlags`。
- 为 point-in-time 查询验证 StockBasic list/delist、IndexMemberAll in/out dates、financial annDate、AdjFactor tsCode+tradeDate 索引；缺失才用显式 migration 加索引。

## 10. API 变更

现有 backtest detail/Agent `get_backtest_result` 增版本与 quality flags，向后兼容。旧 Run 标 LEGACY_UNVERIFIED，不伪装 verified。

## 11. 后端实现任务

- ALL_A 每交易/调仓日期根据 listDate<=date 且 delistDate>date/空构建，不以当前 listStatus。
- 指数 universe 以有效日期全量替换，移除退出；为新加入加载所需历史窗口。
- 策略候选与下单前都 intersect universe。
- 财务选 annDate/fAnnDate<=signalDate 的最新可见版本，处理 updateFlag。
- QFQ=`price*factor/latestAdj`；adj rows 显式 tradeDate ASC/DESC 并取确定最新。

## 12. 前端实现任务

股票 K 线/回测详情显示 adjustment/quality/version；旧结果明显 warning，可归入既有组件小改。

## 13. Tool 或工作流变更

`get_backtest_result` 只有 `reproducibilityStatus=VERIFIED` 才去掉 bias warning；Tool 不自动重跑旧 Run。

## 14. 详细执行步骤

- 固化当前失败样例：337 现退市证券、后续 IPO、指数退出、两 rotation、财务前视比例、QFQ 公式。
- 实现 point-in-time universe/financial services 与 engine 接入。
- 修策略 universe intersection、QFQ/adj ordering。
- 新增 Run metadata migration 和 legacy backfill=UNVERIFIED。
- 用小型手工股票池/指数/公告/复权 golden cases 验证，并跑现有回测回归。
- 对代表性策略新旧结果做差异报告，不把差异当回归失败掩盖。

## 15. 核心数据结构

- `PointInTimeUniverseSnapshot { date, members, source, version, hash }`。
- `BacktestReproducibilityManifest` 包含所有 policy/data/code versions 和 input hash。

## 16. 关键接口定义

- `PointInTimeUniverseService.resolve(config, date)`
- `PointInTimeFinancialService.latestVisible(tsCode, metric, signalDate)`
- `AdjustmentService.adjust(bars, factors, method, asOf)`

## 17. 配置和环境变量

- `BACKTEST_REQUIRE_VERIFIED_DATA=true`（新 Run 默认）
- universe/financial/adjustment policy version constants；禁止环境变量随意改公式。

## 18. 异常和边缘场景

- list/delist 同日、暂停上市、代码变更、指数成分缺 outDate、IPO 无足够 lookback、公告修订、复权因子缺失/重复、未来除权、无交易日。

## 19. 安全要求

- 仍强制 run user ownership；策略不能通过 config 传 SQL/代码。
- 旧结果只读，不批量删除/覆写。

## 20. 日志和可观测性要求

- universe size/add/remove、missing bars、financial rows rejected by annDate、adjustment gaps、reproducibility status；差异报告保留 run IDs/hash。

## 21. 测试要求

- 手工 point-in-time universe/IPO/delist/index in-out golden。
- 两 rotation/ranking 强制 universe；公告日前不可见。
- Tushare 官方 QFQ fixture、adj row 随机顺序 property test。
- 现有 backtest tests + Agent warning contract。

## 22. 执行命令

- `pnpm test -- src/apps/backtest/test/backtest-point-in-time.golden.spec.ts`
- `pnpm test -- src/apps/backtest/test`
- `pnpm test -- src/apps/stock/test`
- `pnpm run build`

## 23. 验收标准

- 历史日期 ALL_A 含当时上市后来退市、排除尚未 IPO；指数退出后不可交易。
- 所有策略选择/下单只在当天 universe；财务只用已公告记录。
- QFQ 与官方公式 fixture 一致、结果不依赖 DB 返回顺序。
- 新 Run 可生成完整 reproducibility manifest；旧 Run 永远标 unverified。

## 24. 完成定义

services/engine/strategies/QFQ、migration、golden/差异/回归、Agent/UI warning 更新和口径文档合入。

## 25. 回滚方案

feature flag 暂停新回测；代码可回滚但新 metadata 保留。不要把已修复 Run 降级覆盖；旧 Run 原始记录不改。

## 26. 后续批次

- 通过产品确认、配额/取消/幂等 gate 后，另建受控回测提交 command；不直接注册自然语言 Tool。
