# 数据质量增强 Phase 4 — 补数闭环与可观测性 — 后端设计

> **对应总纲**：Task 6（层次 4 — 智能调度 + 层次 6 — 可观测性与告警）
>
> **前置条件**：Phase 1-3 已完成（ValidationCollector + 全数据集覆盖 + 跨表对账）
>
> **涉及文件**：新增 `src/tushare/sync/quality/auto-repair.service.ts`，改动 `data-quality.service.ts`、`sync.service.ts`、`events.gateway.ts`、`tushare-admin.controller.ts`

---

## 一、目标

Phase 1-3 解决了"发现问题"：知道哪些数据缺失、哪些跨表不一致。Phase 4 要解决两件事：

1. **自动补数闭环**：质量检查发现 gap 后，自动生成补数任务并执行或入队
2. **可观测性增强**：将质量检查与补数过程的状态推送给前端、暴露结构化指标、支持告警阈值

---

## 二、整体流程图

```
同步完成
  │
  ├─→ Phase 1: runAllChecks()           (timeliness + completeness + validation log)
  │     ├─→ Phase 2: 全策略覆盖         (29 个数据集，按策略分发)
  │     └─→ Phase 3: runRecentCrossChecks()  (跨表对账)
  │
  ├─→ 汇总质量报告
  │     ├── pass / warn / fail 统计
  │     └── gap 明细列表
  │
  ├─→ [★Phase 4] 自动补数决策
  │     ├── fail 项 → 生成 RepairTask
  │     ├── warn 项 → 标记待观察，不自动修复
  │     └── pass 项 → 跳过
  │
  ├─→ [★Phase 4] 执行补数
  │     ├── 入 SyncRetryQueue（复用现有重试基础设施）
  │     └── 补数完成后重新检查该数据集
  │
  └─→ [★Phase 4] 广播最终质量状态
        ├── WebSocket: data_quality_completed
        └── DataQualityCheck 表结构化存储
```

---

## 三、A — 自动补数服务

### 3.1 新增文件

`src/tushare/sync/quality/auto-repair.service.ts`

### 3.2 RepairTask 定义

```typescript
interface RepairTask {
  /** 对应 DataQualityCheck 的检查项标识（如 'daily', 'C-01'） */
  dataSet: string
  /** 补数类型 */
  repairType: 'resync-dates' | 'resync-dataset' | 'no-action'
  /** 需要重同步的日期列表（仅 resync-dates） */
  missingDates?: string[]
  /** 关联的质量检查报告 */
  sourceReport: DataQualityReport
}
```

### 3.3 AutoRepairService 设计

```typescript
@Injectable()
export class AutoRepairService {
  private readonly logger = new Logger(AutoRepairService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly helper: SyncHelperService,
    private readonly dataQuality: DataQualityService,
  ) {}

  /**
   * 根据质量检查结果，生成并执行补数计划。
   * 仅处理 status === 'fail' 的 completeness 检查结果。
   * 返回生成的补数任务列表及执行结果。
   */
  async analyzeAndRepair(reports: DataQualityReport[]): Promise<RepairSummary> {
    const tasks = this.buildRepairTasks(reports)
    const executed = await this.executeRepairTasks(tasks)
    return { totalChecked: reports.length, repairTasks: tasks.length, executed, tasks }
  }

  /** 从质量报告中提取需要补数的任务 */
  private buildRepairTasks(reports: DataQualityReport[]): RepairTask[] { ... }

  /** 执行补数任务（入 RetryQueue 或直接执行） */
  private async executeRepairTasks(tasks: RepairTask[]): Promise<number> { ... }
}

interface RepairSummary {
  totalChecked: number
  repairTasks: number
  executed: number
  tasks: RepairTask[]
}
```

### 3.4 补数决策逻辑

