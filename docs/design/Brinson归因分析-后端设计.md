# OPT-2.1 Brinson 归因分析 — 后端设计

> **日期**：2026-04-11
> **优先级**：Phase 2（归因与分析增强）
> **关联**：高级优化待办清单 OPT-2.1

---

## 一、背景与目标

### 1.1 问题

回测完成后，用户只能看到"赚了多少"（totalReturn / sharpeRatio 等聚合指标），无法回答**为什么赚/亏**。作为量化从业者，归因分析是策略迭代的核心工具——需要知道收益/亏损来自行业配置偏差还是个股选择能力。

### 1.2 Brinson 模型简介

经典 Brinson-Hood-Beebower (BHB) 模型将组合超额收益分解为三项：

$$R_p - R_b = \underbrace{\sum_i (w_{p,i} - w_{b,i}) \cdot R_{b,i}}_{\text{资产配置效应 (AA)}} + \underbrace{\sum_i w_{b,i} \cdot (R_{p,i} - R_{b,i})}_{\text{个股选择效应 (SS)}} + \underbrace{\sum_i (w_{p,i} - w_{b,i}) \cdot (R_{p,i} - R_{b,i})}_{\text{交互效应 (IN)}}$$

其中：

- $w_{p,i}$ = 组合在行业 $i$ 的权重
- $w_{b,i}$ = 基准在行业 $i$ 的权重
- $R_{p,i}$ = 组合在行业 $i$ 的收益率
- $R_{b,i}$ = 基准在行业 $i$ 的收益率

### 1.3 核心收益

- 将回测超额收益拆解为可解释的三因素，指导策略优化方向
- 按行业维度输出明细，精确定位贡献/拖累行业
- 按时间段（月/周）输出归因序列，观察策略能力随时间的变化

---

## 二、接口设计

### 2.1 端点

```
POST /backtests/runs/attribution
```

- **认证**：`JwtAuthGuard` + `@CurrentUser()`
- **Controller**：`BacktestController`
- **Service**：`BacktestAttributionService.brinson()`

### 2.2 请求 DTO — `BrinsonAttributionDto`

```typescript
export class BrinsonAttributionDto {
  /** 回测任务 ID */
  runId: string

  /** 基准指数（默认使用回测配置的 benchmarkTsCode） */
  benchmarkTsCode?: string

  /** 行业分类级别（默认 L1 申万一级） */
  industryLevel?: 'L1' | 'L2' // 默认 'L1'

  /** 归因粒度（默认按月） */
  granularity?: 'DAILY' | 'WEEKLY' | 'MONTHLY' // 默认 'MONTHLY'
}
```

### 2.3 响应 DTO — `BrinsonAttributionResponseDto`

```typescript
export class BrinsonAttributionResponseDto {
  /** 回测任务 ID */
  runId: string

  /** 基准指数代码 */
  benchmarkTsCode: string

  /** 行业分类级别 */
  industryLevel: string

  /** 归因粒度 */
  granularity: string

  /** 回测区间 */
  startDate: string
  endDate: string

  // ── 总计归因 ──────────────────────────────────────────────────

  /** 组合总收益 */
  portfolioReturn: number

  /** 基准总收益 */
  benchmarkReturn: number

  /** 超额收益 */
  excessReturn: number

  /** 资产配置效应合计 */
  totalAllocationEffect: number

  /** 个股选择效应合计 */
  totalSelectionEffect: number

  /** 交互效应合计 */
  totalInteractionEffect: number

  // ── 行业明细 ──────────────────────────────────────────────────

  /** 按行业的归因明细 */
  industries: BrinsonIndustryDetailDto[]

  // ── 时间序列 ──────────────────────────────────────────────────

  /** 按时间段的归因序列 */
  periods: BrinsonPeriodDto[]
}

export class BrinsonIndustryDetailDto {
  /** 行业代码 */
  industryCode: string

  /** 行业名称 */
  industryName: string

  /** 组合在该行业的平均权重 */
  portfolioWeight: number

  /** 基准在该行业的平均权重 */
  benchmarkWeight: number

  /** 组合在该行业的收益率 */
  portfolioReturn: number

  /** 基准在该行业的收益率 */
  benchmarkReturn: number

  /** 资产配置效应 */
  allocationEffect: number

  /** 个股选择效应 */
  selectionEffect: number

  /** 交互效应 */
  interactionEffect: number

  /** 该行业对超额收益的总贡献 */
  totalEffect: number
}

export class BrinsonPeriodDto {
  /** 时段起始日 */
  startDate: string

  /** 时段结束日 */
  endDate: string

  /** 该时段组合收益 */
  portfolioReturn: number

  /** 该时段基准收益 */
  benchmarkReturn: number

  /** 资产配置效应 */
  allocationEffect: number

  /** 个股选择效应 */
  selectionEffect: number

  /** 交互效应 */
  interactionEffect: number

  /** 超额收益 */
  excessReturn: number
}
```

