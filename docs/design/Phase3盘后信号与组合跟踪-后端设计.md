# OPT-3.1 / 3.2 / 3.3 — 盘后信号生成 · 组合绩效跟踪 · 策略漂移检测 后端设计

> **日期**：2026-04-11
> **优先级**：Phase 3（盘后信号与组合跟踪）
> **关联**：高级优化待办清单 OPT-3.1 / OPT-3.2 / OPT-3.3
> **前置已完成**：Phase 1（OPT-1.1~1.4）、 Phase 2（OPT-2.1~2.4）

---

## 一、概览

Phase 3 的三项优化围绕"缩小回测与实战差距"，形成 **信号生成 → 绩效跟踪 → 漂移检测** 闭环：

| 编号 | 名称 | 核心能力 | 复杂度 |
|------|------|----------|--------|
| OPT-3.1 | 盘后信号生成引擎 | 策略挂载定时任务，在 Tushare 同步完成后自动在最新截面数据上生成次日买卖信号 | 高 |
| OPT-3.2 | 组合绩效跟踪 | 计算组合累计收益曲线并与基准对比，输出超额收益、跟踪误差、信息比率 | 中 |
| OPT-3.3 | 策略漂移检测 | 对比当前持仓与最新信号的偏离度，超阈值触发告警并推送 WebSocket | 中 |

### 数据流全景

```
Tushare 同步完成
  │
  ├──→ OPT-3.1 信号引擎（盘后自动运行已激活策略）
  │       │
  │       ├── 信号入库（TradingSignal）
  │       ├── WebSocket 推送 signal_generated
  │       └── OPT-3.3 漂移检测（对比信号 vs 当前持仓）
  │               │
  │               └── 超阈值 → WebSocket 推送 drift_alert
  │
  └──→ OPT-3.2 绩效跟踪（按需查询 / 可叠加回测预期 vs 实际）
```

### 与现有模块的关系

| 依赖方 | 被依赖方 | 依赖内容 |
|--------|----------|----------|
| SignalModule (新) | BacktestModule | `BacktestStrategyRegistryService`（获取策略实例）、`BacktestDataService`（加载截面数据） |
| SignalModule (新) | WebsocketModule | `EventsGateway`（推送信号与漂移告警） |
| SignalModule (新) | PortfolioModule | `PortfolioService.assertOwner()`（漂移检测时验证组合权限） |
| PortfolioModule | — | 新增 `PortfolioPerformanceService`（不引入额外模块依赖，直接 Prisma 查询 `IndexDaily`） |

---

## 二、OPT-3.1 盘后信号生成引擎

### 2.1 设计思路

#### 触发时机

现有 `TushareSyncService` 在同步完成时分别调用 `triggerHeatmapSnapshotAsync()` 和 `triggerDataQualityCheckAsync()`。信号引擎采用**同样模式**——在 `sync.service.ts` 中新增一行 `triggerSignalGenerationAsync(result)` 即可，无需引入 EventEmitter。

> 为什么不用 `@Cron` 固定 19:00？因为 Tushare 同步耗时不确定（5~30 分钟），固定时间可能在数据尚未就绪时触发。采用 sync-complete 钩子可确保数据已入库。

#### 信号生成流程

```
triggerSignalGenerationAsync()
  │
  ├─ 1. 查询所有 isActive=true 的 SignalActivation 记录
  ├─ 2. 对每条记录加载 Strategy.strategyConfig
  ├─ 3. 加载最新截面数据（最近一个交易日的 DailyBar）
  ├─ 4. 调用 strategy.generateSignal(latestTradeDate, ...)
  ├─ 5. 信号入库 → TradingSignal 表
  ├─ 6. WebSocket 推送 signal_generated 给关联用户
  └─ 7. 若关联了 portfolioId → 触发 OPT-3.3 漂移检测
```

#### 复用策略引擎

`IBacktestStrategy.generateSignal()` 接口签名：