```typescript
private buildRepairTasks(reports: DataQualityReport[]): RepairTask[] {
  const tasks: RepairTask[] = []

  for (const report of reports) {
    // 仅处理 completeness 检查的 fail 结果
    if (report.checkType !== 'completeness' || report.status !== 'fail') continue

    const missingDates = (report.details as any)?.missingDates as string[] | undefined
    const totalMissing = (report.details as any)?.totalMissing as number | undefined

    if (!missingDates || missingDates.length === 0) continue

    // 安全阈值：缺失超过 30 天不自动补数（可能是历史数据问题，需人工介入）
    if (totalMissing && totalMissing > 30) {
      this.logger.warn(
        `[自动补数] ${report.dataSet} 缺失 ${totalMissing} 天，超出安全阈值（30天），跳过自动补数`,
      )
      tasks.push({
        dataSet: report.dataSet,
        repairType: 'no-action',
        sourceReport: report,
      })
      continue
    }

    tasks.push({
      dataSet: report.dataSet,
      repairType: 'resync-dates',
      missingDates,
      sourceReport: report,
    })
  }

  return tasks
}
```

### 3.5 补数执行：复用 SyncRetryQueue

设计原则：**不新建队列**，复用已有的 `TushareSyncRetryQueue` 表。将缺失日期拆分为单日重试任务入队。

```typescript
private async executeRepairTasks(tasks: RepairTask[]): Promise<number> {
  let executedCount = 0

  for (const task of tasks) {
    if (task.repairType !== 'resync-dates' || !task.missingDates?.length) continue

    const taskName = this.resolveTaskName(task.dataSet)
    if (!taskName) {
      this.logger.warn(`[自动补数] 无法将数据集 ${task.dataSet} 映射到同步任务名`)
      continue
    }

    for (const date of task.missingDates) {
      // 检查是否已有相同 task + date 的 PENDING 重试记录
      const existing = await this.prisma.tushareSyncRetryQueue.findFirst({
        where: {
          taskName,
          payload: { path: ['tradeDate'], equals: date },
          status: 'PENDING',
        },
      })

      if (existing) {
        this.logger.debug(`[自动补数] ${taskName}@${date} 已在重试队列中，跳过`)
        continue
      }

      await this.prisma.tushareSyncRetryQueue.create({
        data: {
          taskName,
          payload: { tradeDate: date, source: 'auto-repair' },
          status: 'PENDING',
          retryCount: 0,
          maxRetries: 3,
          nextRetryAt: new Date(), // 立即可被 SyncRetryService 拾取
        },
      })

      executedCount++
    }

    this.logger.log(
      `[自动补数] ${task.dataSet}: ${task.missingDates.length} 个缺失日期已入队`,
    )
  }

  return executedCount
}
```

### 3.6 数据集名 → 同步任务名映射

```typescript
/** 将质量检查使用的 dataSet 名映射到 TushareSyncTaskName */
private readonly DATASET_TO_TASK: Record<string, string> = {
  daily: 'DAILY',
  dailyBasic: 'DAILY_BASIC',
  adjFactor: 'ADJ_FACTOR',
  indexDaily: 'INDEX_DAILY',
  stkLimit: 'STK_LIMIT',
  moneyflow: 'MONEYFLOW_DC',
  moneyflowIndDc: 'MONEYFLOW_IND_DC',
  moneyflowMktDc: 'MONEYFLOW_MKT_DC',
  moneyflowHsgt: 'MONEYFLOW_HSGT',
  weekly: 'WEEKLY',
  monthly: 'MONTHLY',
  marginDetail: 'MARGIN_DETAIL',
  // 财务类采用 per-stock rebuild 模式，不适合按日期补数
  // income/balanceSheet/cashflow/express/finaIndicator → 不入此映射
}

private resolveTaskName(dataSet: string): string | null {
  return this.DATASET_TO_TASK[dataSet] ?? null
}
```

> **说明**：财务类数据（income、balanceSheet 等）采用 per-stock rebuild 同步模式，无法按单日期补数。这些数据集的补数需要触发整个财务数据重建，不在自动补数范围内。Phase 2 的 `financial-report` 策略检查结果为 fail 时，仅生成 `no-action` 任务并记录告警。

---

## 四、B — 补数后重新检查

### 4.1 SyncRetryService 增加 post-repair hook

在 `SyncRetryService` 每批重试执行完毕后，若有 `source: 'auto-repair'` 的任务成功，触发对应数据集的单项质量复查：