---

## 三、核心算法

### 3.1 整体流程（10 步）

```
 1. 校验回测任务  ← findUnique + status=COMPLETED + userId 所有权
 2. 加载持仓快照  ← BacktestPositionSnapshot (全区间)
 3. 加载每日NAV   ← BacktestDailyNav (全区间)
 4. 加载行业映射  ← IndexMemberAll (isNew='Y', L1/L2)
 5. 加载基准成分  ← IndexWeight (benchmarkTsCode, 各调仓日)
 6. 加载股票日线  ← Daily (计算各行业收益率)
 7. 按时间段分组  ← 根据 granularity 将交易日划分为若干 period
 8. 逐段计算归因  ← 每个 period 内计算组合/基准的行业权重和行业收益
 9. 汇总行业明细  ← 全区间维度按行业聚合
10. 组装响应返回  ← 总计 + 行业明细 + 时间序列
```

### 3.2 行业映射

使用 `IndexMemberAll` 表（申万行业分类），字段包含 `l1Code/l1Name/l2Code/l2Name/tsCode`。

```typescript
// 构建 tsCode → 行业 映射
const industryMap = new Map<string, { code: string; name: string }>()
const members = await this.prisma.indexMemberAll.findMany({
  where: { isNew: 'Y' },
  select: { tsCode: true, l1Code: true, l1Name: true, l2Code: true, l2Name: true },
})
for (const m of members) {
  if (level === 'L1') {
    industryMap.set(m.tsCode, { code: m.l1Code, name: m.l1Name })
  } else {
    industryMap.set(m.tsCode, { code: m.l2Code, name: m.l2Name })
  }
}
```

未映射到行业的股票归入 `OTHER`（其他）伪行业。

### 3.3 基准行业权重

通过 `IndexWeight` 表获取基准指数的成分股权重，再按行业聚合：

```typescript
// 每个 period 起始日取最近的基准权重
const weights = await this.prisma.indexWeight.findMany({
  where: { indexCode: benchmarkTsCode, tradeDate: periodStartStr },
})
// 按行业聚合
const benchmarkIndustryWeights = new Map<string, number>()
for (const w of weights) {
  const industry = industryMap.get(w.conCode) ?? { code: 'OTHER', name: '其他' }
  benchmarkIndustryWeights.set(
    industry.code,
    (benchmarkIndustryWeights.get(industry.code) ?? 0) + Number(w.weight) / 100,
  )
}
```

### 3.4 组合行业权重

从 `BacktestPositionSnapshot` 中获取组合持仓的 `weight` 字段，按行业聚合：

```typescript
// 每个 period 起始日的持仓权重
const positions = snapshotsByDate.get(periodStartDate)
const portfolioIndustryWeights = new Map<string, number>()
for (const p of positions) {
  const industry = industryMap.get(p.tsCode) ?? { code: 'OTHER', name: '其他' }
  portfolioIndustryWeights.set(industry.code, (portfolioIndustryWeights.get(industry.code) ?? 0) + (p.weight ?? 0))
}
```

### 3.5 行业收益率计算

