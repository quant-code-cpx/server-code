# 数据质量增强 Phase 2 — 全数据集覆盖 — 后端设计

> **对应总纲**：Task 4（层次 5 — 全数据集纳管）
>
> **前置条件**：Phase 1 已完成（`checkCompleteness` 已支持 `suspendAware`、`DATA_SET_CONFIG` 已含 `suspendAware` 字段）
>
> **涉及文件**：`src/tushare/sync/quality/data-quality.service.ts`（主改动），可能小幅改动 `sync-helper.service.ts`

---

## 一、目标

将目前 `DATA_SET_CONFIG` 中仅覆盖的 9 个行情/事件类数据集，扩展至全部 29 个已同步数据集。不同频率、不同结构的数据集需要不同的检查策略。

---

## 二、数据集分类与检查策略

### 2.1 分类总表

| 类别                 | 检查策略名            | 数据集                                                                                                                     | 说明                                                           |
| -------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **日频行情**         | `daily-trade-date`    | daily, dailyBasic, adjFactor, indexDaily, stkLimit, marginDetail, moneyflow, moneyflowIndDc, moneyflowMktDc, moneyflowHsgt | tradeDate (DateTime) 为主轴；与交易日历对比                    |
| **周频行情**         | `weekly-trade-date`   | weekly                                                                                                                     | tradeDate (DateTime)；对比周末交易日                           |
| **月频行情**         | `monthly-trade-date`  | monthly                                                                                                                    | tradeDate (DateTime)；对比月末交易日                           |
| **事件型（日频）**   | `event-trade-date`    | suspendD, topList, topInst, blockTrade                                                                                     | tradeDate (String)；不是每个交易日都有事件，仅做 timeliness    |
| **事件型（非日频）** | `event-date-field`    | shareFloat                                                                                                                 | floatDate (String)；全量刷新型，仅做 timeliness                |
| **财务报表**         | `financial-report`    | income, balanceSheet, cashflow, express, finaIndicator                                                                     | endDate (DateTime)；按报告期覆盖率检查                         |
| **财务事件**         | `financial-event`     | dividend, top10Holders, top10FloatHolders                                                                                  | endDate (DateTime)；按报告期覆盖率检查，但不要求每个报告期都有 |
| **基础信息**         | `full-refresh`        | stockBasic, tradeCal, stockCompany                                                                                         | 全量刷新型；仅做 timeliness + 记录行数                         |
| **因子（月频）**     | `monthly-string-date` | indexWeight                                                                                                                | tradeDate (String)；月度同步，仅做 timeliness                  |

### 2.2 扩展后的 `DATA_SET_CONFIG` 类型

```typescript
interface DataSetCheckConfig {
  /** Prisma model 名 */
  modelName: string
  /** 日期字段名（用于 aggregate._max 和 completeness 查询） */
  dateField: string
  /** 日期字段类型：DateTime → 需用 Date 对象查询；string → 直接 YYYYMMDD 字符串 */
  dateType: 'datetime' | 'string'
  /** 检查策略 */
  checkStrategy: DataSetCheckStrategy
  /** 是否需要停牌感知（仅行情类） */
  suspendAware?: boolean
  /** 检查深度（天数）；null = 仅 timeliness，不做 completeness */
  completenessDepthDays?: number | null
}

type DataSetCheckStrategy =
  | 'daily-trade-date' // 日频行情：与交易日历逐日对比
  | 'weekly-trade-date' // 周频行情：与每周最后一个交易日对比
  | 'monthly-trade-date' // 月频行情：与每月最后一个交易日对比
  | 'event-trade-date' // 事件型日频：仅 timeliness，不做 completeness
  | 'event-date-field' // 事件型非日频：仅 timeliness
  | 'financial-report' // 财务报表：按报告期覆盖率
  | 'financial-event' // 财务事件：按报告期，但允许部分缺失
  | 'full-refresh' // 全量刷新：仅 timeliness + rowCount
  | 'monthly-string-date' // 月频字符串日期：仅 timeliness
```