```typescript
generateSignal(
  signalDate: Date,
  config: BacktestConfig<T>,
  barData: Map<string, DailyBar>,
  historicalBars: Map<string, DailyBar[]>,
  prisma: PrismaService,
): Promise<SignalOutput>
```

该接口**不依赖回测上下文**，可直接在信号引擎中调用。需要构造的数据：

- `signalDate` = 最近交易日
- `barData` = 该日全市场 DailyBar（通过 `BacktestDataService.loadDailyBars()` 获取）
- `historicalBars` = 过去 N 天历史数据（N 由策略决定，如均线策略需要 250 天）
- `config` = 从 Strategy 记录构造，universe / benchmarkTsCode 等取 backtestDefaults

### 2.2 数据模型

#### `prisma/trading_signal.prisma`

```prisma
/// 盘后信号（由已激活策略在 Tushare 同步完成后自动生成）
model TradingSignal {
  id           String   @id @default(cuid())
  activationId String   @map("activation_id")
  strategyId   String   @map("strategy_id")
  userId       Int      @map("user_id")
  tradeDate    DateTime @map("trade_date") @db.Date    /// 信号生成日期（截面数据日期）
  tsCode       String   @map("ts_code") @db.VarChar(15)
  action       String   @db.VarChar(16)               /// BUY / SELL / HOLD
  targetWeight Float?   @map("target_weight")          /// 目标权重（0~1）
  confidence   Float?                                  /// 信号置信度（0~1，可选）
  createdAt    DateTime @default(now()) @map("created_at")

  @@unique([activationId, tradeDate, tsCode])
  @@index([userId, tradeDate(sort: Desc)])
  @@index([strategyId, tradeDate(sort: Desc)])
  @@map("trading_signals")
}

/// 策略信号激活状态（用户为策略开启/关闭每日信号生成）
model SignalActivation {
  id           String   @id @default(cuid())
  userId       Int      @map("user_id")
  strategyId   String   @map("strategy_id")
  portfolioId  String?  @map("portfolio_id")           /// 可选：关联组合，信号生成后自动做漂移检测
  isActive     Boolean  @default(true) @map("is_active")
  universe     String   @default("ALL_A") @db.VarChar(32)  /// 信号宇宙（默认与策略 backtestDefaults 一致）
  benchmarkTsCode String @default("000300.SH") @map("benchmark_ts_code") @db.VarChar(16)
  lookbackDays Int      @default(250) @map("lookback_days")  /// 策略所需回看天数
  lastSignalDate DateTime? @map("last_signal_date") @db.Date
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@unique([userId, strategyId])
  @@index([isActive])
  @@map("signal_activations")
}
```

### 2.3 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/signal/strategies/activate` | 激活策略的每日信号生成 |
| POST | `/signal/strategies/deactivate` | 停用策略信号生成 |
| POST | `/signal/strategies/list` | 查询已激活策略列表 |
| POST | `/signal/latest` | 查询最新信号（按策略、日期筛选） |
| POST | `/signal/history` | 查询信号历史（分页） |

### 2.4 请求/响应 DTO

#### `ActivateSignalDto`

```typescript
export class ActivateSignalDto {
  /** 策略 ID */
  strategyId: string

  /** 可选：关联组合 ID（关联后信号生成时自动做漂移检测） */
  portfolioId?: string

  /** 信号宇宙（默认取策略 backtestDefaults.universe 或 ALL_A） */
  universe?: string

  /** 基准指数（默认取策略 backtestDefaults.benchmarkTsCode 或 000300.SH） */
  benchmarkTsCode?: string

  /** 策略所需回看天数（默认 250，均线策略按最大窗口设定） */
  lookbackDays?: number
}
```

#### `DeactivateSignalDto`

```typescript
export class DeactivateSignalDto {
  strategyId: string
}
```

#### `LatestSignalQueryDto`

