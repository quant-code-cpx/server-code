# OPT-4.1 / 4.2 / 4.3 / 4.4 — 多因子组合优化 · 综合研究报告 · 告警增强 · 交易日志 后端设计

> **日期**：2026-04-11
> **优先级**：Phase 4（高级研究工具）
> **关联**：高级优化待办清单 OPT-4.1 / OPT-4.2 / OPT-4.3 / OPT-4.4
> **前置已完成**：Phase 1（OPT-1.1~1.4）、Phase 2（OPT-2.1~2.4）、Phase 3（OPT-3.1~3.3）

---

## 一、概览

Phase 4 提供四项高级研究工具，补齐专业量化研究者日常工作流中的最后短板：

| 编号    | 名称           | 核心能力                                                          | 复杂度 |
| ------- | -------------- | ----------------------------------------------------------------- | ------ |
| OPT-4.1 | 多因子组合优化 | 均值方差（MVO）、最小方差、风险平价、最大多样化四种模式优化权重   | 高     |
| OPT-4.2 | 综合研究报告   | 聚合因子分析 + 回测 + Brinson 归因 + 风险评估，生成 JSON/HTML/PDF | 高     |
| OPT-4.3 | 告警系统增强   | 价格预警可关联自选股/组合，成员变动自动同步                       | 中     |
| OPT-4.4 | 交易日志复盘   | 记录组合每次调仓的完整日志，支持按维度筛选复盘                    | 中     |

### 数据流全景

```
因子暴露矩阵 + 收益率协方差矩阵
       │
       └──→ OPT-4.1 组合优化（MVO / MinVar / RiskParity / MaxDiv）
               │
               ├── 输出权重向量 → 可直接生成 CUSTOM_POOL_REBALANCE 策略
               └── 可对接 /portfolio/rebalance-plan 生成调仓单
                     │
                     └──→ OPT-4.4 交易日志（记录每次调仓原因与执行详情）
                             │
                             └──→ OPT-4.2 综合研究报告（聚合因子 + 回测 + 归因 + 风控）
                                     │
                                     └── HTML/PDF 输出

自选股 / 组合持仓
       │
       └──→ OPT-4.3 告警增强（关联规则，成员变动自动同步）
               │
               └── WebSocket 推送（来源标注：自选股组名 / 组合名）
```

### 与现有模块的关系

| 依赖方                            | 被依赖方                                      | 依赖内容                                               |
| --------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| FactorOptimizationService (新)    | PrismaService                                 | 查 `Daily`（收益率序列）、`FactorSnapshot`（因子暴露） |
| FactorOptimizationService (新)    | FactorComputeService                          | 获取因子截面值                                         |
| ReportDataCollectorService (扩展) | BacktestAttribution / Performance / Factor 等 | 聚合多模块数据                                         |
| PriceAlertService (扩展)          | WatchlistService                              | 获取自选股成员列表                                     |
| PriceAlertService (扩展)          | PortfolioService                              | 获取组合持仓股票列表                                   |
| PortfolioTradeLogService (新)     | PrismaService                                 | 日志 CRUD                                              |
| PortfolioService (扩展)           | PortfolioTradeLogService                      | 调仓操作时自动写日志                                   |

---

## 二、OPT-4.1 多因子组合优化（MVO / 风险平价）

### 2.1 设计思路

#### 核心算法

组合优化本质是在给定约束下寻找最优权重向量 **w**。四种模式共享 "收益率矩阵 → 协方差矩阵 → 优化求解" 流水线，区别仅在目标函数：

| 模式                                  | 目标函数                                  | 说明                             |
| ------------------------------------- | ----------------------------------------- | -------------------------------- |
| **MVO**（均值方差）                   | max **w**ᵀ**μ** − λ/2 · **w**ᵀΣ**w**      | 经典 Markowitz，λ 为风险厌恶系数 |
| **MIN_VARIANCE**（最小方差）          | min **w**ᵀΣ**w**                          | 不关注预期收益，只求最低方差     |
| **RISK_PARITY**（风险平价）           | min Σᵢ(wᵢ(Σ**w**)ᵢ/(**w**ᵀΣ**w**) − 1/N)² | 等风险贡献                       |
| **MAX_DIVERSIFICATION**（最大多样化） | max **σ**ᵀ**w** / √(**w**ᵀΣ**w**)         | 最大化多样化比率 DR              |

#### 实现策略

