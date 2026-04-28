# OPT-2.2 / 2.3 / 2.4 — 成本敏感性 · 参数扫描 · 策略版本对比 后端设计

> **日期**：2026-04-11
> **优先级**：Phase 2（归因与分析增强）
> **关联**：高级优化待办清单 OPT-2.2 / OPT-2.3 / OPT-2.4

---

## 一、概览

三个优化项均属于"回测结果深度分析 / 策略迭代辅助"范畴，可共用部分基础设施：

| 编号    | 名称           | 核心能力                                      | 复杂度 |
| ------- | -------------- | --------------------------------------------- | ------ |
| OPT-2.2 | 交易成本敏感性 | 基于已有交易记录重算费用，输出参数→指标映射表 | 中     |
| OPT-2.3 | 参数扫描热力图 | 批量创建回测任务，汇总为二维热力图数据        | 高     |
| OPT-2.4 | 策略版本对比   | JSON diff + 回测指标对比                      | 中低   |

---

## 二、OPT-2.2 交易成本敏感性分析

### 2.1 设计思路

已完成回测的 `BacktestTrade` 记录保存了每笔交易的 `side`、`price`、`quantity`、`amount`。重新计算成本**不需要重跑撮合引擎**——只需：

1. 遍历交易记录，按新费率重算每笔的 commission / stampDuty / slippageCost
2. 基于原始 NAV 曲线 + 成本增量差异，重建净值序列
3. 在新净值上计算 totalReturn / sharpeRatio / maxDrawdown

#### 关键公式

原始成本：

$$C_{orig} = commission_{orig} + stampDuty_{orig} + slippage_{orig}$$

新成本：

$$C_{new}(cr, sdr, sbps) = \max(amount \times cr, minComm) + \mathbb{1}_{SELL} \times amount \times sdr + amount \times \frac{sbps}{10000}$$

每日成本增量：

$$\Delta C_d = \sum_{trade \in day_d} (C_{new} - C_{orig})$$

新净值：

$$NAV'_d = NAV_d - \frac{\Delta C_d^{累计}}{initialCapital}$$

> 用 `dailyReturn` 的 NAV 序列做累计调整比逐日重算更高效。

### 2.2 端点

```
POST /backtests/runs/cost-sensitivity
```

### 2.3 请求 DTO — `CostSensitivityDto`

```typescript
export class CostSensitivityDto {
  /** 回测任务 ID */
  runId: string

  /** 佣金率扫描范围（默认 [0.0001, 0.0002, 0.0003, 0.0005, 0.001]） */
  commissionRates?: number[]

  /** 滑点扫描范围（单位 bps，默认 [0, 2, 5, 10, 20]） */
  slippageBpsList?: number[]
}
```

### 2.4 响应 DTO

```typescript
export class CostSensitivityPointDto {
  commissionRate: number
  slippageBps: number
  totalReturn: number
  annualizedReturn: number
  sharpeRatio: number
  maxDrawdown: number
  totalCost: number // 总交易费用（绝对值）
  costReturnRatio: number // 费用占总收益比例
}

export class CostSensitivityResponseDto {
  runId: string
  originalCommissionRate: number
  originalSlippageBps: number
  baselineTotalReturn: number
  points: CostSensitivityPointDto[] // commissionRates × slippageBpsList 笛卡尔积
}
```

### 2.5 算法流程（8 步）

```
1. 校验回测状态（COMPLETED + 所有权）
2. 加载 BacktestTrade（全部记录，按 tradeDate 排序）
3. 加载 BacktestDailyNav（NAV + dailyReturn 序列）
4. 加载 BacktestRun 原始费率参数
5. 构建参数网格：commissionRates × slippageBpsList（最多 5×5=25 组）
6. 对每组参数：
   a. 遍历 trades，计算 C_new 和 C_orig 的差值 ΔC
   b. 按日聚合 ΔC，累计到每日 NAV 上得到 NAV'
   c. 从 NAV' 序列计算 totalReturn / sharpeRatio / maxDrawdown
7. 汇总所有网格点
8. 组装响应
```

### 2.6 性能

- 典型 2 年回测 ≈ 500~2000 条 BacktestTrade，25 组参数下计算量 < 50ms
- 纯内存计算，无 DB 写入

### 2.7 错误处理

