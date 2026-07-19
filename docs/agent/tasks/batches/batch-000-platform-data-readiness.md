---
batch: 0
status: in_progress
type: database
depends_on: []
blocks:
  [
    'batch-002-conversation-and-message-schema',
    'batch-007-stock-market-query-tools',
    'batch-008-financial-fund-flow-tools',
    'batch-009-deterministic-quant-tools',
    'batch-018-mvp-e2e-and-model-regression',
    'batch-026-security-hardening-and-production-deployment',
    'batch-029-backtest-bias-and-adjustment-remediation',
  ]
parallel_with: ['batch-001-agent-public-contracts']
recommended_executor: database-agent
recommended_reasoning_level: very-high
estimated_scope: large
---

# Batch 000：平台数据与迁移就绪门禁

## 1. 批次目标

建立 Agent 开发前的数据可信与可重建基线：修复 fresh migration 缺表链、周/月涨跌幅单位、Dividend 重复、历史 retry 假成功，并用空库与实库副本验证。

## 2. 业务价值

Agent 的行情、收益和财务结论只能建立在可重建且口径一致的数据上。本批次把已实证的风险变成自动门禁，避免后续 Tool 把错误数字包装成高可信答案。

## 3. 前置依赖

- 无代码依赖；需要数据库备份和只读审计结果。
- 实施前冻结 Tushare 同步写入窗口；大表回填须先在副本测量锁与 WAL。

## 4. 执行范围

- 补齐十张缺失表在 migration 链中的幂等 CREATE、索引和外键。
- 修正 DAILY/WEEKLY/MONTHLY `pct_chg` 单位映射并分批回填。
- 定义 Dividend 自然业务键，先去重再增加唯一约束。
- 修复 SyncRetryService 按失败目标精确补数与行数验证，排除未结束周/月。
- 新增数据口径与 fresh migration 自动测试。

## 5. 不在本批次范围内

- 不修复回测 universe/公告日前视；由 Batch 029 负责。
- 不新增 Agent 表或 API。
- 不改变 Tushare 对外管理端点。

## 6. 涉及的现有文件

- `prisma/**/*.prisma` 与 `prisma/migrations/**/migration.sql`
- `src/tushare/sync/financial-sync.service.ts`
- `src/tushare/sync/market-sync.service.ts`、`src/tushare/sync/sync-retry.service.ts`
- 行情 mapper、同步 plan 与现有 `test/`/模块 `test/`

## 7. 需要新增的文件

- `prisma/migrations/20260425000000_create_missing_sync_tables/migration.sql`（必须早于现有 valuation backfill，且对已有库幂等）
- `prisma/migrations/20260720000000_deduplicate_dividend_and_add_unique_key/migration.sql`
- `src/tushare/scripts/repair-market-period-pct-change.ts`
- `src/tushare/test/fresh-migration-and-data-contract.spec.ts`

## 8. 需要修改的文件

- 精确定位到共用 `mapOhlcvRecord` 的实现文件并增加 period-aware 换算
- `FinancialSyncService.fullDividendBuild()`
- `MarketSyncService.syncByTradeDate()`、`SyncRetryService`
- 相关 Prisma model 的 Dividend 唯一约束与同步测试

## 9. 数据库变更

- 创建缺失的 `ValuationDailyMedian`、`CyqChips`、`CyqPerf`、`LimitListD`、`FundAdj`、`FundPortfolio`、`FundShare`、`ThsDaily`、`DailyInfo`、`GgtDaily` 物理表/索引，表名和列必须从当前 Prisma mapping 生成。
- Dividend 去重 migration 先将重复业务键保留最新 `syncedAt/id`，输出删除计数，再加复合唯一约束。
- 行情回填按主键 cursor 小批事务；写修复版本和计数，不做单事务全表 UPDATE。

## 10. API 变更

不新增 API。现有 `/api/tushare/admin/*` 响应增加真实补数行数/验证状态时须保持 POST 与 DTO 兼容。

## 11. 后端实现任务

- mapper 对日线保留 Tushare 百分数；周/月小数比例乘 100，内部统一为百分数。
- retry 绕过 latest progress 短路，按 `task+targetDate` 精确查询并以期望行数/非零行数验证。
- period end 只返回已结束的周/月，盘中与节假日使用交易日历。
- 全量 Dividend 使用 upsert/唯一键，不再依赖无效 `skipDuplicates`。

## 12. 前端实现任务

不涉及。

## 13. Tool 或工作流变更

为后续 `get_stock_price_history` 和量化 Tool 提供 `data_contract_version`；门禁未通过时 Tool 不得注册。

## 14. 详细执行步骤