- 不引入外部二次规划库——对 N ≤ 500 的股票池，使用**投影梯度下降法**（Projected Gradient Descent）在 TypeScript 中原生实现，可满足精度需求。
- 约束：Σwᵢ = 1、0 ≤ wᵢ ≤ maxWeight（默认 0.2）、可选行业约束。
- 协方差矩阵使用 **Ledoit-Wolf 收缩估计**提高稳定性（需估计收缩系数）。

#### 与策略系统对接

优化结果的权重向量可直接转为 `CUSTOM_POOL_REBALANCE` 类型的策略配置，填入 `Strategy.strategyConfig.targetPortfolio`，实现"优化 → 策略模板 → 回测 → 组合"闭环。

### 2.2 数据模型

无新增 Prisma Model。优化结果作为 JSON 返回，若用户需持久化则通过保存为策略模板实现。

### 2.3 端点设计

#### `POST /factor/optimization`

**请求 DTO — `FactorOptimizationDto`**

```typescript
class FactorOptimizationDto {
  tsCodes: string[] // 候选股票池（必填，上限 500）
  mode: 'MVO' | 'MIN_VARIANCE' | 'RISK_PARITY' | 'MAX_DIVERSIFICATION'
  lookbackDays?: number // 收益率回看窗口（默认 250，即约 1 年）
  riskAversionLambda?: number // MVO 模式的风险厌恶系数（默认 2.5）
  maxWeight?: number // 单只上限（默认 0.2）
  minWeight?: number // 单只下限（默认 0.0）
  maxIterations?: number // 优化迭代上限（默认 1000）
  shrinkageTarget?: 'LEDOIT_WOLF' | 'IDENTITY' | 'NONE' // 协方差收缩（默认 LEDOIT_WOLF）
  endDate?: string // 截止日期（默认最新交易日）
  saveAsStrategy?: boolean // 是否自动保存为策略模板
  strategyName?: string // saveAsStrategy=true 时的策略名
}
```

**响应 DTO — `FactorOptimizationResponseDto`**

```typescript
class FactorOptimizationResponseDto {
  mode: string
  stockCount: number
  effectiveStockCount: number // 实际有收益率数据的股票数
  lookbackDays: number
  endDate: string
  weights: OptimizationWeightItem[] // { tsCode, stockName, weight, expectedReturn?, riskContribution? }
  portfolioMetrics: {
    expectedReturn: number // 年化预期收益（MVO 模式有意义）
    expectedVolatility: number // 年化预期波动率
    sharpeRatio: number // 预期夏普
    diversificationRatio: number // 多样化比率 DR
    effectiveN: number // 有效组合数 = 1/Σwᵢ²
    herfindahlIndex: number // Σwᵢ²
  }
  shrinkageIntensity: number // Ledoit-Wolf 收缩强度
  converged: boolean // 是否收敛
  iterations: number // 实际迭代次数
  strategyId?: string // saveAsStrategy=true 时返回
}
```

### 2.4 核心服务

#### `src/apps/factor/services/factor-optimization.service.ts`

```
FactorOptimizationService
├── optimize(dto, userId)                     // 主入口
│   ├── loadReturnMatrix(tsCodes, lookback, endDate)   // 查 Daily → 收益率矩阵 T×N
│   ├── estimateCovarianceMatrix(returns, shrinkage)    // 样本协方差 + Ledoit-Wolf 收缩
│   ├── estimateExpectedReturns(returns)                // 历史均值年化
│   ├── solveOptimization(mode, mu, sigma, constraints) // 投影梯度下降
│   │   ├── solveMVO(mu, sigma, lambda, constraints)
│   │   ├── solveMinVariance(sigma, constraints)
│   │   ├── solveRiskParity(sigma, constraints)
│   │   └── solveMaxDiversification(sigma, sigmaVec, constraints)
│   ├── computePortfolioMetrics(w, mu, sigma)           // 预期收益/波动/夏普/DR
│   └── saveAsStrategy?(weights, userId, name)          // 可选保存为策略
├── projectOntoSimplex(w, maxWeight, minWeight)         // 投影到约束集
└── ledoitWolfShrinkage(sampleCov, N, T)                // 收缩估计
```

**关键实现细节**：

