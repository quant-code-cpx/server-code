# 数据质量增强 Phase 3 — 跨表一致性对账 — 后端设计

> **对应总纲**：Task 5（层次 3 — 跨表逻辑一致性校验）
>
> **前置条件**：Phase 1 + Phase 2 已完成（`DataQualityReport` 类型稳定、`DATA_SET_CONFIG` 已包含全部数据集）
>
> **涉及文件**：新增 `src/tushare/sync/quality/cross-table-check.service.ts`、小幅改动 `data-quality.service.ts`

---

## 一、目标

当前数据质量检查仅做"单表时效性 + 单表完整性"。但多表之间可能存在**逻辑不一致**：

- 某交易日有日线但缺复权因子
- 某只股票在利润表里有记录、在资产负债表里没有
- 指数成分股权重引用了不存在于 `StockBasic` 的股票

本 Phase 设计一套**跨表对账**机制，在不引入外键的前提下以应用层检查覆盖。

---

## 二、对账类型分类

### 2.1 分类总表

| 对账编号 | 对账名称            | 左表        | 右表         | 匹配条件                      | 期望                                  |
| -------- | ------------------- | ----------- | ------------ | ----------------------------- | ------------------------------------- |
| C-01     | 日线 ↔ 每日指标     | Daily       | DailyBasic   | (tsCode, tradeDate)           | 同日两表记录数接近一致                |
| C-02     | 日线 ↔ 复权因子     | Daily       | AdjFactor    | (tsCode, tradeDate)           | 同日两表记录数接近一致                |
| C-03     | 日线 ↔ 涨跌停       | Daily       | StkLimit     | (tsCode, tradeDate)           | StkLimit 覆盖 Daily 的全部交易日      |
| C-04     | 日线 ↔ 停牌 互斥    | Daily       | SuspendD     | (tsCode, tradeDate)           | 同一 (tsCode, tradeDate) 不应同时出现 |
| C-05     | 利润表 ↔ 资产负债表 | Income      | BalanceSheet | (tsCode, endDate)             | 同一报告期两表都有数据                |
| C-06     | 利润表 ↔ 现金流量表 | Income      | Cashflow     | (tsCode, endDate)             | 同一报告期两表都有数据                |
| C-07     | 指数权重 → 基础信息 | IndexWeight | StockBasic   | conCode → tsCode              | conCode 全部存在于 StockBasic         |
| C-08     | 指数行情 ↔ 指数权重 | IndexDaily  | IndexWeight  | (tsCode=indexCode, tradeDate) | 有行情的指数应有对应月份的权重        |

### 2.2 对账模式

对账不必每次全量扫描历史。设计两种运行深度：

| 模式     | 描述                            | 适用场景           |
| -------- | ------------------------------- | ------------------ |
| `recent` | 仅检查最近 N 个交易日（默认 5） | 每日同步后自动触发 |
| `full`   | 检查完整历史或最近 1 年         | 手动触发、周末调度 |

---

## 三、架构设计

### 3.1 新增 `CrossTableCheckService`

```
src/tushare/sync/quality/
├── data-quality.service.ts          // 现有，timeliness + completeness
├── cross-table-check.service.ts     // ★ 新增，跨表一致性
└── data-quality.module.ts           // 注册两个 service
```

`CrossTableCheckService` 注入 `PrismaService` 和 `SyncHelperService`，提供：

```typescript
@Injectable()
export class CrossTableCheckService {
  private readonly logger = new Logger(CrossTableCheckService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: SyncHelperService,
  ) {}

  /** 执行指定对账项 */
  async runCheck(checkId: string, mode: 'recent' | 'full'): Promise<DataQualityReport>

  /** 执行全部对账项 */
  async runAllCrossChecks(mode: 'recent' | 'full'): Promise<DataQualityReport[]>

  /** 供 DataQualityService 统一调度 */
  async runRecentCrossChecks(): Promise<DataQualityReport[]>
}
```

### 3.2 对账项注册表