### 2.3 完整配置

```typescript
private readonly DATA_SET_CONFIG: Record<string, DataSetCheckConfig> = {
  // ── 日频行情（与交易日历逐日对比）──
  daily:           { modelName: 'daily',           dateField: 'tradeDate', dateType: 'datetime', checkStrategy: 'daily-trade-date', suspendAware: true, completenessDepthDays: 30 },
  dailyBasic:      { modelName: 'dailyBasic',      dateField: 'tradeDate', dateType: 'datetime', checkStrategy: 'daily-trade-date', suspendAware: true, completenessDepthDays: 30 },
  adjFactor:       { modelName: 'adjFactor',       dateField: 'tradeDate', dateType: 'datetime', checkStrategy: 'daily-trade-date', suspendAware: true, completenessDepthDays: 30 },
  indexDaily:      { modelName: 'indexDaily',       dateField: 'tradeDate', dateType: 'datetime', checkStrategy: 'daily-trade-date', completenessDepthDays: 30 },
  marginDetail:    { modelName: 'marginDetail',     dateField: 'tradeDate', dateType: 'datetime', checkStrategy: 'daily-trade-date', completenessDepthDays: 30 },
  moneyflow:       { modelName: 'moneyflow',        dateField: 'tradeDate', dateType: 'datetime', checkStrategy: 'daily-trade-date', completenessDepthDays: 30 },
  moneyflowIndDc:  { modelName: 'moneyflowIndDc',   dateField: 'tradeDate', dateType: 'datetime', checkStrategy: 'daily-trade-date', completenessDepthDays: 30 },
  moneyflowMktDc:  { modelName: 'moneyflowMktDc',   dateField: 'tradeDate', dateType: 'datetime', checkStrategy: 'daily-trade-date', completenessDepthDays: 30 },
  moneyflowHsgt:   { modelName: 'moneyflowHsgt',    dateField: 'tradeDate', dateType: 'datetime', checkStrategy: 'daily-trade-date', completenessDepthDays: 30 },

  // ── 周频/月频行情 ──
  weekly:          { modelName: 'weekly',           dateField: 'tradeDate', dateType: 'datetime', checkStrategy: 'weekly-trade-date', completenessDepthDays: 90 },
  monthly:         { modelName: 'monthly',          dateField: 'tradeDate', dateType: 'datetime', checkStrategy: 'monthly-trade-date', completenessDepthDays: 365 },

  // ── 事件型（日频，不是每天都有事件）──
  stkLimit:        { modelName: 'stkLimit',         dateField: 'tradeDate', dateType: 'string',   checkStrategy: 'daily-trade-date', completenessDepthDays: 30 },
  suspendD:        { modelName: 'suspendD',         dateField: 'tradeDate', dateType: 'string',   checkStrategy: 'event-trade-date' },
  topList:         { modelName: 'topList',          dateField: 'tradeDate', dateType: 'string',   checkStrategy: 'event-trade-date' },
  topInst:         { modelName: 'topInst',          dateField: 'tradeDate', dateType: 'string',   checkStrategy: 'event-trade-date' },
  blockTrade:      { modelName: 'blockTrade',       dateField: 'tradeDate', dateType: 'string',   checkStrategy: 'event-trade-date' },

  // ── 事件型（非日频）──
  shareFloat:      { modelName: 'shareFloat',       dateField: 'floatDate', dateType: 'string',   checkStrategy: 'event-date-field' },

  // ── 财务报表（按报告期覆盖率检查）──
  income:          { modelName: 'income',           dateField: 'endDate',   dateType: 'datetime', checkStrategy: 'financial-report', completenessDepthDays: 365 },
  balanceSheet:    { modelName: 'balanceSheet',     dateField: 'endDate',   dateType: 'datetime', checkStrategy: 'financial-report', completenessDepthDays: 365 },
  cashflow:        { modelName: 'cashflow',         dateField: 'endDate',   dateType: 'datetime', checkStrategy: 'financial-report', completenessDepthDays: 365 },
  express:         { modelName: 'express',          dateField: 'endDate',   dateType: 'datetime', checkStrategy: 'financial-report', completenessDepthDays: 365 },
  finaIndicator:   { modelName: 'finaIndicator',    dateField: 'endDate',   dateType: 'datetime', checkStrategy: 'financial-report', completenessDepthDays: 365 },

  // ── 财务事件（有数据但不要求每个报告期都有）──
  dividend:        { modelName: 'dividend',         dateField: 'endDate',   dateType: 'datetime', checkStrategy: 'financial-event' },
  top10Holders:    { modelName: 'top10Holders',     dateField: 'endDate',   dateType: 'datetime', checkStrategy: 'financial-event' },
  top10FloatHolders: { modelName: 'top10FloatHolders', dateField: 'endDate', dateType: 'datetime', checkStrategy: 'financial-event' },

  // ── 基础信息（全量刷新）──
  stockBasic:      { modelName: 'stockBasic',       dateField: 'listDate',  dateType: 'datetime', checkStrategy: 'full-refresh' },
  tradeCal:        { modelName: 'tradeCal',         dateField: 'calDate',   dateType: 'datetime', checkStrategy: 'full-refresh' },
  stockCompany:    { modelName: 'stockCompany',     dateField: 'annDate',   dateType: 'datetime', checkStrategy: 'full-refresh' },

  // ── 因子（月频字符串日期）──
  indexWeight:     { modelName: 'indexWeight',      dateField: 'tradeDate', dateType: 'string',   checkStrategy: 'monthly-string-date' },
}
```