1. **收益率矩阵**：从 `Daily` 表取 `close`，计算对数收益率 `ln(close_t / close_{t-1})`；跳过停牌（close 未变的交易日）。缺失值按列均值填充。
2. **Ledoit-Wolf 收缩**：`Σ_shrunk = δ·F + (1−δ)·S`，其中 F 为目标矩阵（对角阵，对角元素为样本方差的均值），S 为样本协方差，δ 为最优收缩强度。
3. **投影梯度下降**：
   - 步长采用 Barzilai-Borwein 自适应步长。
   - 每步投影到 `{w | Σw=1, minW ≤ wᵢ ≤ maxW}` 可行集。
   - 收敛判据：`|grad|₂ < 1e-8` 或达到 maxIterations。
4. **风险平价**：目标函数用对数变换 `yᵢ = log(wᵢ)` 去除正性约束后用 L-BFGS 或梯度下降求解。

### 2.5 模块变更

| 文件                                                       | 变更                                          |
| ---------------------------------------------------------- | --------------------------------------------- |
| `src/apps/factor/services/factor-optimization.service.ts`  | **新增**：核心优化服务                        |
| `src/apps/factor/dto/factor-optimization.dto.ts`           | **新增**：请求/响应 DTO                       |
| `src/apps/factor/factor.module.ts`                         | 增加 `FactorOptimizationService` 到 providers |
| `src/apps/factor/factor.controller.ts`                     | 新增 `POST /factor/optimization` 端点         |
| `src/apps/factor/test/factor-optimization.service.spec.ts` | **新增**：单元测试                            |

### 2.6 测试策略

| #   | 场景                                          | 预期                                |
| --- | --------------------------------------------- | ----------------------------------- |
| 1   | 股票池超过 500 只抛异常                       | BadRequestException                 |
| 2   | 收益率数据不足（<30 个交易日）抛异常          | BadRequestException                 |
| 3   | MVO 模式 — 正常 3 只股票                      | 权重之和=1，各权重 ∈ [0, maxWeight] |
| 4   | MIN_VARIANCE — 低波动股获得更高权重           | 验证低波标的权重 > 高波标的         |
| 5   | RISK_PARITY — 各标的风险贡献近似相等          | RC 偏差 < 0.05                      |
| 6   | MAX_DIVERSIFICATION — DR > 1                  | 多样化比率必须 ≥ 1                  |
| 7   | Ledoit-Wolf 收缩 — shrinkageIntensity ∈ (0,1) | 合理范围                            |
| 8   | saveAsStrategy=true — 自动创建策略            | 返回 strategyId                     |
| 9   | 单只股票时权重 = 1.0                          | 退化情况                            |
| 10  | maxWeight=0.1，5 只股票 → 至少 5 只非零       | 约束生效                            |

---

## 三、OPT-4.2 综合研究报告

### 3.1 设计思路

#### 报告类型

新增 `STRATEGY_RESEARCH` 报告类型，聚合已有模块数据：

```
┌────────────────────────────────────────────────────────────┐
│                STRATEGY_RESEARCH 报告                      │
│                                                            │
│  第一章  策略概要（策略配置 + 回测参数）                    │
│  第二章  回测绩效（NAV曲线 + 月度收益 + 关键指标）         │
│  第三章  Brinson 归因（行业配置 / 个股选择 / 交互效应）    │
│  第四章  因子分析（IC序列 + 分位收益 + IC衰减）            │
│  第五章  风险评估（回撤曲线 + 波动率 + 敏感性分析）         │
│  第六章  组合持仓快照（末日持仓 + 行业分布）               │
│                                                            │
│  每章均可通过 sections 参数控制开关                          │
└────────────────────────────────────────────────────────────┘
```

#### 数据采集策略

`ReportDataCollectorService` 新增 `collectStrategyResearchData()` 方法，编排调用已有数据采集方法 + 新增归因/因子聚合逻辑。核心是**按需跳过**：某章节关闭时不查该部分数据，避免不必要的数据库查询。

#### Prisma 变更

报告类型枚举新增 `STRATEGY_RESEARCH`：

```prisma
enum ReportType {
  BACKTEST
  STOCK
  PORTFOLIO
  STRATEGY_RESEARCH   // ← 新增
}
```

### 3.2 端点设计

#### `POST /report/strategy-research` （在现有 ReportController 中新增）

**请求 DTO — `CreateStrategyResearchReportDto`**