```typescript
// sync-retry.service.ts — processRetryQueue 方法末尾追加

// 过滤出 auto-repair 来源且成功的任务
const repairedDataSets = new Set<string>()
for (const item of processedItems) {
  if (item.status === 'SUCCEEDED') {
    const payload = item.payload as { source?: string; tradeDate?: string }
    if (payload?.source === 'auto-repair') {
      const dataSet = this.taskNameToDataSet(item.taskName)
      if (dataSet) repairedDataSets.add(dataSet)
    }
  }
}

// 对每个修复成功的数据集做单项复查
if (repairedDataSets.size > 0) {
  this.logger.log(`[补数复查] 触发 ${repairedDataSets.size} 个数据集的质量复查`)
  for (const dataSet of repairedDataSets) {
    void this.dataQuality
      .checkTimeliness(dataSet)
      .then((report) => this.dataQuality.writeCheckResult(report))
      .catch((e) => this.logger.error(`[补数复查] ${dataSet} timeliness 检查失败: ${e.message}`))
  }
}
```

### 4.2 闭环状态追踪

在 `DataQualityCheck.details` 的 JSON 中追加 `repairStatus` 字段，记录补数进展：

```typescript
// 质量检查写入时（来自自动补数场景）
details: {
  missingDates: [...],
  totalMissing: 5,
  repairStatus: 'queued',      // 已入队
  repairTaskCount: 5,          // 入队任务数
  repairSource: 'auto-repair', // 触发来源
}

// 补数复查后更新
details: {
  previousMissing: 5,
  currentMissing: 0,           // 复查后缺失数
  repairStatus: 'resolved',    // 已修复
}
```

---

## 五、C — 可观测性增强

### 5.1 WebSocket 推送质量检查结果

在 `EventsGateway` 中新增事件：

```typescript
// events.gateway.ts

/** 数据质量检查完成后广播 */
broadcastDataQualityCompleted(summary: QualityCheckSummary): void {
  this.server.emit('data_quality_completed', summary)
}

/** 自动补数任务入队后广播 */
broadcastAutoRepairQueued(summary: RepairSummary): void {
  this.server.emit('auto_repair_queued', summary)
}
```

**QualityCheckSummary 结构**：

```typescript
interface QualityCheckSummary {
  /** 检查时间 */
  checkedAt: string
  /** 检查的数据集数量 */
  totalDataSets: number
  /** 各状态统计 */
  counts: { pass: number; warn: number; fail: number }
  /** fail 项摘要（前 10 条） */
  failures: Array<{ dataSet: string; checkType: string; message: string }>
  /** 跨表对账结果摘要 */
  crossTableCounts: { pass: number; warn: number; fail: number }
  /** 是否触发了自动补数 */
  autoRepairTriggered: boolean
  /** 补数任务数 */
  repairTaskCount: number
}
```

### 5.2 完整的 post-sync 流程改造

改造 `sync.service.ts` 中的 `triggerDataQualityCheckAsync`：

```typescript
private triggerDataQualityCheckAsync(result: RunPlansResult): void {
  if (result.executedTasks.length === 0) return

  void (async () => {
    try {
      // 1. 运行全量质量检查（含跨表对账）
      const reports = await this.dataQualityService.runAllChecksAndCollect()

      // 2. 构建摘要
      const summary = this.buildQualityCheckSummary(reports)

      // 3. 广播质量检查结果
      this.eventsGateway.broadcastDataQualityCompleted(summary)

      // 4. 自动补数（仅有 fail 项时触发）
      if (summary.counts.fail > 0) {
        const repairSummary = await this.autoRepair.analyzeAndRepair(reports)
        summary.autoRepairTriggered = true
        summary.repairTaskCount = repairSummary.executed

        this.eventsGateway.broadcastAutoRepairQueued(repairSummary)
        this.logger.log(
          `[自动补数] 生成 ${repairSummary.repairTasks} 个补数任务，${repairSummary.executed} 个已入队`,
        )
      }
    } catch (error) {
      this.logger.error(`盘后数据质量检查失败: ${(error as Error).message}`)
    }
  })()
}
```

### 5.3 `runAllChecksAndCollect` — 返回全部报告

`DataQualityService` 当前的 `runAllChecks` 只写库不返回结果。新增一个方法返回报告列表：