```typescript
interface CrossCheckDef {
  id: string
  name: string
  /** 运行此对账需要的最低模式 */
  minMode: 'recent' | 'full'
  /** 执行器 */
  run: (mode: 'recent' | 'full') => Promise<DataQualityReport>
}

private readonly CROSS_CHECKS: CrossCheckDef[] = [
  { id: 'C-01', name: '日线 ↔ 每日指标', minMode: 'recent', run: (m) => this.checkDailyVsDailyBasic(m) },
  { id: 'C-02', name: '日线 ↔ 复权因子', minMode: 'recent', run: (m) => this.checkDailyVsAdjFactor(m) },
  { id: 'C-03', name: '日线 ↔ 涨跌停',   minMode: 'recent', run: (m) => this.checkDailyVsStkLimit(m) },
  { id: 'C-04', name: '日线 ↔ 停牌互斥', minMode: 'recent', run: (m) => this.checkDailyVsSuspend(m) },
  { id: 'C-05', name: '利润表 ↔ 资产负债表', minMode: 'recent', run: (m) => this.checkIncomeVsBalance(m) },
  { id: 'C-06', name: '利润表 ↔ 现金流量表', minMode: 'recent', run: (m) => this.checkIncomeVsCashflow(m) },
  { id: 'C-07', name: '指数权重 → 基础信息', minMode: 'full', run: (m) => this.checkIndexWeightRefIntegrity(m) },
  { id: 'C-08', name: '指数行情 ↔ 指数权重', minMode: 'full', run: (m) => this.checkIndexDailyVsWeight(m) },
]
```

---

## 四、各对账项实现方案

### 4.1 C-01 / C-02: 日线 ↔ DailyBasic / AdjFactor（按日对齐）

**算法**：取最近 N 个交易日，逐日统计 `Daily.count(where: tradeDate)` vs `DailyBasic.count(where: tradeDate)`，比较差异。

```typescript
private async checkPairwiseAlignment(
  leftModel: string,
  rightModel: string,
  leftLabel: string,
  rightLabel: string,
  checkId: string,
  mode: 'recent' | 'full',
): Promise<DataQualityReport> {
  const depth = mode === 'recent' ? 5 : 60
  const today = this.helper.getCurrentShanghaiDateString()
  const startDate = this.helper.addDays(today, -depth)
  const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, today)

  const mismatches: Array<{ date: string; leftCount: number; rightCount: number }> = []

  for (const td of tradeDates) {
    const dateVal = this.helper.toDate(td)
    const [leftCount, rightCount] = await Promise.all([
      (this.prisma as any)[leftModel].count({ where: { tradeDate: dateVal } }),
      (this.prisma as any)[rightModel].count({ where: { tradeDate: dateVal } }),
    ])

    // 允许 5% 的偏差（部分股票 DailyBasic 可能延迟）
    if (leftCount > 0 && Math.abs(leftCount - rightCount) / leftCount > 0.05) {
      mismatches.push({ date: td, leftCount, rightCount })
    }
  }

  if (mismatches.length === 0) {
    return {
      dataSet: checkId, checkType: 'cross-table',
      status: 'pass',
      message: `${leftLabel} ↔ ${rightLabel} 最近 ${tradeDates.length} 个交易日对齐正常`,
    }
  }

  return {
    dataSet: checkId, checkType: 'cross-table',
    status: mismatches.length > tradeDates.length * 0.5 ? 'fail' : 'warn',
    message: `${leftLabel} ↔ ${rightLabel} 有 ${mismatches.length}/${tradeDates.length} 个交易日记录数不一致`,
    details: { mismatches: mismatches.slice(0, 20) },
  }
}

// C-01
private checkDailyVsDailyBasic(mode: 'recent' | 'full') {
  return this.checkPairwiseAlignment('daily', 'dailyBasic', '日线', '每日指标', 'C-01', mode)
}

// C-02
private checkDailyVsAdjFactor(mode: 'recent' | 'full') {
  return this.checkPairwiseAlignment('daily', 'adjFactor', '日线', '复权因子', 'C-02', mode)
}
```

### 4.2 C-03: 日线 ↔ 涨跌停（按日对齐，StkLimit 使用 String 日期）

```typescript
private async checkDailyVsStkLimit(mode: 'recent' | 'full'): Promise<DataQualityReport> {
  const depth = mode === 'recent' ? 5 : 60
  const today = this.helper.getCurrentShanghaiDateString()
  const startDate = this.helper.addDays(today, -depth)
  const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, today)

  const mismatches: Array<{ date: string; dailyCount: number; stkLimitCount: number }> = []

  for (const td of tradeDates) {
    const [dailyCount, stkLimitCount] = await Promise.all([
      this.prisma.daily.count({ where: { tradeDate: this.helper.toDate(td) } }),
      this.prisma.stkLimit.count({ where: { tradeDate: td } }),  // String 日期
    ])

    if (dailyCount > 0 && stkLimitCount === 0) {
      mismatches.push({ date: td, dailyCount, stkLimitCount })
    }
  }

  if (mismatches.length === 0) {
    return {
      dataSet: 'C-03', checkType: 'cross-table', status: 'pass',
      message: `日线 ↔ 涨跌停 最近 ${tradeDates.length} 个交易日对齐正常`,
    }
  }

  return {
    dataSet: 'C-03', checkType: 'cross-table',
    status: mismatches.length > 3 ? 'fail' : 'warn',
    message: `日线 ↔ 涨跌停 有 ${mismatches.length} 个交易日日线有数据但涨跌停无数据`,
    details: { mismatches },
  }
}
```