```typescript
class CreateStrategyResearchReportDto {
  backtestRunId: string // 关联的回测 ID（必填）
  strategyId?: string // 关联的策略 ID（可选，用于加载因子配置）
  portfolioId?: string // 关联的组合 ID（可选，第六章数据来源）
  title?: string
  format?: ReportFormatEnum // JSON | HTML | PDF
  sections?: StrategyResearchSections // 各章节开关
}

class StrategyResearchSections {
  overview?: boolean // 第一章，默认 true
  backtestPerformance?: boolean // 第二章，默认 true
  brinsonAttribution?: boolean // 第三章，默认 true
  factorAnalysis?: boolean // 第四章，默认 true（需 strategyId）
  riskAssessment?: boolean // 第五章，默认 true
  portfolioSnapshot?: boolean // 第六章，默认 false（需 portfolioId）
}
```

**响应 DTO — `StrategyResearchReportData`**

```typescript
interface StrategyResearchReportData {
  overview?: {
    strategyName: string
    strategyType: string
    params: Record<string, unknown>
    backtestPeriod: { start: string; end: string }
    benchmark: string
    universe: string
  }
  backtestPerformance?: BacktestReportData['metrics'] & {
    navCurve: BacktestReportData['navCurve']
    drawdownCurve: BacktestReportData['drawdownCurve']
    monthlyReturns: BacktestReportData['monthlyReturns']
  }
  brinsonAttribution?: {
    summary: { allocationEffect: number; selectionEffect: number; interactionEffect: number; totalExcess: number }
    industryDetails: BrinsonIndustryDetailDto[]
  }
  factorAnalysis?: {
    icSummary: { factorName: string; meanIC: number; icIR: number; tStat: number }[]
    quantileReturns: { factorName: string; quantiles: { group: number; avgReturn: number }[] }[]
    icDecay: { factorName: string; lags: number[]; icValues: number[] }[]
  }
  riskAssessment?: {
    maxDrawdown: number
    calmarRatio: number | null
    volatility: number | null
    beta: number | null
    costSensitivity?: { commissionRate: number; netReturn: number; sharpe: number }[]
  }
  portfolioSnapshot?: PortfolioReportData
}
```

### 3.3 核心变更

#### `src/apps/report/services/report-data-collector.service.ts` — 新增方法

```
collectStrategyResearchData(params)
├── loadBacktestRun(runId)                   // 复用已有
├── collectBacktestData(runId)               // 复用已有（第二章）
├── collectBrinsonAttribution(runId)         // 调用 BacktestAttributionService 逻辑
├── collectFactorAnalysis(strategyId)        // 从策略配置提取因子列表 → 查 IC/分位/衰减
├── collectRiskAssessment(runId)             // 提取回撤/波动 + 可选成本敏感性
└── collectPortfolioData(portfolioId)        // 复用已有（第六章）
```

#### 新增 Handlebars 模板

`src/apps/report/templates/strategy-research.hbs` — 六章结构，每章通过 `{{#if sections.xxx}}...{{/if}}` 条件渲染。

### 3.4 模块变更

| 文件                                                         | 变更                                                                |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `prisma/base.prisma`                                         | `ReportType` 枚举新增 `STRATEGY_RESEARCH`                           |
| `src/apps/report/dto/report-data.interface.ts`               | 新增 `StrategyResearchReportData` 接口                              |
| `src/apps/report/dto/create-report.dto.ts`                   | 新增 `CreateStrategyResearchReportDto` + `StrategyResearchSections` |
| `src/apps/report/services/report-data-collector.service.ts`  | 新增 `collectStrategyResearchData()` 方法                           |
| `src/apps/report/report.service.ts`                          | 新增 `createStrategyResearchReport()`，`TEMPLATE_MAP` 增加映射      |
| `src/apps/report/report.controller.ts`                       | 新增 `POST /report/strategy-research` 端点                          |
| `src/apps/report/templates/strategy-research.hbs`            | **新增**：六章研究报告模板                                          |
| `src/apps/report/report.module.ts`                           | 增加 `BacktestModule` import（获取归因数据）                        |
| `src/apps/report/test/report-data-collector.service.spec.ts` | 新增测试                                                            |

### 3.5 测试策略

| #   | 场景                           | 预期                          |
| --- | ------------------------------ | ----------------------------- |
| 1   | 回测 ID 不存在                 | BadRequestException           |
| 2   | 全章节开启 — 正常回测 + 策略   | 所有章节有数据                |
| 3   | sections 全部关闭              | 仅返回顶层骨架                |
| 4   | 无 strategyId — 第四章为 null  | 因子分析章节缺省              |
| 5   | 无 portfolioId — 第六章为 null | 组合快照章节缺省              |
| 6   | JSON 格式返回 data 字段        | data 结构正确                 |
| 7   | HTML 格式返回 filePath         | 文件已生成                    |
| 8   | 数据采集部分失败不阻断整个报告 | 失败章节标记为 null + warning |