对每个行业内的股票，用日线 `pctChg` 计算持有期收益率：

- **组合行业收益**：组合持有的该行业个股收益率的加权平均（按组合权重）
- **基准行业收益**：基准中该行业个股收益率的加权平均（按基准权重）

```typescript
// period 内的累计收益率（复利）
function periodReturn(dailyReturns: number[]): number {
  return dailyReturns.reduce((acc, r) => acc * (1 + r), 1) - 1
}
```

### 3.6 Brinson 三因素

每个 period 内，对所有行业 $i$：

```typescript
const AA_i = (wp_i - wb_i) * Rb_i // 资产配置效应
const SS_i = wb_i * (Rp_i - Rb_i) // 个股选择效应
const IN_i = (wp_i - wb_i) * (Rp_i - Rb_i) // 交互效应
```

全区间合计采用跨期累加 / 加权平均：

```typescript
totalAA = Σ_period AA_period
totalSS = Σ_period SS_period
totalIN = Σ_period IN_period
```

### 3.7 时间段划分

| granularity | 划分方式                  |
| ----------- | ------------------------- |
| `DAILY`     | 每个交易日为一个 period   |
| `WEEKLY`    | 按自然周分组（周一~周五） |
| `MONTHLY`   | 按自然月分组              |

交易日序列从 `BacktestDailyNav` 中提取。

---

## 四、数据依赖

| 表                         | 用途                               | 读/写 |
| -------------------------- | ---------------------------------- | ----- |
| `BacktestRun`              | 校验回测状态、获取 benchmarkTsCode | 读    |
| `BacktestDailyNav`         | 交易日序列、每日组合/基准NAV       | 读    |
| `BacktestPositionSnapshot` | 每日持仓权重（组合行业权重来源）   | 读    |
| `IndexMemberAll`           | 股票 → 申万行业映射（L1/L2）       | 读    |
| `IndexWeight`              | 基准指数成分股权重                 | 读    |
| `Daily`                    | 个股日线涨跌幅（行业收益率计算）   | 读    |

> 不写入任何表，纯计算端点。

### 4.1 IndexWeight 公告日 vs tradeDate

`IndexWeight.tradeDate` 是 String 类型（`YYYYMMDD`），需注意：

- 基准权重并非每日公告，需查询 period 起始日**最近可用**的权重
- 实现：`findFirst({ where: { indexCode, tradeDate: { lte: periodStartStr } }, orderBy: { tradeDate: 'desc' } })` —— 但 `IndexWeight` 按 `[indexCode, conCode, tradeDate]` 联合主键存储，需改为 `findMany + distinct tradeDate` 策略

### 4.2 注意事项

- `BacktestPositionSnapshot` 仅在**调仓日**有快照（非每日），中间交易日的持仓需**向前填充**（使用最近一个调仓日的快照）
- `IndexWeight` 权重每月/每季更新一次，也需**向前填充**
- 未被行业映射覆盖的股票（如新上市、退市）归入 `OTHER` 伪行业

---

## 五、性能考量

### 5.1 数据量级

典型回测：2 年 × 250 交易日 × 20~50 只持仓 = ~5,000~12,500 条 PositionSnapshot。
基准成分：沪深300 × 12 月 = ~3,600 条 IndexWeight。
日线涨跌幅：涉及 ~300~500 只股票 × 500 交易日 = ~250,000 条 Daily。

### 5.2 优化策略

1. **批量查询**：一次加载全区间 PositionSnapshot、DailyNav，不逐日查询
2. **日线按需加载**：仅查询出现在组合/基准中的 tsCodes
3. **IndexWeight 按需加载**：仅查询归因 period 起始日附近的权重
4. **内存 Map 索引**：所有数据加载后转为 Map，避免重复遍历

预计单次归因耗时 < 2 秒（2 年回测），无需异步任务队列。

---

## 六、错误处理