### 4.3 C-04: 日线 ↔ 停牌互斥

**逻辑**：对于最近 N 个交易日，检查是否有 (tsCode, tradeDate) 同时出现在 Daily 和 SuspendD 中。因为 SuspendD 的 tradeDate 是 String 类型，需要格式转换。

```typescript
private async checkDailyVsSuspend(mode: 'recent' | 'full'): Promise<DataQualityReport> {
  const depth = mode === 'recent' ? 5 : 30
  const today = this.helper.getCurrentShanghaiDateString()
  const startDate = this.helper.addDays(today, -depth)
  const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, today)

  // 分批处理：每次取一个交易日的停牌股票，检查是否在 Daily 中也有记录
  let conflictCount = 0
  const conflictSamples: Array<{ tsCode: string; tradeDate: string }> = []

  for (const td of tradeDates) {
    // 获取该日停牌的股票
    const suspended = await this.prisma.suspendD.findMany({
      where: { tradeDate: td },
      select: { tsCode: true },
    })

    if (suspended.length === 0) continue

    const suspendedCodes = suspended.map((s) => s.tsCode)

    // 检查这些停牌股票是否在 Daily 中也有记录
    const overlapping = await this.prisma.daily.count({
      where: {
        tradeDate: this.helper.toDate(td),
        tsCode: { in: suspendedCodes },
      },
    })

    if (overlapping > 0) {
      conflictCount += overlapping
      // 抽样记录
      if (conflictSamples.length < 20) {
        const samples = await this.prisma.daily.findMany({
          where: { tradeDate: this.helper.toDate(td), tsCode: { in: suspendedCodes } },
          select: { tsCode: true },
          take: 5,
        })
        for (const s of samples) {
          conflictSamples.push({ tsCode: s.tsCode, tradeDate: td })
        }
      }
    }
  }

  if (conflictCount === 0) {
    return {
      dataSet: 'C-04', checkType: 'cross-table', status: 'pass',
      message: `日线 ↔ 停牌 最近 ${tradeDates.length} 个交易日无互斥冲突`,
    }
  }

  return {
    dataSet: 'C-04', checkType: 'cross-table',
    // 说明：少量冲突是正常的（Tushare 的停牌数据和日线数据可能有边界差异）
    status: conflictCount > 50 ? 'warn' : 'pass',
    message: `日线 ↔ 停牌 发现 ${conflictCount} 条冲突记录（停牌日仍有日线数据）`,
    details: { conflictCount, samples: conflictSamples },
  }
}
```

> **注意**：少量冲突可能是 Tushare 数据本身的特性（如集合竞价产生的半天交易），因此阈值设为 `warn` 而非 `fail`。

### 4.4 C-05 / C-06: 财务三表对齐

**算法**：对 Income.tsCode × endDate 的集合，检查 BalanceSheet / Cashflow 是否也存在对应记录。由于财务表无自然 PK（用 autoincrement id），采用按季度分组对比。