| 场景                | 异常                | HTTP |
| ------------------- | ------------------- | ---- |
| 回测不存在          | NotFoundException   | 404  |
| 回测未完成          | BadRequestException | 400  |
| 无权访问            | ForbiddenException  | 403  |
| 无交易记录          | BadRequestException | 400  |
| 参数数组过长（>10） | BadRequestException | 400  |

---

## 三、OPT-2.3 参数扫描热力图

### 3.1 设计思路

参数扫描需要**真正重跑回测引擎**（不同于 OPT-2.2）。方案有两种：

| 方案     | 描述                                  | 优点               | 缺点                        |
| -------- | ------------------------------------- | ------------------ | --------------------------- |
| A 批量   | 为每组参数创建独立 BacktestRun + 入队 | 复用现有引擎，简单 | 生成大量 run 记录，回收麻烦 |
| B 单任务 | 一个 Job 内部循环跑所有参数组合       | 无冗余 run 记录    | 需要引擎支持内存模式        |

**选择方案 A**：复用程度最高，引擎无需改动。通过 `parentRunId` 字段关联到原始 run，方便清理和聚合。

### 3.2 端点

```
POST /backtests/runs/param-sensitivity      — 创建扫描任务
POST /backtests/runs/param-sensitivity/result — 查询扫描结果
```

### 3.3 请求 DTO — `ParamSensitivityDto`

```typescript
export class ParamSweepRange {
  /** 参数在 strategyConfig 中的 JSON path（如 'shortWindow'） */
  paramKey: string
  /** 显示名称（如 '短均线窗口'） */
  label?: string
  /** 扫描值列表（如 [5, 10, 15, 20]） */
  values: number[]
}

export class ParamSensitivityDto {
  /** 基准回测任务 ID（作为模板） */
  runId: string
  /** 参数 X 轴 */
  paramX: ParamSweepRange
  /** 参数 Y 轴 */
  paramY: ParamSweepRange
  /** 评价指标（默认 sharpeRatio） */
  metric?: 'totalReturn' | 'annualizedReturn' | 'sharpeRatio' | 'maxDrawdown' | 'sortinoRatio'
}
```

### 3.4 响应 DTO

```typescript
export class ParamSensitivityResultDto {
  /** 扫描任务 ID */
  sweepId: string
  /** 基准回测 ID */
  baseRunId: string
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PARTIAL'
  /** 总任务数 */
  totalCombinations: number
  /** 已完成数 */
  completedCount: number
  metric: string
  paramX: { key: string; label: string; values: number[] }
  paramY: { key: string; label: string; values: number[] }
  /** 热力图数据：heatmap[xIdx][yIdx] = metricValue | null */
  heatmap: (number | null)[][]
  /** 最优组合 */
  best: { xValue: number; yValue: number; metricValue: number } | null
}
```

### 3.5 Prisma 模型变更

新增 `ParamSweep` 模型，记录一次扫描任务：

```prisma
model ParamSweep {
  id              String   @id @default(cuid())
  userId          Int      @map("user_id")
  baseRunId       String   @map("base_run_id")
  paramXKey       String   @map("param_x_key") @db.VarChar(64)
  paramXLabel     String?  @map("param_x_label") @db.VarChar(64)
  paramXValues    Json     @map("param_x_values")
  paramYKey       String   @map("param_y_key") @db.VarChar(64)
  paramYLabel     String?  @map("param_y_label") @db.VarChar(64)
  paramYValues    Json     @map("param_y_values")
  metric          String   @db.VarChar(32)
  status          String   @db.VarChar(32)
  totalCount      Int      @map("total_count")
  completedCount  Int      @default(0) @map("completed_count")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@index([userId, createdAt(sort: Desc)])
  @@map("param_sweeps")
}
```

同时在 `BacktestRun` 上新增可选关联字段：

```prisma
// 在 BacktestRun 模型中新增：
sweepId   String?  @map("sweep_id")
sweepXIdx Int?     @map("sweep_x_idx")
sweepYIdx Int?     @map("sweep_y_idx")
```

### 3.6 算法流程

**创建扫描（同步返回 sweepId）**：

```
1. 校验基准 run（COMPLETED + 所有权）
2. 校验参数网格大小：|X| × |Y| ≤ 100（防止滥用）
3. 创建 ParamSweep 记录（status='PENDING'）
4. 生成 |X| × |Y| 个 BacktestRun（克隆基准 run 配置，替换对应参数）
5. 批量入队 BullMQ（RUN_BACKTEST），每个 job 携带 sweepId + xIdx + yIdx
6. 更新 ParamSweep status='RUNNING'
7. 返回 sweepId + totalCombinations
```