---

## 三、新增检查方法

### 3.1 `checkTimeliness` 改造

当前 `checkTimeliness` 调用 `helper.getLatestDateString(modelName)` 默认使用 `tradeDate` 字段。需要支持自定义 `dateField`：

```typescript
async checkTimeliness(dataSet: string): Promise<DataQualityReport> {
  const config = this.DATA_SET_CONFIG[dataSet]
  if (!config) {
    return { dataSet, checkType: 'timeliness', status: 'warn', message: `未知数据集: ${dataSet}` }
  }

  // ── 全量刷新型：检查行数和 syncedAt ──
  if (config.checkStrategy === 'full-refresh') {
    return this.checkFullRefreshTimeliness(dataSet, config)
  }

  // ── 财务事件型：只检查是否有数据 ──
  if (config.checkStrategy === 'financial-event') {
    return this.checkFinancialEventTimeliness(dataSet, config)
  }

  // ── 其他：基于最新日期与最近交易日对比 ──
  const latestDate = await this.helper.getLatestDateString(config.modelName, config.dateField)
  const latestTradeDateStr = await this.helper.resolveLatestCompletedTradeDate()

  if (!latestDate) {
    return { dataSet, checkType: 'timeliness', status: 'warn', message: `${dataSet} 暂无数据` }
  }
  if (!latestTradeDateStr) {
    return { dataSet, checkType: 'timeliness', status: 'warn', message: '无法获取最近交易日' }
  }

  // 财务报表用不同的滞后阈值（报告期通常比当前日期晚 1-3 个月）
  const isFinancial = config.checkStrategy === 'financial-report'
  const warnThreshold = isFinancial ? 120 : 3   // 财务数据滞后 120 天 (一个季度+) 才告警
  const failThreshold = isFinancial ? 240 : 7   // 财务数据滞后 240 天 (两个季度+) 才 fail

  const lagDays = this.helper.compareDateString(latestTradeDateStr, latestDate)
  // 对于 financial-report，lag 可能为负（endDate = 20261231 > today），这种是正常的
  const effectiveLag = isFinancial ? Math.max(0, lagDays) : lagDays

  if (effectiveLag === 0) {
    return { dataSet, checkType: 'timeliness', status: 'pass', message: `${dataSet} 数据已是最新（${latestDate}）` }
  } else if (effectiveLag <= warnThreshold) {
    return {
      dataSet, checkType: 'timeliness', status: 'pass',
      message: `${dataSet} 最新日期 ${latestDate}（正常范围内）`,
      details: { latestDate, latestTradeDateStr, lagDays: effectiveLag },
    }
  } else if (effectiveLag <= failThreshold) {
    return {
      dataSet, checkType: 'timeliness', status: 'warn',
      message: `${dataSet} 落后（本地最新: ${latestDate}，最近交易日: ${latestTradeDateStr}）`,
      details: { latestDate, latestTradeDateStr, lagDays: effectiveLag },
    }
  } else {
    return {
      dataSet, checkType: 'timeliness', status: 'fail',
      message: `${dataSet} 严重滞后（本地最新: ${latestDate}，最近交易日: ${latestTradeDateStr}）`,
      details: { latestDate, latestTradeDateStr, lagDays: effectiveLag },
    }
  }
}
```