```typescript
export class LatestSignalQueryDto {
  /** 按策略 ID 筛选（可选） */
  strategyId?: string

  /** 查询指定日期的信号（默认最近一个交易日） */
  tradeDate?: string
}
```

#### `SignalHistoryQueryDto`

```typescript
export class SignalHistoryQueryDto {
  strategyId: string
  startDate?: string
  endDate?: string
  page?: number       // 默认 1
  pageSize?: number   // 默认 20
}
```

#### `TradingSignalItemDto`（响应子项）

```typescript
export class TradingSignalItemDto {
  tsCode: string
  stockName: string  // 从 StockBasic 关联查询
  action: 'BUY' | 'SELL' | 'HOLD'
  targetWeight: number | null
  confidence: number | null
}

export class LatestSignalResponseDto {
  strategyId: string
  strategyName: string
  tradeDate: string
  signals: TradingSignalItemDto[]
  generatedAt: string
}
```

### 2.5 核心 Service — `SignalGenerationService`

```typescript
@Injectable()
export class SignalGenerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strategyRegistry: BacktestStrategyRegistryService,
    private readonly dataService: BacktestDataService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * 由 TushareSyncService 在同步完成后异步调用。
   * 遍历所有激活策略，逐一生成信号。
   */
  async generateAllSignals(targetTradeDate?: string): Promise<void>

  /**
   * 为单个激活策略生成信号。
   */
  async generateForActivation(activationId: string): Promise<TradingSignal[]>
}
```

#### 算法步骤 — `generateAllSignals()`

1. 查询最近交易日 `latestTradeDate`（从 `TradeCal` 取 `isOpen='1'` 且 `≤ today`）
2. 查询 `SignalActivation` WHERE `isActive = true AND lastSignalDate != latestTradeDate`
3. 对每条 activation：
   - a. 加载 `Strategy` 记录，获取 `strategyType` + `strategyConfig`
   - b. 获取策略实例：`strategyRegistry.getStrategy(strategyType)`
   - c. 若策略有 `initialize()`，先调用
   - d. 计算回看起始日 `lookbackStart = latestTradeDate - activation.lookbackDays 个交易日`
   - e. 加载宇宙股池（通过 `BacktestDataService.resolveUniverse()`）
   - f. 加载截面数据 `loadDailyBars(tsCodes, lookbackStart, latestTradeDate)` → `Map<tsCode, Map<dateStr, DailyBar>>`
   - g. 构建 `barData`（当天）和 `historicalBars`（按 tsCode 分组的 DailyBar[]）
   - h. 调用 `strategy.generateSignal(latestTradeDate, config, barData, historicalBars, prisma)`
   - i. 解析 `SignalOutput.targets[]` → 按当前持仓对比确定 action（BUY/SELL/HOLD）
   - j. 批量写入 `TradingSignal`（使用 `createMany` + `skipDuplicates`）
   - k. 更新 `SignalActivation.lastSignalDate = latestTradeDate`
   - l. WebSocket 推送 `emitToUser(userId, 'signal_generated', { strategyId, tradeDate, signalCount })`
   - m. 若 `activation.portfolioId` 存在 → 异步触发漂移检测（OPT-3.3）

4. 捕获单策略异常 → 记录日志但不阻塞其他策略

#### Action 判定逻辑

```typescript
function deriveAction(
  currentHoldings: Set<string>,    // 当前组合持仓 tsCode 集合
  newTargets: Map<string, number>, // 新信号目标权重
): { tsCode: string; action: 'BUY' | 'SELL' | 'HOLD'; targetWeight: number }[] {
  const result = []

  // 新目标中有但当前持仓没有 → BUY
  for (const [ts, weight] of newTargets) {
    if (!currentHoldings.has(ts)) {
      result.push({ tsCode: ts, action: 'BUY', targetWeight: weight })
    } else {
      result.push({ tsCode: ts, action: 'HOLD', targetWeight: weight })
    }
  }

  // 当前持仓中有但新目标没有 → SELL
  for (const ts of currentHoldings) {
    if (!newTargets.has(ts)) {
      result.push({ tsCode: ts, action: 'SELL', targetWeight: 0 })
    }
  }
  return result
}
```