---

## 四、OPT-4.3 告警系统增强（关联自选股 / 组合）

### 4.1 设计思路

#### 核心变更

当前 `PriceAlertRule` 单独绑定 `tsCode`，增强后支持**三种来源**：

1. **直接指定** — 现有方式，`tsCode` 直接填写（不变）
2. **关联自选股** — 填写 `watchlistId`，系统自动对自选股中所有成员股应用同一规则
3. **关联组合** — 填写 `portfolioId`，系统自动对组合持仓股应用同一规则

**关键设计决策**：

- **不创建 junction 表**。而是在 `PriceAlertRule` 上新增 `watchlistId?` 和 `portfolioId?` 可选字段。
- 关联规则的 `tsCode` 为空字符串（视为占位符），实际扫描时动态展开为成员股列表。
- 触发告警消息体中注明来源（自选股组名 / 组合名），帮助用户追溯。

#### 成员变动同步

不需要实时监听——盘后扫描 `dailyScan()` 时**实时展开**成员列表：

```
dailyScan()
  ├── 加载所有 ACTIVE 规则
  ├── 对 watchlistId 非空的规则 → 查 WatchlistStock 展开 tsCodes
  ├── 对 portfolioId 非空的规则 → 查 PortfolioHolding 展开 tsCodes
  └── 合并去重后统一扫描
```

这样即使自选股/组合成员变了，下次扫描自动生效，无需额外同步机制。

### 4.2 Prisma 变更

```prisma
model PriceAlertRule {
  // ... 现有字段保持不变 ...

  watchlistId  Int?       @map("watchlist_id")   // ← 新增
  portfolioId  String?    @map("portfolio_id")   // ← 新增
  sourceName   String?    @map("source_name")    // ← 新增，缓存来源名称（展示用）

  watchlist    Watchlist?  @relation(fields: [watchlistId], references: [id])
  portfolio    Portfolio?  @relation(fields: [portfolioId], references: [id])

  @@index([watchlistId])
  @@index([portfolioId])
}
```

### 4.3 端点变更

#### `POST /alert/price-rule/create` — 扩展已有端点

**DTO 扩展 — `CreatePriceAlertRuleDto`**

```typescript
class CreatePriceAlertRuleDto {
  tsCode?: string // 变为可选（关联模式时可不填）
  ruleType: PriceAlertRuleType
  threshold?: number
  memo?: string
  watchlistId?: number // ← 新增：关联自选股
  portfolioId?: string // ← 新增：关联组合
}
```

**约束校验**：`tsCode`、`watchlistId`、`portfolioId` 三选一必填。若 `watchlistId` 或 `portfolioId` 非空，`tsCode` 可以省略。

### 4.4 核心服务变更

#### `src/apps/alert/price-alert.service.ts`

```
createRule(userId, dto)    // 扩展：验证 watchlistId/portfolioId 归属，缓存 sourceName
runScan()                  // 扩展：展开关联规则 → 动态获取 tsCodes
├── expandLinkedRules(rules)     // 新增私有方法
│   ├── watchlistId → prisma.watchlistStock.findMany → tsCodes
│   └── portfolioId → prisma.portfolioHolding.findMany → tsCodes
└── buildTriggerPayload(rule, ...)  // 扩展：消息体增加 source 字段
```

**触发消息增强**：

```typescript
interface PriceAlertPayload {
  // ...现有字段...
  source?: {
    // ← 新增
    type: 'DIRECT' | 'WATCHLIST' | 'PORTFOLIO'
    id: string | number
    name: string
  }
}
```

### 4.5 模块变更

| 文件                                              | 变更                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `prisma/alert.prisma`（现有）                     | `PriceAlertRule` 新增 `watchlistId?`、`portfolioId?`、`sourceName?` 字段 + relation + index |
| `prisma/watchlist.prisma`                         | `Watchlist` model 新增 `alertRules PriceAlertRule[]` 反向关系                               |
| `prisma/portfolio.prisma`                         | `Portfolio` model 新增 `alertRules PriceAlertRule[]` 反向关系                               |
| `src/apps/alert/alert.module.ts`                  | imports 新增 `WatchlistModule`、`PortfolioModule`（forwardRef）                             |
| `src/apps/alert/dto/price-alert-rule.dto.ts`      | `CreatePriceAlertRuleDto` 新增可选字段 + 自定义校验                                         |
| `src/apps/alert/price-alert.service.ts`           | 注入 `WatchlistService` + `PortfolioService`；扩展 `createRule`、`runScan`                  |
| `src/apps/alert/test/price-alert.service.spec.ts` | 新增测试                                                                                    |