### 3.2 `checkFullRefreshTimeliness` — 全量刷新型

```typescript
private async checkFullRefreshTimeliness(dataSet: string, config: DataSetCheckConfig): Promise<DataQualityReport> {
  const model = (this.prisma as any)[config.modelName]
  const count = await model.count()

  if (count === 0) {
    return { dataSet, checkType: 'timeliness', status: 'fail', message: `${dataSet} 无数据（表为空）` }
  }

  // 检查最近一条的 syncedAt
  const latest = await model.findFirst({ orderBy: { syncedAt: 'desc' }, select: { syncedAt: true } })
  const lastSyncHoursAgo = latest ? Math.round((Date.now() - new Date(latest.syncedAt).getTime()) / 3600000) : null

  if (lastSyncHoursAgo !== null && lastSyncHoursAgo > 48) {
    return {
      dataSet, checkType: 'timeliness', status: 'warn',
      message: `${dataSet} 最后同步于 ${lastSyncHoursAgo} 小时前（共 ${count} 条）`,
      details: { rowCount: count, lastSyncHoursAgo },
    }
  }

  return {
    dataSet, checkType: 'timeliness', status: 'pass',
    message: `${dataSet} 正常（${count} 条）`,
    details: { rowCount: count, lastSyncHoursAgo },
  }
}
```

### 3.3 `checkFinancialEventTimeliness` — 财务事件型

```typescript
private async checkFinancialEventTimeliness(dataSet: string, config: DataSetCheckConfig): Promise<DataQualityReport> {
  const model = (this.prisma as any)[config.modelName]
  const count = await model.count()

  if (count === 0) {
    return { dataSet, checkType: 'timeliness', status: 'warn', message: `${dataSet} 暂无数据` }
  }

  return {
    dataSet, checkType: 'timeliness', status: 'pass',
    message: `${dataSet} 已有数据（${count} 条）`,
    details: { rowCount: count },
  }
}
```

### 3.4 `checkCompleteness` 策略分发

改造 `checkCompleteness` 为策略路由：

```typescript
async checkCompleteness(dataSet: string, startDate: string, endDate: string): Promise<DataQualityReport | null> {
  const config = this.DATA_SET_CONFIG[dataSet]
  if (!config) {
    return { dataSet, checkType: 'completeness', status: 'warn', message: `未知数据集: ${dataSet}` }
  }

  switch (config.checkStrategy) {
    case 'daily-trade-date':
      return this.checkDailyCompleteness(dataSet, config, startDate, endDate)
    case 'weekly-trade-date':
      return this.checkPeriodicCompleteness(dataSet, config, startDate, endDate, 'week')
    case 'monthly-trade-date':
      return this.checkPeriodicCompleteness(dataSet, config, startDate, endDate, 'month')
    case 'financial-report':
      return this.checkFinancialReportCoverage(dataSet, config)
    // 以下策略不做 completeness 检查
    case 'event-trade-date':
    case 'event-date-field':
    case 'financial-event':
    case 'full-refresh':
    case 'monthly-string-date':
      return null  // 返回 null 表示跳过此检查类型
  }
}
```