> 若 activation 未关联组合（`portfolioId` 为 null），则不做 action 判定——所有 targets 均记为 `BUY`（纯信号，不含组合上下文）。

### 2.6 与 TushareSyncService 的集成

在 `TushareSyncService` 中新增一行调用（与 `triggerHeatmapSnapshotAsync` 同级）：

```typescript
// sync.service.ts — 同步完成后的异步后处理
this.triggerHeatmapSnapshotAsync(result)
this.triggerDataQualityCheckAsync(result)
this.triggerSignalGenerationAsync(result)   // ← 新增
```

```typescript
private triggerSignalGenerationAsync(result: RunPlansResult): void {
  if (result.executedTasks.length === 0) return
  void this.signalGenerationService
    .generateAllSignals(result.targetTradeDate ?? undefined)
    .catch((err) => {
      this.logger.warn(`信号生成失败（不影响主同步流程）：${(err as Error).message}`)
    })
}
```

**模块依赖**：`TushareModule` 需 import `SignalModule` 并获取 `SignalGenerationService`。或者，`SignalModule` export `SignalGenerationService`，在 `TushareModule` 中通过 `forwardRef(() => SignalModule)` 注入。

### 2.7 文件列表

| 操作 | 文件 |
|------|------|
| 新增 | `prisma/trading_signal.prisma` |
| 新增 | `src/apps/signal/signal.module.ts` |
| 新增 | `src/apps/signal/signal.controller.ts` |
| 新增 | `src/apps/signal/signal.service.ts` — 激活 / 停用 / 查询 CRUD |
| 新增 | `src/apps/signal/signal-generation.service.ts` — 核心信号生成逻辑 |
| 新增 | `src/apps/signal/dto/signal.dto.ts` |
| 新增 | `src/apps/signal/test/signal.service.spec.ts` |
| 新增 | `src/apps/signal/test/signal-generation.service.spec.ts` |
| 修改 | `src/tushare/sync/sync.service.ts` — 添加 `triggerSignalGenerationAsync()` |
| 修改 | `src/tushare/tushare.module.ts` — import SignalModule |
| 修改 | `src/app.module.ts` — 注册 SignalModule |

### 2.8 测试计划

| # | 测试用例 | 覆盖点 |
|---|----------|--------|
| 1 | 激活策略 → 策略不存在 → NotFoundException | 基本校验 |
| 2 | 激活策略 → 成功 → 创建 SignalActivation | 正常流程 |
| 3 | 重复激活 → 更新已有记录（幂等） | 幂等设计 |
| 4 | 停用策略 → isActive=false | 停用流程 |
| 5 | generateForActivation → 正确调用 generateSignal | 核心链路 |
| 6 | generateForActivation → 信号入库 + action 判定正确 | 信号写入 |
| 7 | generateAllSignals → 跳过已生成过的日期 | 幂等重入 |
| 8 | generateAllSignals → 单策略异常不阻塞其他 | 容错 |
| 9 | 查询最新信号 → 按 strategyId + tradeDate 筛选 | 查询接口 |
| 10 | 信号历史 → 分页正确 | 分页 |

---

## 三、OPT-3.2 组合绩效跟踪（vs 基准）

### 3.1 设计思路

现有 `PortfolioService.calcPnlHistory()` 计算的 NAV 是 `marketValue / costBasis`（成本基准净值），但**缺少基准对比**和风险指标。OPT-3.2 需要：

1. 构建组合**绝对净值曲线**（基于初始本金归一化）
2. 构建**基准净值曲线**（沪深300 或自选指数，数据来自已同步的 `IndexDaily`）
3. 计算**相对收益指标**：超额收益、跟踪误差、信息比率
4. 若组合关联了回测，叠加**回测预期 NAV** vs **实际 NAV** 对比