```typescript
private async checkFinancialPairAlignment(
  leftModel: string,
  rightModel: string,
  leftLabel: string,
  rightLabel: string,
  checkId: string,
  mode: 'recent' | 'full',
): Promise<DataQualityReport> {
  // 取最近的报告期
  const recentPeriods = mode === 'recent'
    ? this.helper.buildRecentQuarterPeriods(1)   // 最近 4 个季度
    : this.helper.buildRecentQuarterPeriods(3)   // 最近 12 个季度

  const mismatches: Array<{ period: string; leftCodes: number; rightCodes: number; missingInRight: number }> = []

  for (const period of recentPeriods) {
    const periodDate = this.helper.toDate(period)

    // 左表有数据的股票集合
    const leftCodes = await (this.prisma as any)[leftModel].findMany({
      where: { endDate: periodDate },
      select: { tsCode: true },
      distinct: ['tsCode'],
    })
    const leftCodeSet = new Set<string>(leftCodes.map((r: { tsCode: string }) => r.tsCode))

    if (leftCodeSet.size === 0) continue

    // 右表有数据的股票集合
    const rightCodes = await (this.prisma as any)[rightModel].findMany({
      where: { endDate: periodDate },
      select: { tsCode: true },
      distinct: ['tsCode'],
    })
    const rightCodeSet = new Set<string>(rightCodes.map((r: { tsCode: string }) => r.tsCode))

    // 左有右无
    const missingInRight = [...leftCodeSet].filter((c) => !rightCodeSet.has(c)).length

    if (missingInRight > leftCodeSet.size * 0.05) {
      mismatches.push({
        period,
        leftCodes: leftCodeSet.size,
        rightCodes: rightCodeSet.size,
        missingInRight,
      })
    }
  }

  if (mismatches.length === 0) {
    return {
      dataSet: checkId, checkType: 'cross-table', status: 'pass',
      message: `${leftLabel} ↔ ${rightLabel} 最近 ${recentPeriods.length} 个报告期对齐正常`,
    }
  }

  return {
    dataSet: checkId, checkType: 'cross-table',
    status: mismatches.length > recentPeriods.length * 0.5 ? 'fail' : 'warn',
    message: `${leftLabel} ↔ ${rightLabel} 有 ${mismatches.length}/${recentPeriods.length} 个报告期覆盖不一致`,
    details: { mismatches },
  }
}

// C-05
private checkIncomeVsBalance(mode: 'recent' | 'full') {
  return this.checkFinancialPairAlignment('income', 'balanceSheet', '利润表', '资产负债表', 'C-05', mode)
}

// C-06
private checkIncomeVsCashflow(mode: 'recent' | 'full') {
  return this.checkFinancialPairAlignment('income', 'cashflow', '利润表', '现金流量表', 'C-06', mode)
}
```

### 4.5 C-07: 指数权重 → 基础信息（引用完整性）

```typescript
private async checkIndexWeightRefIntegrity(mode: 'recent' | 'full'): Promise<DataQualityReport> {
  // 获取 IndexWeight 中所有 conCode（去重）
  // 为避免全表扫描，仅检查最新月份
  const latestDate = await this.helper.getLatestDateString('indexWeight', 'tradeDate')
  if (!latestDate) {
    return { dataSet: 'C-07', checkType: 'cross-table', status: 'warn', message: '指数权重表无数据' }
  }

  const conCodes = await this.prisma.indexWeight.findMany({
    where: { tradeDate: latestDate },
    select: { conCode: true },
    distinct: ['conCode'],
  })
  const conCodeSet = new Set(conCodes.map((r) => r.conCode))

  // 检查这些 conCode 在 StockBasic 中是否存在
  const existingStocks = await this.prisma.stockBasic.findMany({
    where: { tsCode: { in: [...conCodeSet] } },
    select: { tsCode: true },
  })
  const stockCodeSet = new Set(existingStocks.map((s) => s.tsCode))

  const orphanCodes = [...conCodeSet].filter((c) => !stockCodeSet.has(c))

  if (orphanCodes.length === 0) {
    return {
      dataSet: 'C-07', checkType: 'cross-table', status: 'pass',
      message: `指数权重 → 基础信息 引用完整（${conCodeSet.size} 只成分股全部存在于 StockBasic）`,
    }
  }

  return {
    dataSet: 'C-07', checkType: 'cross-table',
    status: orphanCodes.length > conCodeSet.size * 0.05 ? 'fail' : 'warn',
    message: `指数权重中 ${orphanCodes.length}/${conCodeSet.size} 只成分股不存在于 StockBasic`,
    details: { orphanCodes: orphanCodes.slice(0, 50), total: orphanCodes.length },
  }
}
```

### 4.6 C-08: 指数行情 ↔ 指数权重（指数粒度覆盖）

```typescript
private async checkIndexDailyVsWeight(mode: 'recent' | 'full'): Promise<DataQualityReport> {
  // 获取 IndexDaily 中的所有指数代码
  const indices = await this.prisma.indexDaily.findMany({
    select: { tsCode: true },
    distinct: ['tsCode'],
  })
  const indexCodes = indices.map((i) => i.tsCode)

  // 获取 IndexWeight 中有权重数据的指数代码
  const weightIndices = await this.prisma.indexWeight.findMany({
    select: { indexCode: true },
    distinct: ['indexCode'],
  })
  const weightIndexSet = new Set(weightIndices.map((w) => w.indexCode))

  // 有行情但无权重的指数
  const noWeight = indexCodes.filter((c) => !weightIndexSet.has(c))

  if (noWeight.length === 0) {
    return {
      dataSet: 'C-08', checkType: 'cross-table', status: 'pass',
      message: `指数行情 ↔ 指数权重 覆盖正常（${indexCodes.length} 个指数均有权重）`,
    }
  }

  // 只要部分主要指数有权重即可。IndexWeight 通常只覆盖主要指数，因此大量 noWeight 是正常的
  return {
    dataSet: 'C-08', checkType: 'cross-table',
    status: weightIndexSet.size === 0 ? 'fail' : 'pass',
    message: `${weightIndexSet.size}/${indexCodes.length} 个指数有权重数据，${noWeight.length} 个仅有行情`,
    details: { withWeight: weightIndexSet.size, total: indexCodes.length },
  }
}
```