### 3.5 `checkDailyCompleteness` — 日频行情完整性

即 Phase 1 中已有的逻辑（含停牌感知），保持不变。将原 `checkCompleteness` 重命名为此方法，增加 `dateType` 感知：

```typescript
private async checkDailyCompleteness(
  dataSet: string,
  config: DataSetCheckConfig,
  startDate: string,
  endDate: string,
): Promise<DataQualityReport> {
  const tradeDates = await this.helper.getOpenTradeDatesBetween(startDate, endDate)
  if (!tradeDates.length) {
    return { dataSet, checkType: 'completeness', status: 'pass', message: `${dataSet} 检查范围内无交易日` }
  }

  // 根据 dateType 构建查询值
  const queryDates = config.dateType === 'datetime'
    ? tradeDates.map((d) => this.helper.toDate(d))
    : tradeDates

  const model = (this.prisma as any)[config.modelName]
  const existingRows = await model.findMany({
    select: { [config.dateField]: true },
    where: { [config.dateField]: { in: queryDates } },
    distinct: [config.dateField],
  })

  const existingDates = new Set<string>(
    existingRows.map((r: Record<string, unknown>) => {
      const val = r[config.dateField]
      return val instanceof Date ? this.helper.formatDate(val) : String(val)
    }),
  )

  // 停牌感知
  let suspendedDates: Set<string> | null = null
  if (config.suspendAware) {
    suspendedDates = await this.getSuspendedTradeDates(startDate, endDate)
  }

  const rawMissing = tradeDates.filter((d) => !existingDates.has(d))
  let missingDates: string[]
  let suspendedCount = 0

  if (suspendedDates && suspendedDates.size > 0) {
    missingDates = []
    for (const d of rawMissing) {
      if (suspendedDates.has(d)) suspendedCount++
      else missingDates.push(d)
    }
  } else {
    missingDates = rawMissing
  }

  if (missingDates.length === 0) {
    const suffix = suspendedCount > 0 ? `（另有 ${suspendedCount} 个停牌日正常缺失）` : ''
    return {
      dataSet, checkType: 'completeness', status: 'pass',
      message: `${dataSet} ${startDate}~${endDate} 数据完整（${tradeDates.length} 个交易日）${suffix}`,
      ...(suspendedCount > 0 ? { details: { suspendedCount } } : {}),
    }
  }

  const missingRatio = missingDates.length / tradeDates.length
  return {
    dataSet, checkType: 'completeness',
    status: missingRatio > 0.1 ? 'fail' : 'warn',
    message: `${dataSet} 缺失 ${missingDates.length}/${tradeDates.length} 个交易日数据` +
      (suspendedCount > 0 ? `（已排除 ${suspendedCount} 个停牌日）` : ''),
    details: { missingDates: missingDates.slice(0, 50), totalMissing: missingDates.length, ...(suspendedCount > 0 && { suspendedCount }) },
  }
}
```

### 3.6 `checkPeriodicCompleteness` — 周频/月频行情完整性