```typescript
// data-quality.service.ts

async runAllChecksAndCollect(): Promise<DataQualityReport[]> {
  this.logger.log('[数据质量检查] 开始全量检查')

  const datasets = Object.keys(this.DATA_SET_CONFIG)
  const today = this.helper.getCurrentShanghaiDateString()
  const allReports: DataQualityReport[] = []

  for (const dataSet of datasets) {
    try {
      const config = this.DATA_SET_CONFIG[dataSet]

      // timeliness
      const timelinessReport = await this.checkTimeliness(dataSet)
      await this.writeCheckResult(timelinessReport)
      allReports.push(timelinessReport)

      // completeness（根据策略路由）
      if (config.completenessDepthDays) {
        const startDate = this.helper.addDays(today, -config.completenessDepthDays)
        const completenessReport = await this.checkCompleteness(dataSet, startDate, today)
        if (completenessReport) {
          await this.writeCheckResult(completenessReport)
          allReports.push(completenessReport)
        }
      } else if (config.checkStrategy === 'financial-report') {
        const completenessReport = await this.checkCompleteness(dataSet, '', '')
        if (completenessReport) {
          await this.writeCheckResult(completenessReport)
          allReports.push(completenessReport)
        }
      }
    } catch (error) {
      this.logger.error(`[数据质量检查] ${dataSet} 检查失败: ${(error as Error).message}`)
    }
  }

  // 跨表对账
  try {
    const crossReports = await this.crossTableCheck.runRecentCrossChecks()
    for (const report of crossReports) {
      await this.writeCheckResult(report)
      allReports.push(report)
    }
  } catch (error) {
    this.logger.error(`[数据质量检查] 跨表对账失败: ${(error as Error).message}`)
  }

  const pass = allReports.filter((r) => r.status === 'pass').length
  const warn = allReports.filter((r) => r.status === 'warn').length
  const fail = allReports.filter((r) => r.status === 'fail').length
  this.logger.log(`[数据质量检查] 完成（${allReports.length} 项）：通过 ${pass}，警告 ${warn}，失败 ${fail}`)

  return allReports
}
```

### 5.4 Controller 新增端点

```typescript
// tushare-admin.controller.ts — 新增

/** 查看质量检查摘要（聚合统计） */
@Post('admin/quality/summary')
async getQualitySummary(): Promise<QualityCheckSummary> {
  // 查询最近一轮检查结果，聚合为摘要
  const recentChecks = await this.dataQuality.getRecentChecks(1)
  return this.buildSummaryFromChecks(recentChecks)
}

/** 手动触发自动补数（基于最近一轮检查结果） */
@Post('admin/quality/repair')
async triggerAutoRepair(): Promise<RepairSummary> {
  const reports = await this.dataQuality.getRecentReportsAsQualityReports(1)
  return this.autoRepair.analyzeAndRepair(reports)
}

/** 查看补数任务队列状态 */
@Post('admin/quality/repair-status')
async getRepairStatus(): Promise<{
  pending: number
  retrying: number
  succeeded: number
  exhausted: number
}> {
  const [pending, retrying, succeeded, exhausted] = await Promise.all([
    this.prisma.tushareSyncRetryQueue.count({
      where: { payload: { path: ['source'], equals: 'auto-repair' }, status: 'PENDING' },
    }),
    this.prisma.tushareSyncRetryQueue.count({
      where: { payload: { path: ['source'], equals: 'auto-repair' }, status: 'RETRYING' },
    }),
    this.prisma.tushareSyncRetryQueue.count({
      where: { payload: { path: ['source'], equals: 'auto-repair' }, status: 'SUCCEEDED' },
    }),
    this.prisma.tushareSyncRetryQueue.count({
      where: { payload: { path: ['source'], equals: 'auto-repair' }, status: 'EXHAUSTED' },
    }),
  ])
  return { pending, retrying, succeeded, exhausted }
}
```

---

## 六、D — 告警阈值与日志结构化

### 6.1 告警级别定义

在 `AutoRepairService` 中定义触发告警的阈值：