### 4.6 测试策略

| #   | 场景                                      | 预期                        |
| --- | ----------------------------------------- | --------------------------- |
| 1   | tsCode、watchlistId、portfolioId 均未填   | BadRequestException         |
| 2   | watchlistId 不存在或不归属当前用户        | NotFoundException           |
| 3   | portfolioId 不存在或不归属当前用户        | NotFoundException           |
| 4   | 创建关联自选股规则 — sourceName 自动填充  | 返回记录包含 sourceName     |
| 5   | runScan — 自选股关联规则正确展开          | 扫描覆盖所有成员            |
| 6   | runScan — 组合关联规则正确展开            | 扫描覆盖所有持仓            |
| 7   | 触发告警 — 消息体包含 source 信息         | WebSocket payload 有 source |
| 8   | 自选股成员变化后再次扫描 — 自动覆盖新成员 | 动态展开生效                |
| 9   | 关联的自选股被删除 — 规则仍存在但展开为空 | 不抛异常，跳过              |
| 10  | 兼容直接 tsCode 创建方式 — 原有逻辑不变   | 回归测试                    |

---

## 五、OPT-4.4 交易日志复盘

### 5.1 设计思路

#### 日志来源

组合持仓的每次变动（新增/更新/移除）均应生成一条日志。日志来源分四类：

| operator          | 说明         | 触发位置                                                  |
| ----------------- | ------------ | --------------------------------------------------------- |
| `MANUAL`          | 用户手动操作 | `PortfolioService.addHolding/updateHolding/removeHolding` |
| `BACKTEST_IMPORT` | 回测导入组合 | `BacktestPortfolioBridgeService.applyBacktest`            |
| `SIGNAL`          | 策略信号调仓 | 未来可在 rebalance 执行时自动记录                         |
| `RISK_CONTROL`    | 风控止损     | 未来可在 RiskCheckService 触发止损时记录                  |

#### 写入策略

采用**AOP 方式**——在 `PortfolioService` 的持仓操作方法中调用 `PortfolioTradeLogService.log()` 写入日志，而不是修改每个调用方。

### 5.2 数据模型

**新增 `prisma/portfolio_trade_log.prisma`**

```prisma
model PortfolioTradeLog {
  id           String   @id @default(uuid()) @db.Uuid
  portfolioId  String   @map("portfolio_id") @db.Uuid
  userId       Int      @map("user_id")
  tsCode       String   @map("ts_code") @db.VarChar(20)
  stockName    String?  @map("stock_name") @db.VarChar(50)
  action       String   @db.VarChar(16)    // BUY | SELL | ADJUST | ADD | REMOVE
  quantity     Int      @default(0)         // 变动数量
  price        Float?                       // 操作价格
  reason       String   @db.VarChar(32)    // MANUAL | BACKTEST_IMPORT | SIGNAL | RISK_CONTROL
  detail       Json?    @db.JsonB          // 附加信息（如回测 ID、信号 ID 等）
  createdAt    DateTime @default(now()) @map("created_at")

  portfolio    Portfolio @relation(fields: [portfolioId], references: [id])

  @@index([portfolioId, createdAt(sort: Desc)])
  @@index([userId, createdAt(sort: Desc)])
  @@index([tsCode])
  @@map("portfolio_trade_log")
}
```

### 5.3 端点设计

#### `POST /portfolio/trade-log`

**请求 DTO — `TradeLogQueryDto`**

```typescript
class TradeLogQueryDto {
  portfolioId: string // 必填
  startDate?: string // 起始日期
  endDate?: string // 截止日期
  tsCode?: string // 按标的筛选
  action?: string // BUY | SELL | ADJUST | ADD | REMOVE
  reason?: string // MANUAL | BACKTEST_IMPORT | SIGNAL | RISK_CONTROL
  page?: number // 默认 1
  pageSize?: number // 默认 20
}
```

**响应**