```typescript
private async checkPeriodicCompleteness(
  dataSet: string,
  config: DataSetCheckConfig,
  startDate: string,
  endDate: string,
  unit: 'week' | 'month',
): Promise<DataQualityReport> {
  // 获取每周/月的最后一个交易日作为期望日期
  const expectedDates = await this.helper.getPeriodEndTradeDates(startDate, endDate, unit)
  if (!expectedDates.length) {
    return { dataSet, checkType: 'completeness', status: 'pass', message: `${dataSet} 检查范围内无 ${unit} 期末交易日` }
  }

  const queryDates = expectedDates.map((d) => this.helper.toDate(d))
  const model = (this.prisma as any)[config.modelName]
  const existingRows = await model.findMany({
    select: { [config.dateField]: true },
    where: { [config.dateField]: { in: queryDates } },
    distinct: [config.dateField],
  })

  const existingDates = new Set<string>(
    existingRows.map((r: Record<string, unknown>) => this.helper.formatDate(r[config.dateField] as Date)),
  )

  const missingDates = expectedDates.filter((d) => !existingDates.has(d))

  if (missingDates.length === 0) {
    return {
      dataSet, checkType: 'completeness', status: 'pass',
      message: `${dataSet} ${startDate}~${endDate} 数据完整（${expectedDates.length} 个 ${unit === 'week' ? '周' : '月'}）`,
    }
  }

  const missingRatio = missingDates.length / expectedDates.length
  return {
    dataSet, checkType: 'completeness',
    status: missingRatio > 0.1 ? 'fail' : 'warn',
    message: `${dataSet} 缺失 ${missingDates.length}/${expectedDates.length} 个 ${unit === 'week' ? '周' : '月'} 数据`,
    details: { missingDates: missingDates.slice(0, 50), totalMissing: missingDates.length },
  }
}
```

### 3.7 `checkFinancialReportCoverage` — 财务报表覆盖率

```typescript
private async checkFinancialReportCoverage(
  dataSet: string,
  config: DataSetCheckConfig,
): Promise<DataQualityReport> {
  // 取最近 4 个季度的报告期末
  const recentPeriods = this.helper.buildRecentQuarterPeriods(1)  // 最近 1 年的 4 个季度

  // 统计每个报告期有多少只股票有数据
  const model = (this.prisma as any)[config.modelName]
  const periodDates = recentPeriods.map((p) => this.helper.toDate(p))

  const periodCounts: Array<{ period: string; stockCount: number }> = []

  for (const period of recentPeriods) {
    const count = await model.count({
      where: { endDate: this.helper.toDate(period) },
    })
    periodCounts.push({ period, stockCount: count })
  }

  // 获取总上市股票数作为参照
  const totalStocks = await this.prisma.stockBasic.count({ where: { listStatus: 'L' } })

  const emptyPeriods = periodCounts.filter((p) => p.stockCount === 0)
  const sparsePeriods = periodCounts.filter((p) => p.stockCount > 0 && p.stockCount < totalStocks * 0.3)

  if (emptyPeriods.length === 0 && sparsePeriods.length === 0) {
    return {
      dataSet, checkType: 'completeness', status: 'pass',
      message: `${dataSet} 最近 ${recentPeriods.length} 个报告期覆盖正常`,
      details: { periodCounts, totalStocks },
    }
  }

  const status = emptyPeriods.length > 0 ? 'fail' : 'warn'
  return {
    dataSet, checkType: 'completeness', status,
    message: `${dataSet} ${emptyPeriods.length} 个报告期无数据，${sparsePeriods.length} 个报告期覆盖率低于 30%`,
    details: {
      emptyPeriods: emptyPeriods.map((p) => p.period),
      sparsePeriods: sparsePeriods.map((p) => ({ period: p.period, stockCount: p.stockCount })),
      totalStocks,
      periodCounts,
    },
  }
}
```

---

## 四、`runAllChecks` 改造