#### 净值计算公式

$$NAV_t = \frac{Cash_t + \sum_{i} (Qty_i \times Close_{i,t})}{InitialCash}$$

> 由于 Portfolio 持仓是**静态快照**（手动调整），不记录历史变更。所以日级净值只能基于 **当前持仓 × 历史收盘价** 回算——这在持仓变更不频繁时是合理近似。

#### 基准净值

$$BenchmarkNAV_t = \frac{Close_{bench,t}}{Close_{bench,t_0}}$$

其中 $t_0$ 为组合创建日或查询起始日。

#### 关键指标

**超额日收益**：

$$ExcessReturn_t = R_{portfolio,t} - R_{benchmark,t}$$

**跟踪误差**（年化）：

$$TrackingError = \sigma_{excess} \times \sqrt{252}$$

其中 $\sigma_{excess}$ 为超额日收益的标准差。

**信息比率**：

$$IR = \frac{\bar{R}_{excess} \times 252}{TrackingError}$$

**累计超额收益**：

$$CumulativeExcess_T = \prod_{t=1}^{T}(1 + ExcessReturn_t) - 1$$

### 3.2 端点

```
POST /portfolio/performance
```

### 3.3 请求/响应 DTO

#### `PortfolioPerformanceDto`

```typescript
export class PortfolioPerformanceDto {
  /** 组合 ID */
  portfolioId: string

  /** 查询起始日期（YYYYMMDD，默认组合创建日） */
  startDate?: string

  /** 查询终止日期（YYYYMMDD，默认最近交易日） */
  endDate?: string

  /** 基准指数代码（默认 000300.SH） */
  benchmarkTsCode?: string
}
```

#### `PortfolioPerformanceResponseDto`

```typescript
export class PerformanceDailyItem {
  date: string
  portfolioNav: number
  benchmarkNav: number
  dailyReturn: number
  benchmarkReturn: number
  excessReturn: number
  cumulativeExcess: number
}

export class PerformanceMetrics {
  /** 组合期间总收益率 */
  totalReturn: number
  /** 基准期间总收益率 */
  benchmarkTotalReturn: number
  /** 累计超额收益 */
  cumulativeExcessReturn: number
  /** 年化收益率 */
  annualizedReturn: number
  /** 年化波动率 */
  annualizedVolatility: number
  /** 跟踪误差（年化） */
  trackingError: number
  /** 信息比率 */
  informationRatio: number
  /** 最大回撤 */
  maxDrawdown: number
  /** 组合 Sharpe（Rf=0） */
  sharpeRatio: number
}

export class PortfolioPerformanceResponseDto {
  portfolioId: string
  benchmarkTsCode: string
  startDate: string
  endDate: string
  metrics: PerformanceMetrics
  dailySeries: PerformanceDailyItem[]
}
```

### 3.4 核心 Service — `PortfolioPerformanceService`

```typescript
@Injectable()
export class PortfolioPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolioService: PortfolioService,
  ) {}

  async getPerformance(
    dto: PortfolioPerformanceDto,
    userId: number,
  ): Promise<PortfolioPerformanceResponseDto>
}
```

#### 算法步骤

1. 验证组合归属 → `portfolioService.assertOwner(portfolioId, userId)`
2. 确定日期范围：
   - `startDate` = dto.startDate ?? portfolio.createdAt
   - `endDate` = dto.endDate ?? 最近交易日
3. 加载组合持仓 → `PortfolioHolding[]`（当前快照）
4. 批量加载持仓股票的日线数据：
   ```sql
   SELECT ts_code, trade_date, close
   FROM stock_daily_prices
   WHERE ts_code IN (...) AND trade_date BETWEEN $startDate AND $endDate
   ORDER BY trade_date
   ```