```typescript
private readonly ALERT_THRESHOLDS = {
  /** completeness fail 数据集超过此数量 → 错误级日志 */
  maxFailDataSets: 5,
  /** 跨表对账 fail 数量阈值 */
  maxCrossTableFails: 3,
  /** 自动补数入队超过此数量 → 警告级日志（可能是大面积数据丢失） */
  maxRepairTasks: 20,
  /** 补数重试 exhausted 超过此数量 → 需要人工介入 */
  maxExhausted: 5,
}
```

### 6.2 告警日志

在 `analyzeAndRepair` 完成后输出结构化告警：

```typescript
private emitAlerts(reports: DataQualityReport[], repairSummary: RepairSummary): void {
  const failCount = reports.filter((r) => r.status === 'fail').length
  const crossFails = reports.filter((r) => r.checkType === 'cross-table' && r.status === 'fail').length

  if (failCount > this.ALERT_THRESHOLDS.maxFailDataSets) {
    this.logger.error(
      `[数据质量告警] ${failCount} 个数据集质量检查失败，超出阈值 ${this.ALERT_THRESHOLDS.maxFailDataSets}`,
    )
  }

  if (crossFails > this.ALERT_THRESHOLDS.maxCrossTableFails) {
    this.logger.error(
      `[数据质量告警] ${crossFails} 项跨表对账失败，超出阈值 ${this.ALERT_THRESHOLDS.maxCrossTableFails}`,
    )
  }

  if (repairSummary.executed > this.ALERT_THRESHOLDS.maxRepairTasks) {
    this.logger.warn(
      `[数据质量告警] 自动补数入队 ${repairSummary.executed} 个任务，超出安全阈值 ${this.ALERT_THRESHOLDS.maxRepairTasks}，可能存在大面积数据丢失`,
    )
  }
}
```

### 6.3 健康端点扩展

在现有 `GET /ready` 端点的基础上，增加数据质量维度：

```typescript
// 不修改现有 health.controller.ts
// 改为在 tushare-admin.controller.ts 中新增

/** 数据质量健康状态（供运维监控） */
@Post('admin/quality/health')
async getQualityHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy'
  lastCheckAt: string | null
  failCount: number
  exhaustedRepairs: number
}> {
  // 查最近一轮检查
  const recentChecks = await this.prisma.dataQualityCheck.findMany({
    where: {
      createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) }, // 最近 24 小时
    },
    orderBy: { createdAt: 'desc' },
  })

  const failCount = recentChecks.filter((c) => c.status === 'fail').length
  const lastCheck = recentChecks[0]

  const exhaustedRepairs = await this.prisma.tushareSyncRetryQueue.count({
    where: {
      payload: { path: ['source'], equals: 'auto-repair' },
      status: 'EXHAUSTED',
      updatedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
    },
  })

  let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'
  if (failCount > 5 || exhaustedRepairs > 3) status = 'unhealthy'
  else if (failCount > 0 || exhaustedRepairs > 0) status = 'degraded'

  return {
    status,
    lastCheckAt: lastCheck?.createdAt?.toISOString() ?? null,
    failCount,
    exhaustedRepairs,
  }
}
```

---

## 七、E — 防重入与频率控制

### 7.1 问题

同步可能短时间内多次完成（如手动触发 + 定时并发），导致质量检查和补数重复执行。

### 7.2 方案

使用 Redis 分布式锁控制并发：

```typescript
// data-quality.service.ts

private readonly QUALITY_CHECK_LOCK_KEY = 'data-quality:running'
private readonly QUALITY_CHECK_LOCK_TTL = 600 // 10 分钟超时

async runAllChecksAndCollect(): Promise<DataQualityReport[]> {
  // 获取锁
  const acquired = await this.redis.set(
    this.QUALITY_CHECK_LOCK_KEY, '1', 'EX', this.QUALITY_CHECK_LOCK_TTL, 'NX',
  )
  if (!acquired) {
    this.logger.warn('[数据质量检查] 已有检查任务在运行中，跳过本次')
    return []
  }

  try {
    // ... 执行检查逻辑（同 5.3 节）...
    return allReports
  } finally {
    await this.redis.del(this.QUALITY_CHECK_LOCK_KEY)
  }
}
```

### 7.3 补数入队去重

已在 3.5 节 `executeRepairTasks` 中实现：入队前检查是否已有相同 `taskName + tradeDate + PENDING` 的记录，避免重复入队。