| 场景               | 异常                                              | HTTP 状态       |
| ------------------ | ------------------------------------------------- | --------------- |
| 回测任务不存在     | `NotFoundException('回测任务不存在')`             | 404             |
| 回测未完成         | `BadRequestException('回测任务尚未完成')`         | 400             |
| 回测不属于当前用户 | `ForbiddenException('无权访问该回测任务')`        | 403             |
| 无持仓快照数据     | `BadRequestException('该回测无持仓数据')`         | 400             |
| 基准权重数据缺失   | 降级：使用等权基准或返回空基准权重，industry 标记 | 正常返回 + 警告 |

---

## 七、安全考量

- 端点受 `JwtAuthGuard` 保护，`userId` 从 JWT token 提取
- **回测所有权校验**：`backtest.userId === currentUser.id`
- 纯读取操作，无数据修改风险

---

## 八、文件变更清单

| 操作     | 文件路径                                                      | 说明                                           |
| -------- | ------------------------------------------------------------- | ---------------------------------------------- |
| **新增** | `src/apps/backtest/dto/brinson-attribution.dto.ts`            | BrinsonAttributionDto + ResponseDto 及子 DTO   |
| **新增** | `src/apps/backtest/services/backtest-attribution.service.ts`  | Brinson 归因计算核心服务                       |
| **修改** | `src/apps/backtest/backtest.controller.ts`                    | 新增 `POST /backtests/runs/attribution` 端点   |
| **修改** | `src/apps/backtest/backtest.module.ts`                        | 添加 `BacktestAttributionService` 到 providers |
| **新增** | `src/apps/backtest/test/backtest-attribution.service.spec.ts` | 单元测试                                       |

---

## 九、与现有因子归因的关系

|              | 因子归因 (`/factor/backtest/attribution`) | Brinson 归因（本端点）                 |
| ------------ | ----------------------------------------- | -------------------------------------- |
| **分解维度** | 按因子分解收益贡献                        | 按行业分解超额收益                     |
| **模型**     | 因子暴露 × 因子收溢价（简化）             | BHB 三因素（AA + SS + IN）             |
| **基准**     | 无显式基准                                | 指数基准（如沪深300）                  |
| **定位**     | 回答"哪些因子贡献了收益"                  | 回答"超额收益来自行业配置还是选股能力" |
| **互补性**   | 因子视角                                  | 行业视角                               |

两者可联合使用：先用 Brinson 定位超额收益的行业来源，再用因子归因分析该行业内的因子贡献。

---

## 十、测试计划

| #   | 场景                          | 预期结果                                                         |
| --- | ----------------------------- | ---------------------------------------------------------------- |
| 1   | 正常归因：2 行业、3 个 period | 返回 industries 和 periods，三效应之和 ≈ excessReturn            |
| 2   | 回测不存在                    | 404 NotFoundException                                            |
| 3   | 回测未完成                    | 400 BadRequestException                                          |
| 4   | 回测不属于当前用户            | 403 ForbiddenException                                           |
| 5   | 无持仓数据                    | 400 BadRequestException                                          |
| 6   | 未映射行业的股票归入 OTHER    | OTHER 行业有正确权重和收益                                       |
| 7   | 基准权重缺失                  | 降级处理，返回结果中基准权重为 0                                 |
| 8   | granularity=DAILY             | periods 数量 = 交易日数                                          |
| 9   | granularity=WEEKLY            | periods 按周分组                                                 |
| 10  | industryLevel=L2              | 使用 L2 行业分类                                                 |
| 11  | 自定义 benchmarkTsCode        | 使用指定基准而非回测默认基准                                     |
| 12  | 三效应之和校验                | AA + SS + IN ≈ portfolioReturn - benchmarkReturn（允许浮点误差） |

---

## 十一、后续扩展

- **因子归因联合**：在同一端点支持 `mode: 'BRINSON' | 'FACTOR' | 'BOTH'`
- **OPT-4.2 综合报告**：Brinson 归因数据可嵌入 `STRATEGY_RESEARCH` 报告的归因章节
- **交互式向下钻取**：按行业 → 按个股进一步分解

---

_最后更新：2026-04-11_