---

## 五、与 DataQualityService 集成

### 5.1 `runAllChecks` 增加跨表对账

```typescript
// data-quality.service.ts
constructor(
  // ...
  private readonly crossTableCheck: CrossTableCheckService,
) {}

async runAllChecks(): Promise<void> {
  // ... 现有 timeliness + completeness 检查 ...

  // ── 跨表一致性对账（recent 模式，仅最近几日） ──
  try {
    const crossReports = await this.crossTableCheck.runRecentCrossChecks()
    for (const report of crossReports) {
      await this.writeCheckResult(report)
      // 统计 pass/warn/fail
    }
  } catch (error) {
    this.logger.error(`[数据质量检查] 跨表对账失败: ${(error as Error).message}`)
  }
}
```

### 5.2 Controller 扩展

在已有的质量检查 Controller 中增加手动触发 full 模式：

```typescript
@Post('admin/quality/cross-check')
async runCrossTableCheck(
  @Body() body: { mode?: 'recent' | 'full' },
): Promise<DataQualityReport[]> {
  const mode = body.mode ?? 'recent'
  return this.crossTableCheck.runAllCrossChecks(mode)
}
```

---

## 六、性能考虑

| 对账项  | 查询模式           | 预计耗时          | 优化策略                   |
| ------- | ------------------ | ----------------- | -------------------------- |
| C-01/02 | 逐日 COUNT         | recent: ~5×2 查询 | 并行左右表查询             |
| C-03    | 逐日 COUNT         | recent: ~5×2 查询 | 同上                       |
| C-04    | 逐日 IN 查询       | 受停牌股票数影响  | 分批；仅 recent 时限制天数 |
| C-05/06 | 逐季度 DISTINCT    | recent: ~4×2 查询 | 无需优化                   |
| C-07    | 一次 DISTINCT + IN | 仅最新月份        | 无需优化                   |
| C-08    | 两次 DISTINCT      | 全量指数代码      | 缓存结果                   |

**总结**：`recent` 模式下全部对账不超过 80 次 DB 查询，可接受。`full` 模式因指数和历史日期多，建议异步运行、不阻塞同步流程。

---

## 七、存储复用

所有跨表对账结果复用 `DataQualityCheck` 表，`checkType = 'cross-table'`，`dataSet` 字段存对账编号（如 `C-01`）。

```sql
-- 查看最近的跨表对账结果
SELECT * FROM data_quality_checks
WHERE check_type = 'cross-table'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 八、改动影响评估

| 改动                             | 范围                      | 风险               |
| -------------------------------- | ------------------------- | ------------------ |
| 新增 `CrossTableCheckService`    | 新文件                    | 低：不影响现有代码 |
| `DataQualityService` 注入 + 调用 | 构造函数 + `runAllChecks` | 低：仅增加调用     |
| `DataQualityModule` 注册         | providers 数组            | 低                 |
| Controller 增加端点              | 新 POST 端点              | 低                 |

---

## 九、验证计划

| 步骤     | 方式                                                                  | 预期                                |
| -------- | --------------------------------------------------------------------- | ----------------------------------- |
| 编译     | `tsc --noEmit`                                                        | 无类型错误                          |
| 单项运行 | `POST /tushare/admin/quality/cross-check` body `{ "mode": "recent" }` | 返回 8 条对账结果                   |
| 全量运行 | body `{ "mode": "full" }`                                             | C-07/C-08 也执行，返回 8 条         |
| 持久化   | 查 `data_quality_checks` 表                                           | `check_type = 'cross-table'` 有记录 |
| 自动集成 | 触发完整同步后                                                        | 日志中出现跨表对账结果              |

---

## 十、不在本次范围

- 自动补数（发现不一致后自动触发重同步） → Phase 4
- per-stock 级别不一致明细的持久化 → 后续增强
- 可观测性 Dashboard 展示跨表结果 → Phase 4+