```typescript
interface TradeLogResponseDto {
  portfolioId: string
  total: number
  page: number
  pageSize: number
  items: TradeLogItemDto[] // { id, tsCode, stockName, action, quantity, price, reason, detail, createdAt }
}
```

#### `POST /portfolio/trade-log/summary`

**请求 DTO — `TradeLogSummaryDto`**

```typescript
class TradeLogSummaryDto {
  portfolioId: string
  startDate?: string
  endDate?: string
}
```

**响应**

```typescript
interface TradeLogSummaryResponseDto {
  portfolioId: string
  totalOperations: number
  breakdown: {
    action: string
    count: number
  }[]
  reasonBreakdown: {
    reason: string
    count: number
  }[]
  topStocks: {
    tsCode: string
    stockName: string
    operationCount: number
  }[]
}
```

### 5.4 核心服务

#### `src/apps/portfolio/services/portfolio-trade-log.service.ts`

```
PortfolioTradeLogService
├── log(params)                // 写入一条日志（供 PortfolioService 内部调用）
│   params: { portfolioId, userId, tsCode, stockName?, action, quantity, price?, reason, detail? }
├── query(dto, userId)         // 分页查询日志（验证组合归属）
└── summary(dto, userId)       // 聚合统计
```

#### `src/apps/portfolio/portfolio.service.ts` — 扩展

在以下方法结尾增加日志写入：

```
addHolding()    →  tradeLogService.log({ action: 'ADD', reason: operator ?? 'MANUAL', ... })
updateHolding() →  tradeLogService.log({ action: 'ADJUST', reason: operator ?? 'MANUAL', ... })
removeHolding() →  tradeLogService.log({ action: 'REMOVE', reason: operator ?? 'MANUAL', ... })
```

同时在 `addHolding/updateHolding/removeHolding` 方法签名中增加可选参数 `operator?: string` 和 `detail?: Record<string, unknown>`，以便调用方传入来源信息（默认 `MANUAL`）。

#### `src/apps/portfolio/services/backtest-portfolio-bridge.service.ts` — 扩展

`applyBacktest()` 中写入日志时传入 `reason: 'BACKTEST_IMPORT'`，`detail: { backtestRunId }`。

### 5.5 模块变更

| 文件                                                               | 变更                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `prisma/portfolio_trade_log.prisma`                                | **新增**：`PortfolioTradeLog` Model                                       |
| `prisma/portfolio.prisma`                                          | `Portfolio` model 新增 `tradeLogs PortfolioTradeLog[]` 反向关系           |
| `src/apps/portfolio/services/portfolio-trade-log.service.ts`       | **新增**：日志服务                                                        |
| `src/apps/portfolio/dto/trade-log.dto.ts`                          | **新增**：查询/汇总 DTO                                                   |
| `src/apps/portfolio/portfolio.module.ts`                           | providers 增加 `PortfolioTradeLogService`                                 |
| `src/apps/portfolio/portfolio.controller.ts`                       | 新增端点 `POST /portfolio/trade-log`、`POST /portfolio/trade-log/summary` |
| `src/apps/portfolio/portfolio.service.ts`                          | `addHolding`/`updateHolding`/`removeHolding` 尾部增加日志写入             |
| `src/apps/portfolio/services/backtest-portfolio-bridge.service.ts` | `applyBacktest` 调用时传入 `reason: 'BACKTEST_IMPORT'`                    |
| `src/apps/portfolio/test/portfolio-trade-log.service.spec.ts`      | **新增**：单元测试                                                        |

### 5.6 测试策略

| #   | 场景                                        | 预期                             |
| --- | ------------------------------------------- | -------------------------------- |
| 1   | log() 写入一条日志                          | 数据库有记录                     |
| 2   | query() — 组合不归属当前用户                | ForbiddenException               |
| 3   | query() — 按 tsCode 筛选                    | 仅返回该标的日志                 |
| 4   | query() — 按 action 筛选                    | 仅返回对应操作                   |
| 5   | query() — 按日期范围筛选                    | 仅返回范围内日志                 |
| 6   | query() — 分页                              | 正确的 page/total                |
| 7   | summary() — 按 action 聚合                  | breakdown 正确                   |
| 8   | summary() — 按 reason 聚合                  | reasonBreakdown 正确             |
| 9   | addHolding 后自动写入 ADD 日志              | log 被调用                       |
| 10  | applyBacktest 后日志 reason=BACKTEST_IMPORT | 日志 detail 中包含 backtestRunId |