```typescript
async runAllChecks(): Promise<void> {
  this.logger.log('[数据质量检查] 开始全量检查')

  const datasets = Object.keys(this.DATA_SET_CONFIG)
  const today = this.helper.getCurrentShanghaiDateString()

  let passCount = 0
  let warnCount = 0
  let failCount = 0

  for (const dataSet of datasets) {
    try {
      const config = this.DATA_SET_CONFIG[dataSet]

      // 1. 时效性检查（所有数据集都做）
      const timelinessReport = await this.checkTimeliness(dataSet)
      await this.writeCheckResult(timelinessReport)
      this.countStatus(timelinessReport.status, passCount, warnCount, failCount)

      // 2. 完整性检查（仅部分数据集做，根据 checkStrategy 路由）
      if (config.completenessDepthDays) {
        const startDate = this.helper.addDays(today, -config.completenessDepthDays)
        const completenessReport = await this.checkCompleteness(dataSet, startDate, today)
        if (completenessReport) {
          await this.writeCheckResult(completenessReport)
          this.countStatus(completenessReport.status, passCount, warnCount, failCount)
        }
      } else if (config.checkStrategy === 'financial-report') {
        // 财务报表不按天数窗口，而是按报告期
        const completenessReport = await this.checkCompleteness(dataSet, '', '')
        if (completenessReport) {
          await this.writeCheckResult(completenessReport)
          this.countStatus(completenessReport.status, passCount, warnCount, failCount)
        }
      }
    } catch (error) {
      this.logger.error(`[数据质量检查] ${dataSet} 检查失败: ${(error as Error).message}`)
    }
  }

  this.logger.log(`[数据质量检查] 完成（${datasets.length} 个数据集）：通过 ${passCount}，警告 ${warnCount}，失败 ${failCount}`)
}
```

---

## 五、`getLatestDateString` 适配

当前 `SyncHelperService.getLatestDateString` 默认 `fieldName = 'tradeDate'`，且假设返回 Date 对象。对于 String 类型日期字段，需要适配：

```typescript
// sync-helper.service.ts — 改造
async getLatestDateString(modelName: string, fieldName = 'tradeDate'): Promise<string | null> {
  const result = await (this.prisma as any)[modelName].aggregate({
    _max: { [fieldName]: true },
  })
  const maxValue = result?._max?.[fieldName]
  if (!maxValue) return null

  // Date 对象 → YYYYMMDD
  if (maxValue instanceof Date) return this.formatDate(maxValue)
  // 已经是 YYYYMMDD 字符串
  if (typeof maxValue === 'string') return maxValue

  return null
}
```

这个改动**向后兼容**：现有调用方不传 `fieldName` 时默认是 `tradeDate`（DateTime 类型），行为不变。

---

## 六、改动影响评估

| 改动                                   | 范围                           | 风险                                                       |
| -------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `DATA_SET_CONFIG` 从 9 → 29 条         | `data-quality.service.ts` 内部 | 低：纯新增配置                                             |
| `checkTimeliness` 增加策略分支         | `data-quality.service.ts`      | 低：新增分支不影响现有 `daily-trade-date` 路径             |
| `checkCompleteness` 改为策略路由       | `data-quality.service.ts`      | 低：原有 daily 逻辑拆为 `checkDailyCompleteness`，行为不变 |
| 新增 3 个 private 方法                 | `data-quality.service.ts`      | 低：private 方法不影响公共 API                             |
| `getLatestDateString` 适配 String 类型 | `sync-helper.service.ts`       | 低：向后兼容                                               |
| `runAllChecks` 改造                    | `data-quality.service.ts`      | 低：用 config 驱动替代硬编码循环                           |

---

## 七、验证计划

| 步骤     | 方式                                              | 预期                                      |
| -------- | ------------------------------------------------- | ----------------------------------------- |
| 编译     | `tsc --noEmit`                                    | 无类型错误                                |
| 启动     | Docker rebuild → 查日志                           | bootstrap 同步后质检覆盖 29 个数据集      |
| 质量报告 | `POST /tushare/admin/quality/report`              | 每个数据集至少有 1 条 timeliness 检查结果 |
| 财务覆盖 | 报告中 income/balanceSheet 等有 periodCounts 明细 | 非空表应有合理的覆盖率                    |
| 周/月频  | weekly/monthly 检查用周末/月末交易日对比          | 不误报                                    |

---

## 八、不在本次范围

- 跨表一致性对账 → Phase 3
- per-stock 级别完整性（每只股票×每天矩阵） → 后续独立 Task
- 自动补数闭环 → Phase 4