5. 加载基准指数日线 → `IndexDaily` WHERE `tsCode = benchmarkTsCode`
6. 逐日构建净值序列：
   - `portfolioMV_t = SUM(qty_i × close_i_t)` + cash（`initialCash - totalCost`）
   - `portfolioNav_t = portfolioMV_t / initialCash`
   - `benchmarkNav_t = benchClose_t / benchClose_t0`
7. 计算日收益率序列 → 超额收益序列
8. 计算汇总指标：totalReturn, trackingError, informationRatio, maxDrawdown, sharpe
9. 返回 `PortfolioPerformanceResponseDto`

### 3.5 文件列表

| 操作 | 文件 |
|------|------|
| 新增 | `src/apps/portfolio/services/portfolio-performance.service.ts` |
| 新增 | `src/apps/portfolio/dto/portfolio-performance.dto.ts` |
| 新增 | `src/apps/portfolio/test/portfolio-performance.service.spec.ts` |
| 修改 | `src/apps/portfolio/portfolio.controller.ts` — 新增 `POST /portfolio/performance` 端点 |
| 修改 | `src/apps/portfolio/portfolio.module.ts` — 添加 `PortfolioPerformanceService` provider |

### 3.6 测试计划

| # | 测试用例 | 覆盖点 |
|---|----------|--------|
| 1 | 组合不存在 → NotFoundException | 基本校验 |
| 2 | 组合属于其他用户 → ForbiddenException | 权限 |
| 3 | 空持仓组合 → portfolioNav 恒为 1.0 | 边界 |
| 4 | 正常持仓 → NAV 序列正确计算 | 核心算法 |
| 5 | 基准 NAV 正确归一化 | 基准对齐 |
| 6 | tracking error / IR 计算正确 | 风险指标 |
| 7 | maxDrawdown 计算正确 | 最大回撤 |
| 8 | 自定义基准（如 CSI500）正确加载 | 参数灵活性 |

---

## 四、OPT-3.3 策略漂移检测

### 4.1 设计思路

策略漂移 = 组合实际持仓偏离策略最新信号的程度。检测维度：

1. **持仓偏离**：组合持有但信号未推荐的股票数 / 信号推荐但组合未持有的股票数
2. **权重偏离**：对于共同持仓，实际权重与信号目标权重的偏差
3. **行业暴露偏离**：按申万一级行业聚合，对比信号目标行业分布与实际行业分布

#### 偏离度指标

**持仓偏离度**：

$$D_{position} = \frac{|A \setminus S| + |S \setminus A|}{|A \cup S|}$$

其中 $A$ = 实际持仓股票集合，$S$ = 信号目标股票集合。

**权重偏离度**（对共同持仓 $A \cap S$）：

$$D_{weight} = \sqrt{\frac{1}{|A \cap S|} \sum_{i \in A \cap S} (w_i^{actual} - w_i^{target})^2}$$

**行业暴露偏离度**：

$$D_{industry} = \frac{1}{2} \sum_{k} |w_k^{actual} - w_k^{target}|$$

#### 总偏离度（加权）

$$D_{total} = 0.4 \times D_{position} + 0.4 \times D_{weight} + 0.2 \times D_{industry}$$

> 默认阈值 $D_{total} \geq 0.3$ 触发告警。

### 4.2 触发时机

有两种触发方式：

1. **自动触发**：在 OPT-3.1 信号生成完毕后，若 `SignalActivation.portfolioId` 不为空，自动对比
2. **手动触发**：用户主动调用端点查看当前偏离状态

### 4.3 端点

```
POST /portfolio/drift-detection
```

### 4.4 请求/响应 DTO

#### `DriftDetectionDto`

```typescript
export class DriftDetectionDto {
  /** 组合 ID */
  portfolioId: string

  /** 策略 ID（从关联的 SignalActivation 获取，或手动指定） */
  strategyId?: string

  /** 告警阈值（默认 0.3，范围 0~1） */
  alertThreshold?: number
}
```

#### `DriftDetectionResponseDto`