- 导出 schema/运行库/迁移清单并固化 fixture；在空 PostgreSQL 执行完整 `prisma migrate deploy`，复现失败。
- 编写早序幂等 migration；分别在空库和已有库副本执行，比较 `prisma migrate status` 与 schema diff。
- 从 Tushare 文档和真实响应固定周期单位 fixture，修 mapper 与单元测试。
- 用 cursor repair 脚本 dry-run 统计，再小批回填；每批校验 OHLC 推导收益与 pctChange。
- 在副本执行 Dividend 去重/唯一约束，核对 807 重复组基线及约束阻止复发。
- 构造旧失败日期+新成功断点、未结束周/月 fixture，修 retry 并验证非零落库。
- 运行 fresh、模块和回归测试，保存审计报告。

## 15. 核心数据结构

- `DataContractVersion { key, version, verifiedAt, evidenceHash }`（可先以代码常量+验证报告实现）
- Dividend 自然键必须覆盖 Tushare 可唯一标识一条分红方案的证券、公告/实施日期和方案字段；最终字段在 migration 注释与数据库文档一致。
- Repair checkpoint：`task/frequency/lastPrimaryKey/scanned/updated/failed`。

## 16. 关键接口定义

- `normalizePctChange(frequency, rawPctChange): number | null`
- `retryExactTarget(task, targetDate): Promise<{ fetched: number; persisted: number; verified: boolean }>`
- repair CLI 支持 `--dry-run`、`--batch-size`、`--after-id`、`--max-batches`，禁止无边界全表操作。

## 17. 配置和环境变量

- 复用现有 `DATABASE_URL`、Tushare 配置；repair 命令只允许显式 `DATA_REPAIR_CONFIRMATION=market-period-v1` 进入写模式。
- CI fresh DB 使用独立临时数据库，不连接开发/生产库。

## 18. 异常和边缘场景

- 停牌/除权、null preClose、重复日期、未结束周期、节假日、零行合法任务。
- 已有库发现表但缺索引/约束；migration 必须补齐而不删除用户数据。
- 回填中断可按 checkpoint 恢复；同批重复执行幂等。

## 19. 安全要求

- 操作前备份；生产写 repair 需维护窗口和最小权限 migration role。
- 日志不输出 Tushare token/数据库 URL；不使用 `db push --accept-data-loss`。

## 20. 日志和可观测性要求

- 记录每表 schema diff、migration 时长、锁等待、WAL 量；repair 每批 scanned/updated/mismatch/error。
- 指标：retry_verified_total、data_contract_gate、dividend_duplicate_groups、pct_change_mismatch_rows。

## 21. 测试要求

- 空库全链 migration；已有库幂等 migration；schema drift 为零。
- 日/周/月真实响应 fixture 与 OHLC 推导 golden test。
- Dividend 重复写两次行数不增长。
- 失败日期早于 progress 仍补数；零行不能标成功；未结束周期不入队。

## 22. 执行命令

- `pnpm prisma:generate`
- `pnpm exec prisma migrate deploy`（仅临时空库/副本）
- `pnpm run repair:market-period-pct-change -- --dry-run --frequency all --batch-size 500 --max-batches 1`
- `pnpm test -- src/tushare/test/fresh-migration-and-data-contract.spec.ts`
- `pnpm run build`

## 23. 验收标准

- 空库从零 migrate 成功，十表存在且与 Prisma schema 一致；已有库执行无破坏性变化。
- 周/月 mismatch 计数归零，daily 口径不变；repair 可恢复。
- Dividend 重复组归零且重复同步不增行。
- retry 只有真实落库并验证后才 SUCCEEDED。

## 24. 完成定义

代码、两类 migration、repair 脚本、回滚说明、验证报告和测试同时合入；`data_contract_gate` 为 green。

当前进度（2026-07-19）：

- 已完成缺失十表 migration、Dividend 去重/唯一索引 migration、周期口径 mapper、精确重试验证、未结束周期判断和可恢复 repair 脚本。
- 临时空库完整 migration 通过；副本 Dividend 从 17,151 行去重至 891 行，807 个重复组归零；Prisma schema drift 为零。
- 定向测试 6 suites / 124 tests 与 Nest build 已通过；真实库 dry-run 已确认周/月历史数据需修复。
- 已备份三张受影响表并冻结同步窗口；真实库两条 migration 已执行。Dividend 从 17,151 行去重至 891 行，807 个重复组归零。
- Weekly 修复 3,765,118 行、Monthly 修复 900,570 行；全表复核 `mismatch=0`、`ratio_still=0`，`MARKET_PRICE_DATA_CONTRACT_VERIFIED` 已设为 `true`。
- 尚待最终 commit/PR 证据写入后，再将本批次 frontmatter 更新为 `completed`。

## 25. 回滚方案

- 先停止同步；代码可回滚 mapper/retry，但已修正数据不回写为错误单位。
- 唯一约束可 DROP，去重前必须保留备份表/导出；缺失表 CREATE 不删除。
- repair 脚本用审计表/备份恢复受影响行，禁止整库 reset。

## 26. 后续批次

- Batch 002/003 可安全创建 Agent 表。
- Batch 007–009 才能注册依赖这些数据的 Tool。
- Batch 029 修复历史回测偏差与复权路径。