---

## 八、改动总览

| 改动                              | 文件                                              | 性质          | 风险                        |
| --------------------------------- | ------------------------------------------------- | ------------- | --------------------------- |
| 新增 `AutoRepairService`          | `src/tushare/sync/quality/auto-repair.service.ts` | 新文件        | 低                          |
| `runAllChecksAndCollect`          | `data-quality.service.ts`                         | 新增方法      | 低：不改现有 `runAllChecks` |
| Redis 防重入锁                    | `data-quality.service.ts`                         | 改动          | 低：仅包裹                  |
| post-sync hook 改造               | `sync.service.ts`                                 | 改动          | 低：异步非阻塞              |
| WebSocket 新事件                  | `events.gateway.ts`                               | 新增 2 个方法 | 低                          |
| Controller 新增 3 个端点          | `tushare-admin.controller.ts`                     | 新增          | 低                          |
| SyncRetryService post-repair hook | `sync-retry.service.ts`                           | 小改          | 低                          |

---

## 九、新增 API 端点汇总

| 路由                                   | 方法 | 说明                         | 权限        |
| -------------------------------------- | ---- | ---------------------------- | ----------- |
| `/tushare/admin/quality/summary`       | POST | 查询最近一轮质量检查聚合统计 | SUPER_ADMIN |
| `/tushare/admin/quality/repair`        | POST | 手动触发自动补数             | SUPER_ADMIN |
| `/tushare/admin/quality/repair-status` | POST | 查看补数任务队列状态         | SUPER_ADMIN |
| `/tushare/admin/quality/health`        | POST | 数据质量健康状态（运维监控） | SUPER_ADMIN |

### WebSocket 新事件

| 事件名                   | 说明             | 负载                  |
| ------------------------ | ---------------- | --------------------- |
| `data_quality_completed` | 质量检查完成     | `QualityCheckSummary` |
| `auto_repair_queued`     | 自动补数任务入队 | `RepairSummary`       |

---

## 十、验证计划

| 步骤      | 方式                                          | 预期                                                       |
| --------- | --------------------------------------------- | ---------------------------------------------------------- |
| 编译      | `tsc --noEmit`                                | 无类型错误                                                 |
| 启动      | Docker rebuild → 查日志                       | 同步后自动触发质量检查 + 补数决策日志                      |
| 自动补数  | 模拟缺失场景（删除某日 daily 数据后触发同步） | 质量检查 fail → 补数入队 → 重试成功 → 复查 pass            |
| 防重入    | 快速连续触发两次同步                          | 第二次质量检查被跳过                                       |
| WebSocket | 前端连接 WS，观察事件                         | 收到 `data_quality_completed` 和 `auto_repair_queued` 事件 |
| 摘要端点  | `POST /tushare/admin/quality/summary`         | 返回最新一轮检查的聚合统计                                 |
| 补数状态  | `POST /tushare/admin/quality/repair-status`   | 返回 pending/retrying/succeeded/exhausted 各状态计数       |
| 健康端点  | `POST /tushare/admin/quality/health`          | 返回 healthy/degraded/unhealthy 状态                       |

---

## 十一、安全考量

| 风险                                                | 缓解措施                                                                                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 补数死循环（检查 fail → 补数 → 仍然 fail → 再补数） | 补数仅在 post-sync 触发一次；补数重试由 RetryQueue 的 maxRetries=3 控制；exhausted 后不再重试 |
| 大面积数据丢失触发海量补数任务                      | `totalMissing > 30` 安全阈值拒绝自动补数；告警日志提醒人工介入                                |
| 补数任务淹没正常同步                                | 补数入 RetryQueue，每批最多处理 10 个（现有限制），不与正常同步竞争                           |
| Redis 锁泄漏                                        | TTL=600s 自动过期；finally 块主动释放                                                         |

---

## 十二、不在本次范围

- 前端质量仪表盘 UI（需前端配合）
- 外部告警通道（邮件 / 钉钉 / 企微通知）→ 后续按需
- per-stock 级别 completeness 补数（粒度更细，需单独设计）
- 财务类数据的自动重建（需要调用 per-stock rebuild 流程，复杂度高）