**查询结果**：

```
1. 查 ParamSweep 记录
2. 查所有关联 BacktestRun（sweepId=?）
3. 按 xIdx/yIdx 填充 heatmap 矩阵
4. 统计完成数，找最优组合
5. 如全部完成 → status='COMPLETED'；部分完成 → 'PARTIAL'
```

### 3.7 BullMQ 集成

回测完成时，现有 `BacktestingProcessor` 已在 `runBacktest()` 中更新 run 状态为 COMPLETED。无需修改 processor——扫描结果通过查询 `BacktestRun` 的指标字段获取：

```typescript
// 汇总逻辑（在 result 查询时）
const runs = await prisma.backtestRun.findMany({
  where: { sweepId },
  select: { sweepXIdx, sweepYIdx, status, sharpeRatio, totalReturn, maxDrawdown, ... }
})
```

### 3.8 性能与限制

- 参数网格上限：`|X| × |Y| ≤ 100`（可配置）
- 每个用户同时活跃的 sweep ≤ 3
- 单个回测 2 年日频约 2~5 秒（取决于策略复杂度），100 任务串行约 3~8 分钟
- BullMQ 默认并发 = 1，如需加速可增加 worker 实例

### 3.9 错误处理

| 场景                     | 处理                                        |
| ------------------------ | ------------------------------------------- |
| 基准 run 不存在 / 未完成 | 400 / 404                                   |
| 参数网格过大（> 100）    | BadRequestException                         |
| 活跃 sweep 超限          | BadRequestException('扫描任务数量已达上限') |
| 部分子 run 失败          | 结果中对应位置 = null，status='PARTIAL'     |

---

## 四、OPT-2.4 策略版本对比

### 4.1 设计思路

当前 `Strategy` 模型有 `version` 字段（每次 `strategyConfig` 变更时 +1），但**不保存历史版本**——旧配置被直接覆盖。

两种方案：

| 方案 | 描述                                             | 优点                     | 缺点                           |
| ---- | ------------------------------------------------ | ------------------------ | ------------------------------ |
| A    | 新增 `StrategyVersion` 历史表                    | 完整版本历史，可随时回滚 | 需要 Prisma 迁移 + schema 变更 |
| B    | 利用 `BacktestRun.strategyConfig` 做隐式版本对比 | 无 schema 变更           | 只有跑过回测的版本才有记录     |

**选择方案 A**：新增 `StrategyVersion` 模型，在 `strategy.update()` 时自动存档。这是正确的做法——策略迭代是量化日常操作，版本历史是刚需。

### 4.2 端点

```
POST /strategies/compare-versions   — 对比两个版本
POST /strategies/versions           — 查询策略版本列表
```

### 4.3 Prisma 模型变更

新增 `StrategyVersion` 模型：

```prisma
model StrategyVersion {
  id               String   @id @default(cuid())
  strategyId       String   @map("strategy_id")
  version          Int
  strategyConfig   Json     @map("strategy_config")
  backtestDefaults Json?    @map("backtest_defaults")
  changelog        String?  @db.Text
  createdAt        DateTime @default(now()) @map("created_at")

  @@unique([strategyId, version])
  @@index([strategyId, version(sort: Desc)])
  @@map("strategy_versions")
}
```

### 4.4 请求 DTO

```typescript
// 版本列表
export class StrategyVersionListDto {
  strategyId: string
}

// 版本对比
export class CompareVersionsDto {
  strategyId: string
  versionA: number
  versionB: number
}
```

### 4.5 响应 DTO

```typescript
export class ConfigDiffItem {
  path: string // JSON path，如 'shortWindow'
  oldValue: unknown
  newValue: unknown
  changeType: 'ADDED' | 'REMOVED' | 'CHANGED'
}

export class VersionMetrics {
  version: number
  runId?: string
  totalReturn?: number
  annualizedReturn?: number
  sharpeRatio?: number
  maxDrawdown?: number
  sortinoRatio?: number
  winRate?: number
}

export class CompareVersionsResponseDto {
  strategyId: string
  strategyName: string
  versionA: number
  versionB: number
  /** 配置差异 */
  configDiff: ConfigDiffItem[]
  /** 回测指标对比（如果版本关联了 BacktestRun） */
  metricsA?: VersionMetrics
  metricsB?: VersionMetrics
}
```