---

## 六、实施计划

### 执行顺序

建议按复杂度和依赖关系分批：

```
第一批（基础独立模块）：
  OPT-4.4 交易日志复盘 — 无外部依赖，PortfolioModule 内部闭合
  OPT-4.3 告警增强 — Schema 简单、逻辑集中在 PriceAlertService

第二批（计算密集模块）：
  OPT-4.1 多因子组合优化 — 算法实现复杂度最高
  OPT-4.2 综合研究报告 — 依赖回测/归因/因子数据均已就绪
```

### Prisma 迁移策略

一次性 migration 包含所有 Schema 变更：

1. `PriceAlertRule` 新增 `watchlistId`、`portfolioId`、`sourceName` + index
2. `ReportType` 枚举新增 `STRATEGY_RESEARCH`
3. 新建 `portfolio_trade_log` 表
4. `Portfolio` / `Watchlist` 新增反向关系（无实际列变更）

```bash
npx prisma migrate dev --name opt-4-phase4-advanced-tools
```

### 新增文件清单

| 文件                                                          | 所属 OPT |
| ------------------------------------------------------------- | -------- |
| `src/apps/factor/services/factor-optimization.service.ts`     | 4.1      |
| `src/apps/factor/dto/factor-optimization.dto.ts`              | 4.1      |
| `src/apps/factor/test/factor-optimization.service.spec.ts`    | 4.1      |
| `src/apps/report/dto/create-strategy-research-report.dto.ts`  | 4.2      |
| `src/apps/report/templates/strategy-research.hbs`             | 4.2      |
| `src/apps/report/test/report-strategy-research.spec.ts`       | 4.2      |
| `prisma/portfolio_trade_log.prisma`                           | 4.4      |
| `src/apps/portfolio/services/portfolio-trade-log.service.ts`  | 4.4      |
| `src/apps/portfolio/dto/trade-log.dto.ts`                     | 4.4      |
| `src/apps/portfolio/test/portfolio-trade-log.service.spec.ts` | 4.4      |

### 修改文件清单

| 文件                                                               | 所属 OPT | 变更说明                                                   |
| ------------------------------------------------------------------ | -------- | ---------------------------------------------------------- |
| `src/apps/factor/factor.module.ts`                                 | 4.1      | providers 增加 FactorOptimizationService                   |
| `src/apps/factor/factor.controller.ts`                             | 4.1      | 新增优化端点                                               |
| `prisma/base.prisma`                                               | 4.2      | ReportType 枚举增加 STRATEGY_RESEARCH                      |
| `src/apps/report/report.module.ts`                                 | 4.2      | imports 增加 BacktestModule                                |
| `src/apps/report/report.service.ts`                                | 4.2      | 新增 createStrategyResearchReport()，TEMPLATE_MAP 增加映射 |
| `src/apps/report/report.controller.ts`                             | 4.2      | 新增端点                                                   |
| `src/apps/report/services/report-data-collector.service.ts`        | 4.2      | 新增 collectStrategyResearchData()                         |
| `src/apps/report/dto/report-data.interface.ts`                     | 4.2      | 新增 StrategyResearchReportData 接口                       |
| `prisma/alert.prisma`                                              | 4.3      | PriceAlertRule 新增字段                                    |
| `prisma/watchlist.prisma`                                          | 4.3      | Watchlist 新增反向关系                                     |
| `prisma/portfolio.prisma`                                          | 4.3      | Portfolio 新增反向关系                                     |
| `src/apps/alert/alert.module.ts`                                   | 4.3      | imports 增加 WatchlistModule、PortfolioModule              |
| `src/apps/alert/price-alert.service.ts`                            | 4.3      | 注入新服务、扩展 createRule/runScan                        |
| `src/apps/alert/dto/price-alert-rule.dto.ts`                       | 4.3      | CreatePriceAlertRuleDto 新增字段                           |
| `src/apps/portfolio/portfolio.module.ts`                           | 4.4      | providers 增加 PortfolioTradeLogService                    |
| `src/apps/portfolio/portfolio.controller.ts`                       | 4.4      | 新增端点                                                   |
| `src/apps/portfolio/portfolio.service.ts`                          | 4.4      | addHolding/updateHolding/removeHolding 增加日志写入        |
| `src/apps/portfolio/services/backtest-portfolio-bridge.service.ts` | 4.4      | applyBacktest 传入 reason                                  |

---

_最后更新：2026-04-11_