```typescript
export class DriftItemDto {
  tsCode: string
  stockName: string
  /** 实际权重 */
  actualWeight: number | null
  /** 信号目标权重 */
  targetWeight: number | null
  /** 差异 */
  weightDiff: number | null
  /** 漂移类型 */
  driftType: 'MISSING_IN_PORTFOLIO' | 'EXTRA_IN_PORTFOLIO' | 'WEIGHT_DRIFT' | 'ALIGNED'
}

export class IndustryDriftItemDto {
  industry: string
  actualWeight: number
  targetWeight: number
  diff: number
}

export class DriftDetectionResponseDto {
  portfolioId: string
  strategyId: string
  tradeDate: string

  /** 总偏离度 */
  totalDriftScore: number
  /** 是否触发告警 */
  isAlert: boolean
  /** 告警阈值 */
  alertThreshold: number

  /** 持仓偏离度 */
  positionDrift: number
  /** 权重偏离度 */
  weightDrift: number
  /** 行业暴露偏离度 */
  industryDrift: number

  /** 逐只股票偏离明细 */
  items: DriftItemDto[]
  /** 行业偏离明细 */
  industryItems: IndustryDriftItemDto[]
}
```

### 4.5 核心 Service — `DriftDetectionService`

```typescript
@Injectable()
export class DriftDetectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolioService: PortfolioService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  /**
   * 手动触发漂移检测端点。
   */
  async detect(
    dto: DriftDetectionDto,
    userId: number,
  ): Promise<DriftDetectionResponseDto>

  /**
   * 由 SignalGenerationService 在信号生成后自动调用。
   * 超阈值时推送 WebSocket。
   */
  async detectAndNotify(
    activationId: string,
    userId: number,
  ): Promise<void>
}
```

#### 算法步骤 — `detect()`

1. 验证组合归属 → `portfolioService.assertOwner()`
2. 确定策略 ID：
   - 若 `dto.strategyId` 提供 → 直接使用
   - 否则 → 查找 `SignalActivation` WHERE `portfolioId = dto.portfolioId AND isActive = true`
   - 找不到 → BadRequestException('组合未关联策略信号')
3. 加载最新信号 → `TradingSignal[]` WHERE `strategyId AND tradeDate = latestSignalDate`
4. 加载当前持仓 → `PortfolioHolding[]`
5. 获取持仓最新市值（查 `DailyBasic`）计算实际权重
6. 构建信号目标权重 Map：
   - 若信号有 `targetWeight` → 直接使用
   - 否则 → 等权分配（1 / targetCount）
7. 计算三个偏离度：$D_{position}$、$D_{weight}$、$D_{industry}$
8. 计算行业暴露差异（查 `StockBasic.industry`）
9. 加权汇总 $D_{total}$
10. 返回 `DriftDetectionResponseDto`

#### `detectAndNotify()` — 自动触发

1. 调用 `detect()` 获取结果
2. 若 `isAlert = true`：
   ```typescript
   this.eventsGateway.emitToUser(userId, 'drift_alert', {
     portfolioId,
     strategyId,
     totalDriftScore,
     tradeDate,
     message: `组合「${portfolioName}」与策略信号偏离度 ${(totalDriftScore * 100).toFixed(1)}%，超过阈值`,
   })
   ```

### 4.6 文件列表

| 操作 | 文件 |
|------|------|
| 新增 | `src/apps/signal/drift-detection.service.ts` — 放在 SignalModule 中（依赖 TradingSignal） |
| 新增 | `src/apps/signal/dto/drift-detection.dto.ts` |
| 新增 | `src/apps/signal/test/drift-detection.service.spec.ts` |
| 修改 | `src/apps/portfolio/portfolio.controller.ts` — 新增 `POST /portfolio/drift-detection` 端点 |
| 修改 | `src/apps/signal/signal.module.ts` — 添加 DriftDetectionService |