### 4.6 算法流程

**版本存档（自动）**：

```
在 StrategyService.update() 中，当 strategyConfig 发生变化时：
1. 记录当前版本快照到 StrategyVersion（version = 旧版本号）
2. 更新 Strategy（version + 1，新配置覆盖）
```

**版本列表查询**：

```
1. 校验策略存在 + 所有权
2. findMany StrategyVersion where strategyId，orderBy version desc
3. 额外查 Strategy 当前版本拼入列表
```

**版本对比**：

```
1. 校验策略存在 + 所有权
2. 加载 versionA、versionB 的 StrategyVersion（当前版本从 Strategy 主表取）
3. Deep diff：遍历两个 strategyConfig 的所有 key，生成 ConfigDiffItem[]
4. 查询关联回测：BacktestRun where { userId, strategyType, strategyConfig }
   — 或更简单的：通过 Strategy.name + version 匹配
   — 实际做法：查 BacktestRun where { userId, name like 'strategyName v{version}' }
   — 最可靠做法：在 BacktestRun 上新增可选 strategyVersionId 字段
5. 如找到关联回测，取其指标填入 metricsA / metricsB
6. 组装响应
```

### 4.7 JSON Diff 实现

不引入外部依赖，用简单的 shallow-deep 对比即可（strategyConfig 通常是扁平 object）：

```typescript
function diffConfigs(a: Record<string, unknown>, b: Record<string, unknown>): ConfigDiffItem[] {
  const diffs: ConfigDiffItem[] = []
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of allKeys) {
    const inA = key in a,
      inB = key in b
    if (inA && !inB) diffs.push({ path: key, oldValue: a[key], newValue: undefined, changeType: 'REMOVED' })
    else if (!inA && inB) diffs.push({ path: key, oldValue: undefined, newValue: b[key], changeType: 'ADDED' })
    else if (JSON.stringify(a[key]) !== JSON.stringify(b[key]))
      diffs.push({ path: key, oldValue: a[key], newValue: b[key], changeType: 'CHANGED' })
  }
  return diffs
}
```

### 4.8 错误处理

| 场景                | 异常                | HTTP |
| ------------------- | ------------------- | ---- |
| 策略不存在          | NotFoundException   | 404  |
| 无权访问            | ForbiddenException  | 403  |
| 版本不存在          | NotFoundException   | 404  |
| versionA = versionB | BadRequestException | 400  |

---

## 五、数据依赖汇总

| 表                          | OPT-2.2 | OPT-2.3 | OPT-2.4 | 读/写 |
| --------------------------- | ------- | ------- | ------- | ----- |
| BacktestRun                 | 读      | 读+写   | 读      | —     |
| BacktestTrade               | 读      | —       | —       | 读    |
| BacktestDailyNav            | 读      | —       | —       | 读    |
| **ParamSweep（新增）**      | —       | 读+写   | —       | —     |
| Strategy                    | —       | —       | 读+写   | —     |
| **StrategyVersion（新增）** | —       | —       | 读+写   | —     |

---

## 六、文件变更清单

### OPT-2.2 交易成本敏感性

| 操作     | 文件                                                               | 说明                           |
| -------- | ------------------------------------------------------------------ | ------------------------------ |
| **新增** | `src/apps/backtest/dto/cost-sensitivity.dto.ts`                    | DTO + ResponseDTO              |
| **新增** | `src/apps/backtest/services/backtest-cost-sensitivity.service.ts`  | 费用重算 + NAV 重建 + 指标计算 |
| **修改** | `src/apps/backtest/backtest.controller.ts`                         | 新增端点                       |
| **修改** | `src/apps/backtest/backtest.module.ts`                             | 注册 Service                   |
| **新增** | `src/apps/backtest/test/backtest-cost-sensitivity.service.spec.ts` | 单元测试                       |

### OPT-2.3 参数扫描热力图

| 操作     | 文件                                                                | 说明                            |
| -------- | ------------------------------------------------------------------- | ------------------------------- |
| **新增** | `prisma/param_sweep.prisma`                                         | ParamSweep 模型                 |
| **修改** | `prisma/backtest.prisma`                                            | BacktestRun 新增 sweepId 等字段 |
| **新增** | `src/apps/backtest/dto/param-sensitivity.dto.ts`                    | DTO + ResponseDTO               |
| **新增** | `src/apps/backtest/services/backtest-param-sensitivity.service.ts`  | 扫描任务创建 + 结果汇总         |
| **修改** | `src/apps/backtest/backtest.controller.ts`                          | 新增两个端点                    |
| **修改** | `src/apps/backtest/backtest.module.ts`                              | 注册 Service                    |
| **新增** | `src/apps/backtest/test/backtest-param-sensitivity.service.spec.ts` | 单元测试                        |