> 漂移检测端点挂在 PortfolioController 下（用户视角属于组合管理），但 Service 放在 SignalModule（因依赖 TradingSignal 模型）。PortfolioModule import SignalModule 获取 DriftDetectionService。

### 4.7 测试计划

| # | 测试用例 | 覆盖点 |
|---|----------|--------|
| 1 | 组合不存在 → NotFoundException | 基本校验 |
| 2 | 无关联策略 → BadRequestException | 参数缺失 |
| 3 | 无最新信号 → 返回 driftScore=0 | 边界 |
| 4 | 持仓完全匹配信号 → positionDrift=0, totalDrift≈0 | 无偏离 |
| 5 | 信号推荐 5 只但组合只持有 3 只 → positionDrift 正确 | 持仓偏离 |
| 6 | 共同持仓权重偏差 → weightDrift 正确 | 权重偏离 |
| 7 | 行业分布不一致 → industryDrift 正确 | 行业偏离 |
| 8 | 总偏离超阈值 → isAlert=true | 告警判定 |
| 9 | detectAndNotify → 超阈值时调用 emitToUser | WebSocket 推送 |
| 10 | detectAndNotify → 未超阈值时不推送 | 非告警 |

---

## 五、基础设施变更

### 5.1 Prisma Schema 新增

新增文件 `prisma/trading_signal.prisma`，包含：

- `TradingSignal` — 每日信号记录
- `SignalActivation` — 策略信号激活状态

### 5.2 数据库迁移

```bash
npx prisma migrate dev --name opt-3-1-trading-signal
```

### 5.3 WebSocket 新增事件

| 事件名 | 触发方 | 目标 | 载荷 |
|--------|--------|------|------|
| `signal_generated` | SignalGenerationService | `user:${userId}` | `{ strategyId, strategyName, tradeDate, signalCount, activationId }` |
| `drift_alert` | DriftDetectionService | `user:${userId}` | `{ portfolioId, portfolioName, strategyId, totalDriftScore, tradeDate, message }` |

### 5.4 模块依赖图

```
AppModule
├── SignalModule (新)
│   ├── imports: [BacktestModule, WebsocketModule]
│   ├── providers: [SignalService, SignalGenerationService, DriftDetectionService]
│   ├── exports: [SignalGenerationService, DriftDetectionService]
│   └── controllers: [SignalController]
│
├── PortfolioModule (修改)
│   ├── imports: [WebsocketModule, SignalModule]  ← 新增 import
│   ├── providers: [...existing, PortfolioPerformanceService]  ← 新增
│   └── controller 新增 performance + drift-detection 端点
│
└── TushareModule (修改)
    └── imports: [...existing, SignalModule]  ← 用于 sync 完成后触发信号
```

### 5.5 BacktestModule export 补充

`BacktestModule` 需要 export `BacktestStrategyRegistryService` 和 `BacktestDataService`，供 `SignalModule` 注入。检查现有 exports：

```typescript
exports: [
  BacktestRunService,
  BacktestEngineService,
  BacktestReportService,
  BacktestWalkForwardService,
  BacktestComparisonService,
  BacktestStrategyRegistryService,  // 确认已 export
]
```

需补充 `BacktestDataService` 到 exports。

---

## 六、实施顺序建议

```
Step 1: 创建 prisma/trading_signal.prisma + 迁移
Step 2: OPT-3.1 Signal CRUD（activate / deactivate / list / query）+ 测试
Step 3: OPT-3.1 SignalGenerationService 核心逻辑 + 测试
Step 4: OPT-3.1 集成 TushareSyncService（triggerSignalGenerationAsync）
Step 5: OPT-3.2 PortfolioPerformanceService + 测试
Step 6: OPT-3.3 DriftDetectionService + 测试
Step 7: 全量 TS 编译 + 所有新测试通过
```

预计 OPT-3.1 最复杂（需构造截面数据 + 调用策略引擎），OPT-3.2 / 3.3 中等。

---

_最后更新：2026-04-11_