### OPT-2.4 策略版本对比

| 操作     | 文件                                                      | 说明                                      |
| -------- | --------------------------------------------------------- | ----------------------------------------- |
| **新增** | `prisma/strategy_version.prisma`                          | StrategyVersion 模型                      |
| **修改** | `src/apps/strategy/strategy.service.ts`                   | update() 增加版本存档 + 新增查询/对比方法 |
| **新增** | `src/apps/strategy/dto/strategy-version.dto.ts`           | DTO + ResponseDTO                         |
| **修改** | `src/apps/strategy/strategy.controller.ts`                | 新增两个端点                              |
| **新增** | `src/apps/strategy/test/strategy-version.service.spec.ts` | 单元测试                                  |

---

## 七、实施依赖顺序

```
OPT-2.2（无 schema 变更，纯计算）
  └── 可独立实现，无前置依赖

OPT-2.4（需 Prisma 迁移：StrategyVersion）
  └── 可独立实现，需先跑 prisma migrate

OPT-2.3（需 Prisma 迁移：ParamSweep + BacktestRun 新字段）
  └── 可独立实现，需先跑 prisma migrate
  └── 建议合并 OPT-2.3 + OPT-2.4 的迁移为同一次 migrate
```

推荐实施顺序：**OPT-2.2 → OPT-2.4 → OPT-2.3**（复杂度递增）。

---

## 八、测试计划

### OPT-2.2（8 个场景）

| #   | 场景                        | 预期                                         |
| --- | --------------------------- | -------------------------------------------- |
| 1   | 正常：2 组佣金率 × 2 组滑点 | 返回 4 个 points，指标合理                   |
| 2   | 回测不存在                  | 404                                          |
| 3   | 回测未完成                  | 400                                          |
| 4   | 无权访问                    | 403                                          |
| 5   | 无交易记录                  | 400                                          |
| 6   | 费率=0 → 收益最高           | totalReturn 单调递减（随费率增加）           |
| 7   | 仅扫描佣金率                | slippageBps 使用原始值                       |
| 8   | costReturnRatio 计算正确    | = totalCost / (initialCapital × totalReturn) |

### OPT-2.3（8 个场景）

| #   | 场景                          | 预期                             |
| --- | ----------------------------- | -------------------------------- |
| 1   | 正常创建 3×3 扫描             | 返回 sweepId，9 个 run 入队      |
| 2   | 基准 run 不存在               | 404                              |
| 3   | 参数网格过大（>100）          | 400                              |
| 4   | 查询结果：全部完成            | status=COMPLETED，heatmap 全填充 |
| 5   | 查询结果：部分完成            | status=PARTIAL，未完成位置=null  |
| 6   | 查询结果：最优组合正确        | best 指向 metric 最优的网格点    |
| 7   | 活跃 sweep 超限               | 400                              |
| 8   | 子 run 的 strategyConfig 正确 | 仅替换了 paramX/paramY 对应 key  |

### OPT-2.4（8 个场景）

| #   | 场景                | 预期                                      |
| --- | ------------------- | ----------------------------------------- |
| 1   | 正常对比两个版本    | 返回 configDiff + metrics（如有关联回测） |
| 2   | 策略不存在          | 404                                       |
| 3   | 无权访问            | 403                                       |
| 4   | 版本不存在          | 404                                       |
| 5   | versionA = versionB | 400                                       |
| 6   | 参数新增            | changeType = 'ADDED'                      |
| 7   | 参数删除            | changeType = 'REMOVED'                    |
| 8   | 版本列表查询        | 按版本号降序，包含当前版本                |

---

## 九、安全考量

- 所有端点受 `JwtAuthGuard` 保护
- 回测 / 策略所有权校验：`userId === currentUser.id`
- OPT-2.3 网格大小上限防止资源滥用
- OPT-2.3 活跃 sweep 数量限制防止队列拥堵
- 纯读取端点（OPT-2.2、OPT-2.4 对比）无数据修改风险

---

_最后更新：2026-04-11_
