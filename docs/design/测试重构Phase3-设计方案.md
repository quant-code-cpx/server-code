# 测试重构 Phase 3 — 设计方案

> **范围**：测试重构总纲 §五（P2 优先级模块）：Event Study、Pattern、Stock、Market、Heatmap、Index、Tushare Sync
> **原则**：SKILL.md §15 — 期望值从业务规则独立推导，代码视为可疑对象，用 `[BUG]` 标签标记当前行为偏差
> **前置**：Phase 2 已完成（133 用例，12 个 Bug 标记），本方案为 Phase 3 设计稿，不含实施

---

## 一、源码审计 Bug 清单

### 1.1 严重度标准

|  等级  | 含义                                 | 举例                       |
| :----: | ------------------------------------ | -------------------------- |
| **S1** | 安全风险或数据损坏                   | SQL 注入、数据错误写入     |
| **S2** | 计算结果错误，影响用户决策           | 收益率计算偏差、日期错位   |
| **S3** | 边界条件异常或语义歧义，不影响主流程 | 空数组 NaN、百分位公式偏差 |

### 1.2 Bug 清单

| Bug ID     | 严重度 | 模块           | 位置                           | 描述                                                                                                                                                                                                                                                                                                                      |
| ---------- | :----: | -------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------- |
| **P3-B1**  |   S2   | Event Study    | `toDateStr()`                  | `d.toISOString().slice(0,10)` 始终输出 UTC 日期。若 Prisma `@db.Date` 在 UTC+8 环境返回的 Date 对象所承载的时间为当天 00:00 UTC，`toISOString()` 结果正确；但若驱动返回本地午夜（即 UTC 的前一天 16:00），日期字符串会后退一天。                                                                                          |
| **P3-B2**  |   S2   | Event Study    | `parseYMD()`                   | `new Date('2025-03-01')` 创建 UTC 午夜。与使用 `dayjs.tz('YYYYMMDD', 'Asia/Shanghai')` 的其他模块存在时区语义不一致。                                                                                                                                                                                                     |
| **P3-B3**  |   S3   | Event Study    | `tTest()`                      | `n < 2` 返回 `{tStat:0, pValue:1}`，语义合理。但当所有 CAR 完全相同且非零时：`variance=0 → se=0 → tStat=0 → pValue=1`。统计上应为无穷大 t 值（CAR 确定性非零）。                                                                                                                                                          |
| **P3-B4**  |   S2   | Event Study    | `computeEventAR()`             | `stockMap.get(key) ?? 0` 将停牌日（无数据）视为 0% 收益。业务上停牌日应无收益率（null），而非 0。这使停牌日的 AR = 0 - benchRet = -benchRet，系统性偏低。                                                                                                                                                                 |
| **P3-B5**  |   S3   | Event Study    | `aggregateAAR()`               | 当不同样本 `arSeries.length` 不等时，`t < sample.arSeries.length` 使短样本在后面位置贡献 0，但除数始终为 `n`（总样本数）。AAR 后端位置系统性偏向 0。                                                                                                                                                                      |
| **P3-B6**  |   S2   | Event Signal   | `scanAndGenerate()`            | `new Date().toISOString().slice(0,10).replace(/-/g,'')` 使用 UTC 时间。UTC+8 盘后（如 16:00 上海 = 08:00 UTC）日期正确；但凌晨触发（如 00:30 上海 = 前一天 16:30 UTC）会产生前一天的日期。                                                                                                                                |
| **P3-B7**  |   S3   | Event Signal   | `matchConditions()`            | `actual == null` 检查覆盖 null 和 undefined。但若数据库返回 `Decimal` 类型、空字符串 `""`、或 `BigInt`，数值比较 `(actual as number) < ops.gte` 可能产生异常类型强转。                                                                                                                                                    |
| **P3-B8**  |   S2   | Pattern        | `normalizeToUnitRange([])`     | 空数组 → `Math.min(...[])=Infinity`, `Math.max(...[])=-Infinity` → `range=-Infinity-Infinity=-Infinity` → 除法产生 NaN 序列。调用方 `search()` 有 `length < 5` 保护，但 `slidingWindowSearch` 中窗口切片可能产生低于 5 的长度序列。                                                                                       |
| **P3-B9**  |   S1   | Pattern        | `batchLoadAdjustedCloses()`    | 使用 `$queryRawUnsafe` 而非 `$queryRaw` 模板字符串。参数通过 `$1::text[]`, `$2::date` 传递（Prisma 参数化查询），实际并非拼接注入。**经复查：Prisma 的 `$queryRawUnsafe` 当传入额外参数时会做参数绑定（positional params），不存在注入**。降级为设计瑕疵（应优先使用 `$queryRaw` tagged template 以避免未来维护者误解）。 |
| **P3-B10** |   S3   | Pattern        | `loadAdjustedCloses()`         | 同 P3-B9，`$queryRawUnsafe` 配合 positional params。安全但不符合 Prisma 最佳实践。                                                                                                                                                                                                                                        |
| **P3-B11** |   S3   | Pattern        | 前复权公式                     | `factor > 0 ? latestAdj / factor : 1`：当 `adjFactor ≤ 0`（数据质量问题）时静默使用乘数=1，不记录告警。复权价与真实价差距可达数倍。                                                                                                                                                                                       |
| **P3-B12** |   S3   | Pattern        | `dtwDistance()`                | `n=0                                                                                                                                                                                                                                                                                                                      |     | m=0` 返回 0。距离 0 意味着"完全匹配"，但空序列间的距离应为 undefined（无信息）。 |
| **P3-B13** |   S2   | Pattern        | `distanceToSimilarity()`       | DTW 距离可超过 1.0（因归一化方式 `sqrt(cost/max(n,m))`）。当距离 > 1 时 `(1-d)*100` < 0，被 `Math.max(0,...)` 截断为 0%。所有 DTW 距离 > 1 的结果无法区分排序。                                                                                                                                                           |
| **P3-B14** |   S3   | Stock Analysis | IR 计算                        | `eStd = sqrt(Σ(b-eMean)²/n)` 使用总体标准差（除以 n），而非样本标准差（除以 n-1）。对小 n（如 20 天），IR 被系统性高估约 2.5%。                                                                                                                                                                                           |
| **P3-B15** |   S3   | Stock Analysis | 年化波动率                     | 同样使用 `variance / n`（总体方差），非样本方差 `/(n-1)`。影响小于 IR 但仍不符合金融学标准。                                                                                                                                                                                                                              |
| **P3-B16** |   S3   | Market         | `computeValuationPercentile()` | `oneYearAgo.setFullYear(y-1)` — 若 `tradeDate` 恰好为 2 月 29 日（闰年），`setFullYear` 非闰年后自动偏移到 3 月 1 日（同 Phase 2 B7 模式）。                                                                                                                                                                              |
| **P3-B17** |   S3   | Market         | 百分位公式                     | `rank / allVals.length × 100`，其中 `rank = count(v ≤ current)`。当 current 为最大值时，百分位 = 100%（正确）；当 current 为最小值时，百分位 = 1/n×100（对 n=250，为 0.4%）。标准百分位排名公式 `(rank-1)/(n-1)` 使最小值 = 0%、最大值 = 100%。                                                                           |
| **P3-B18** |   S3   | Market         | PE 过滤                        | `pe_ttm > 0 AND pe_ttm < 1000` 排除了亏损公司和极高 PE 公司。若 > 30% 上市公司亏损，中位数仅反映盈利公司子集，可能误导用户对"全市场估值水平"的判断。（设计层面，非代码 bug）                                                                                                                                              |
| **P3-B19** |   S3   | Heatmap        | `resolveTradeDate()`           | 无参数时用 `new Date(y, m, d)` 创建本地时区 Date；有参数时也用本地时区。与 Event Study 的 UTC 日期创建方式不同。若 Prisma 查询条件传入的 Date 在 PostgreSQL 中被解释为 UTC，可能错位一天。                                                                                                                                |

---

## 二、模块测试设计

### 2.1 Event Study（零覆盖，新建文件）

**文件**：`test/event-study/event-study.service.spec.ts`

#### 2.1.1 纯函数测试

```
describe('toDateStr()')
  it('[BIZ] Date(2025-06-15T00:00:00Z) → "2025-06-15"')
    // 手算：UTC 午夜 → ISO 切片 → "2025-06-15"
    expect: "2025-06-15"

  it('[EDGE] Date for 2025-12-31T23:59:59.999Z → "2025-12-31"')
    // UTC 23:59 → 仍为同日
    expect: "2025-12-31"

  it('[BUG P3-B1] Date created from local midnight UTC+8 may shift day')
    // new Date('2025-06-15T00:00:00+08:00') = 2025-06-14T16:00:00Z
    // toDateStr → "2025-06-14"（前一天！）
    // 当前行为："2025-06-14"
    // 正确行为：应感知时区或使用 dayjs.tz

describe('parseYMD()')
  it('[BIZ] "20250615" → Date at UTC midnight June 15')
    // '2025-06-15' → new Date → UTC midnight
    expect: 2025-06-15T00:00:00.000Z

  it('[EDGE] "20000229" 闰年 → valid Date')
    expect: 2000-02-29T00:00:00.000Z

  it('[EDGE] "20250229" 非闰年 → Date auto-corrects to March 1')
    // new Date('2025-02-29') → 2025-03-01T00:00:00.000Z
    expect: March 1 (auto-correction, should we validate?)

describe('addDays()')
  it('[BIZ] addDays(2025-01-30, 5) → 2025-02-04')
    expect: Feb 4

  it('[EDGE] addDays over month boundary')
  it('[EDGE] addDays negative → go back')

describe('round()')
  it('[BIZ] round(3.14159, 2) → 3.14')
  it('[EDGE] round(0.5, 0) → 1')   // banker's rounding? Math.round = 1
  it('[EDGE] round(2.005, 2)') // 经典浮点: 2.005*100=200.49999... → 2.00
    // 当前行为: round(2.005, 2) = 2.00（浮点精度丢失）
    // 正确行为: 2.01（四舍五入）

describe('normalCDF()')
  it('[BIZ] normalCDF(0) = 0.5')
    // 标准正态 CDF(0) = 0.5
    expect: toBeCloseTo(0.5, 6)

  it('[BIZ] normalCDF(1.96) ≈ 0.975')
    // 双侧 95% 临界值
    expect: toBeCloseTo(0.975, 3)

  it('[BIZ] normalCDF(-1.96) ≈ 0.025')
    expect: toBeCloseTo(0.025, 3)

  it('[EDGE] normalCDF(10) ≈ 1.0')
  it('[EDGE] normalCDF(-10) ≈ 0.0')
```

#### 2.1.2 computeEventAR() 核心计算

```
describe('computeEventAR()')
  // 手算场景：5 个交易日 [D-2, D-1, D0, D+1, D+2]
  // 股票收益: [1%, -2%, 3%, -1%, 2%]
  // 基准收益: [0.5%, -1%, 1.5%, 0%, 1%]
  // AR = stock - bench = [0.5%, -1%, 1.5%, -1%, 1%]
  // CAR = 0.5 + (-1) + 1.5 + (-1) + 1 = 1%

  it('[BIZ] 标准 AR 计算 — 手算验证')
    preDays=2, postDays=2
    stockMap: tsCode:D-2→1, tsCode:D-1→-2, tsCode:D0→3, tsCode:D+1→-1, tsCode:D+2→2
    benchMap: D-2→0.5, D-1→-1, D0→1.5, D+1→0, D+2→1
    expect arSeries ≈ [0.5, -1.0, 1.5, -1.0, 1.0]
    expect car ≈ 1.0

  it('[BUG P3-B4] 停牌日股票无数据 → 当前 AR = 0 - benchRet')
    // D0 股票停牌，无数据
    // 当前行为：stockReturn=0（默认值）→ AR = 0 - 1.5 = -1.5
    // 正确行为：该日 AR 应为 null 或从计算中排除

  it('[EDGE] 事件日前后交易日不足 → 返回 null')
    eventIdx=1 but preDays=5 → insufficient pre-window
    expect: null

  it('[EDGE] eventDate 不在 tradeDays 中（非交易日事件）→ 对齐到最近交易日')
    // tradeDays = ['2025-06-13', '2025-06-16']
    // eventDate = '2025-06-14' (Saturday)
    // findIndex(d >= '2025-06-14') → index of '2025-06-16'
    // 事件被对齐到下一个交易日（当前行为如此，是否合理？）
```

#### 2.1.3 aggregateAAR() 聚合计算

```
describe('aggregateAAR()')
  // 2 个样本, windowSize=3
  // Sample A arSeries = [1, 2, 3]
  // Sample B arSeries = [3, 2, 1]
  // AAR = [(1+3)/2, (2+2)/2, (3+1)/2] = [2, 2, 2]
  // CAAR = [2, 4, 6]

  it('[BIZ] 2 样本平均手算验证')
    expect aarSeries = [2, 2, 2]
    expect caarSeries = [2, 4, 6]

  it('[BUG P3-B5] 样本 arSeries 长度不等 → 短样本后端贡献 0')
    // windowSize=4
    // Sample A arSeries = [1, 2, 3, 4] (完整)
    // Sample B arSeries = [3, 2]        (不完整)
    // 当前行为：AAR[2] = (3 + 0)/2 = 1.5（B 贡献 0，除以总样本数 2）
    // 正确行为：AAR[2] = 3/1 = 3（只有 A 有数据，除以有效样本数 1）

  it('[EDGE] 零样本 → 空序列')
    expect: { aarSeries: [], caarSeries: [] }
```

#### 2.1.4 tTest() 统计检验

```
describe('tTest()')
  // 手算：3 个样本 CAR = [2, 4, 6]
  // mean = 4, variance = ((2-4)²+(4-4)²+(6-4)²)/(3-1) = 8/2 = 4
  // se = sqrt(4/3) ≈ 1.1547
  // tStat = 4 / 1.1547 ≈ 3.4641
  // pValue = 2*(1 - normalCDF(3.4641)) ≈ 2*(1-0.99973) ≈ 0.000534

  it('[BIZ] 3 样本 CAR=[2,4,6] 手算 t 检验')
    expect tStatistic ≈ 3.4641
    expect pValue ≈ 0.0005 (toBeCloseTo 3 decimals)

  it('[EDGE] n=1 → tStatistic=0, pValue=1')
  it('[EDGE] n=0 → tStatistic=0, pValue=1')

  it('[BUG P3-B3] 所有 CAR 完全相同 (variance=0)')
    // samples = [car:5, car:5, car:5]
    // variance=0, se=0, tStat=0, pValue=1
    // 当前行为：tStat=0, pValue=1（不显著）
    // 统计意义上：确定性非零 CAR，应为显著
```

#### 2.1.5 analyze() 端到端

```
describe('analyze()')
  it('[BIZ] 包含完整事件样本时返回正确结构')
  it('[EDGE] 无匹配事件 → sampleCount=0, 空序列')
  it('[BIZ] topSamples/bottomSamples 按 CAR 排序')
```

---

### 2.2 Event Signal（零覆盖，新建文件）

**文件**：`test/event-study/event-signal.service.spec.ts`

#### 2.2.1 规则 CRUD

```
describe('createRule()')
  it('[BIZ] 创建规则返回完整字段')
  it('[BIZ] conditions 为空对象时保存成功')

describe('listRules()')
  it('[BIZ] 不返回 DELETED 状态的规则')
  it('[BIZ] 分页参数正确传递')

describe('updateRule()')
  it('[BIZ] 部分更新只修改传入字段')
  it('[ERR] 规则不存在 → NotFoundException')
  it('[SEC] 非本人规则 → NotFoundException（不泄露存在性）')

describe('deleteRule()')
  it('[BIZ] 软删除 → status 改为 DELETED')
  it('[ERR] 已删除规则再删除 → NotFoundException')
```

#### 2.2.2 matchConditions() 条件匹配

```
describe('matchConditions()')
  // 直接值匹配
  it('[BIZ] { type: "预增" } 匹配 event.type="预增" → true')
  it('[BIZ] { type: "预增" } 匹配 event.type="预减" → false')

  // 范围操作符
  it('[BIZ] { pChangeMin: { gte: 50 } } 匹配 event.pChangeMin=60 → true')
  it('[BIZ] { pChangeMin: { gte: 50 } } 匹配 event.pChangeMin=50 → true（边界）')
  it('[BIZ] { pChangeMin: { gte: 50 } } 匹配 event.pChangeMin=49 → false')
  it('[BIZ] { vol: { gt: 0, lt: 1000 } } 多操作符组合')
  it('[BIZ] { type: { in: ["预增","略增"] } } 匹配 event.type="预增" → true')

  // 边界条件
  it('[EDGE] conditions = {} → 无条件匹配所有事件 → true')
  it('[EDGE] conditions = null → true')
  it('[EDGE] event 字段为 null → false（字段缺失不匹配）')

  it('[BUG P3-B7] event 字段为 Decimal 或 BigInt 时的数值比较')
    // Prisma 返回 Decimal('500.00') 而非 number 500
    // (actual as number) < 50 → Decimal 与 number 比较行为取决于 JS 隐式转换
```

#### 2.2.3 scanAndGenerate()

```
describe('scanAndGenerate()')
  it('[BIZ] 匹配到事件 → 创建 signal + WebSocket 推送')
    mock eventsGateway.emitToUser
    expect signal created with correct ruleId, tsCode, eventDate
    expect emitToUser called with rule.userId

  it('[BIZ] 无 ACTIVE 规则 → 直接返回 0')
  it('[BIZ] 规则条件不匹配 → signalsGenerated=0')

  it('[BUG P3-B6] UTC 日期在上海凌晨产生前一天日期')
    // new Date() at 2025-06-16T00:30:00+08:00 = 2025-06-15T16:30:00Z
    // .toISOString().slice(0,10) = "2025-06-15" (前一天)
    // 当前行为：dateStr = "20250615"（前一天）
    // 正确行为：dateStr = "20250616"（当天）
```

---

### 2.3 Pattern — similarity.ts 纯函数（零覆盖，新建文件）

**文件**：`test/pattern/similarity.spec.ts`

#### 2.3.1 normalizeToUnitRange()

```
describe('normalizeToUnitRange()')
  it('[BIZ] [10, 20, 30] → [0, 0.5, 1.0]')
    // min=10, max=30, range=20
    // (10-10)/20=0, (20-10)/20=0.5, (30-10)/20=1.0

  it('[EDGE] 全相同 [5, 5, 5] → [0.5, 0.5, 0.5]')
    // range=0, 按代码逻辑返回全 0.5

  it('[BIZ] [100, 50, 75] → [1.0, 0, 0.5]')
    // min=50, max=100, range=50

  it('[BUG P3-B8] 空数组 [] → NaN 污染')
    // Math.min() = Infinity, Math.max() = -Infinity
    // range = -Infinity - Infinity = -Infinity
    // map: (p - Infinity) / (-Infinity) → NaN
    // 当前行为：返回 []（空 map 结果）— 实际上 [].map(...) 返回 []，不产生 NaN
    // 修正：空数组 .map() 不触发回调，结果为 []。但如果有 length=1 的数组呢？
    // 单元素 [42] → min=42, max=42, range=0 → 返回 [0.5]（正确，走 range===0 分支）
```

#### 2.3.2 normalizedEuclideanDistance()

```
describe('normalizedEuclideanDistance()')
  it('[BIZ] 相同序列 → 距离 0')
    a = [0, 0.5, 1], b = [0, 0.5, 1]
    // Σ(a-b)² = 0, sqrt(0/3) = 0
    expect: 0

  it('[BIZ] [0,0,0] vs [1,1,1] → sqrt(3/3) = 1.0')
    // 每个差值²=1, sumSq=3, sqrt(3/3)=1.0
    expect: 1.0

  it('[BIZ] [0,1] vs [1,0] → sqrt(2/2) = 1.0')
    expect: 1.0

  it('[BIZ] [0,0.5,1] vs [0.1,0.5,0.9] → sqrt(0.02/3) ≈ 0.0816')
    // d = [0.1, 0, 0.1], d² = [0.01, 0, 0.01], sum=0.02
    // sqrt(0.02/3) ≈ 0.08165
    expect: toBeCloseTo(0.08165, 4)

  it('[EDGE] 空数组 → 0')
    // n=0, 直接返回 0
```

#### 2.3.3 dtwDistance()

```
describe('dtwDistance()')
  // 手算小规模 DTW
  it('[BIZ] 相同序列 [0,1,0] vs [0,1,0] → 0')
    // 最优对齐为对角线，每步 cost=0
    // total cost = 0, sqrt(0/3) = 0
    expect: 0

  it('[BIZ] [0,1] vs [0,0.5,1] — 不等长序列')
    // a=[0,1], b=[0,0.5,1], n=2, m=3
    // 手算 DTW 矩阵:
    //        b[0]=0   b[1]=0.5  b[2]=1
    // a[0]=0   0       0.25     1.25
    // a[1]=1   1       0.25     0.25
    // cost at (2,3) = 0.25
    // sqrt(0.25 / max(2,3)) = sqrt(0.25/3) ≈ 0.2887
    expect: toBeCloseTo(0.2887, 3)

  it('[BUG P3-B12] 空序列 → 返回 0（意味着"完全匹配"）')
    // dtwDistance([], [1,2,3]) = 0
    // 当前行为：0
    // 正确行为：应为 Infinity 或 NaN 表示"无法比较"

  it('[EDGE] 单元素 [0.5] vs [0.5] → 0')
  it('[EDGE] 极端差异序列 [0,0,0] vs [1,1,1]')
```

#### 2.3.4 distanceToSimilarity()

```
describe('distanceToSimilarity()')
  it('[BIZ] distance=0 → similarity=100')
    // (1-0)*100 = 100
    expect: 100

  it('[BIZ] distance=0.5 → similarity=50')
    expect: 50

  it('[BIZ] distance=1.0 → similarity=0')
    expect: 0

  it('[BUG P3-B13] distance=1.5（DTW 可超 1）→ clamp 到 0')
    // (1-1.5)*100 = -50 → max(0, -50) = 0
    // 当前行为：0
    // distance=2.0 时同样为 0，无法区分
    // 正确行为：应使用非线性映射（如 exp(-d)）或 DTW 专用归一化

  it('[EDGE] distance=0.001 → similarity=99.9')
    expect: 99.9
```

---

### 2.4 Pattern — pattern.service.ts（零覆盖，新建文件）

**文件**：`test/pattern/pattern.service.spec.ts`

```
describe('search()')
  it('[BIZ] 查询形态 < 5 天 → BusinessException')
    mock loadAdjustedCloses → 返回 3 个点
    expect: throw BusinessException

  it('[BIZ] excludeSelf=true 时排除查询股票自身')
    mock getCandidateStocks → [queryTsCode, otherTsCode]
    期望: slidingWindowSearch 只收到 [otherTsCode]

  it('[BIZ] 正常搜索返回完整结构')
    验证: patternLength, algorithm, candidateCount, matches

describe('slidingWindowSearch()')
  it('[BIZ] 候选池中 bestDistance 最小的排在前面')
  it('[BIZ] topK=2 时只返回 2 个')

describe('computeFutureReturns()')
  // 手算：baseClose=100, [+5d]=110, [+10d]=105, [+20d]=120
  it('[BIZ] 基准价 100 → [+10%, +5%, +20%]')
    expect: [10, 5, 20]

  it('[EDGE] 数据不足 20 天 → 返回部分结果')
    priceData 长度 = endIdx + 8
    expect: 只有 [+5d] 的收益率

  it('[EDGE] baseClose=0 → 除零')

describe('前复权公式')
  // adjClose = close × (latestAdj / rowAdj)
  // 例：close=10, latestAdj=2.0, rowAdj=1.0 → adjClose=20
  it('[BIZ] 历史 adjFactor < latest → 价格放大')
    expect: 10 * (2.0/1.0) = 20

  it('[BIZ] adjFactor=null → 默认 1')
  it('[BUG P3-B11] adjFactor=0 → 使用乘数 1（静默忽略错误数据）')
    // factor=0, factor>0 为 false → multiplier=1
    // close × 1 = close（未复权）
    // 正确行为：应标记为异常数据
```

---

### 2.5 Stock Analysis — Beta / IR（增强现有 spec）

**文件**：`test/stock/stock-analysis.service.spec.ts`（现有 18 用例，追加）

```
describe('getRelativeStrength() — Beta 计算')
  // 手算小样本 Beta
  // stockReturns = [0.01, -0.02, 0.03]  (1%, -2%, 3%)
  // benchReturns = [0.005, -0.01, 0.015] (0.5%, -1%, 1.5%)
  // sMean = (0.01-0.02+0.03)/3 = 0.00667
  // bMean = (0.005-0.01+0.015)/3 = 0.00333
  // cov = (0.01-0.00667)(0.005-0.00333) + (-0.02-0.00667)(-0.01-0.00333) + (0.03-0.00667)(0.015-0.00333)
  //      = 0.00333*0.00167 + (-0.02667)*(-0.01333) + 0.02333*0.01167
  //      = 0.0000056 + 0.000356 + 0.000272 = 0.000633
  // bVar = 0.00167² + 0.01333² + 0.01167² = 0.0000028 + 0.000178 + 0.000136 = 0.000317
  // Beta = 0.000633 / 0.000317 ≈ 2.0

  it('[BIZ] Beta 手算验证 — 股票波动是基准 2 倍')
    expect beta ≈ 2.0

  it('[EDGE] 基准收益率全部相同 → bVar=0 → beta=null')

  it('[BUG P3-B14] IR 使用总体标准差而非样本标准差')
    // excessReturns = [0.01, 0.02, 0.03]
    // eMean = 0.02
    // 当前 eStd = sqrt(((0.01-0.02)²+(0.02-0.02)²+(0.03-0.02)²)/3) = sqrt(0.0002/3) ≈ 0.00816
    // 正确 eStd = sqrt(0.0002/2) ≈ 0.01
    // 当前 IR = (0.02/0.00816)*sqrt(252) ≈ 38.88
    // 正确 IR = (0.02/0.01)*sqrt(252) ≈ 31.75
```

---

### 2.6 Market — 估值百分位（增强现有 spec）

**文件**：`test/market/market.service.spec.ts`（现有 10 用例，追加）

```
describe('computeValuationPercentile()')
  // 手算：10 个历史 PE 中位数 = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
  // 当前值（最后一个）= 17
  // sorted = [8,9,10,11,12,13,14,15,16,17]
  // rank = count(v <= 17) = 10
  // percentile = (10/10)*100 = 100%

  it('[BIZ] 当前值为历史最大 → 百分位 100%')
    mock prisma.$queryRaw → 10 个升序中位数, 最后一个最大
    expect: 100

  it('[BIZ] 当前值为历史最小 → 百分位 = 1/n * 100')
    // 10 个值，rank=1, 百分位 = 10%
    expect: 10

  it('[BUG P3-B17] 百分位公式偏差 — 最小值不为 0%')
    // 当前行为：最小值百分位 = 1/10*100 = 10%
    // 标准公式 (rank-1)/(n-1)*100：最小值 = 0%
    // 对 n=250（一年交易日），偏差 = 0.4%

  it('[BUG P3-B16] 闰年 Feb 29 减一年 → setFullYear 偏移到 Mar 1')
    // tradeDate = new Date(2024, 1, 29) = 2024-02-29
    // oneYearAgo.setFullYear(2023) → 2023-03-01（2023 非闰年）
    // 查询范围多了 1 天
    // 当前行为：startDate = 2023-03-01
    // 正确行为：startDate = 2023-02-28

  it('[EDGE] 数据不足 2 天 → 返回 null')
    mock → dailyMedians 只有 1 条
    expect: null
```

---

### 2.7 Heatmap（增强现有 spec）

**文件**：`test/heatmap/heatmap.service.spec.ts`（现有 7 用例，追加）

```
describe('resolveTradeDate()')
  it('[BUG P3-B19] 有参数时使用本地时区 Date — 与 Event Study UTC 不一致')
    // resolveTradeDate('20250615')
    // new Date(2025, 5, 15) → 本地时间午夜
    // 若 PostgreSQL 解释为 UTC → 可能与实际交易日匹配

describe('getIndustryHeatmap()')
  it('[BIZ] 返回行业名称作为 groupName')
  it('[BIZ] 按市值降序排列')
  it('[EDGE] 某股票无 daily_basic 数据 → totalMv=null')
    // LEFT JOIN → db row null

describe('getIndexHeatmap()')
  it('[BIZ] 使用最近权重日期，非当天')
  it('[EDGE] 指数无权重数据 → NotFoundException')

describe('getConceptHeatmap()')
  it('[BIZ] pctChg 从 pct_change 字段映射')
  it('[EDGE] totalMv 和 amount 始终为 null（设计如此）')
```

---

### 2.8 Index（增强现有 spec）

**文件**：`test/index/index.service.spec.ts`（现有 9 用例，追加）

```
describe('getIndexDaily()')
  it('[BIZ] parseDate 使用 Asia/Shanghai 时区')
    input '20250615' → dayjs.tz → UTC+8 午夜转 UTC
    // 不同于 Event Study 的 parseYMD

  it('[EDGE] 无日期参数 + 数据库为空 → 返回 data=[]')

  it('[BIZ] 默认最近 3 个月范围')

describe('getIndexConstituents()')
  it('[BIZ] 4 小时缓存 TTL')
    验证 cacheService.rememberJson 收到 TTL=14400

  it('[EDGE] 无权重数据 → total=0, constituents=[]')
  it('[BIZ] 成分股名称从 stockBasic 批量获取')
  it('[EDGE] 部分成分股 stockBasic 无记录 → name=null')
```

---

### 2.9 Technical Indicators（增强现有 spec）

**文件**：`test/stock/technical-indicators.spec.ts`（现有 27 用例，追加）

```
describe('calcMACD() 交叉验证')
  // 使用已知参考值（如 Excel/通达信计算的 MACD）
  it('[DATA] 20 日收盘价序列 MACD 与参考值偏差 < 0.5%')
    // 提供固定 20 天收盘价, 手算 EMA12, EMA26, DIF, DEA, MACD

describe('calcRSI()')
  it('[BIZ] 全涨 → RSI = 100')
  it('[BIZ] 全跌 → RSI = 0')
  it('[EDGE] 涨跌幅全为 0 → RSI = 50')

describe('calcBOLL()')
  it('[BIZ] std=0（全相同收盘价）→ upper=mid=lower')
```

---

### 2.10 Stock Financial — YoY（增强现有 spec）

**文件**：`test/stock/stock-financial.service.spec.ts`（现有 23 用例，追加）

```
describe('yoy() 边界条件')
  // yoy(curr, prev) = (curr - prev) / |prev| × 100

  it('[BIZ] 正常增长 yoy(120, 100) = 20%')
    expect: 20

  it('[BIZ] prev=0 → null')
    expect: null

  it('[BIZ] 负转正 yoy(50, -100) = 150%')
    // (50 - (-100)) / |(-100)| * 100 = 150
    expect: 150

  it('[BIZ] 负转更负 yoy(-200, -100) = -100%')
    // (-200 - (-100)) / |-100| * 100 = -100
    expect: -100

  it('[BIZ] curr=null → null')
  it('[BIZ] prev=null → null')
```

---

### 2.11 Stock Screener（增强现有 spec）

**文件**：`test/stock/stock-screener.service.spec.ts`（现有 17 用例，追加）

```
describe('screener() SQL 构建')
  it('[BIZ] 复合条件 industry + pe + 市值')
    验证 $queryRaw 参数包含所有 WHERE 片段

  it('[BIZ] 无条件 → 不拼接非必需 JOIN')
    无 moneyflow 条件 → moneyflowJoin 为空壳

  it('[EDGE] 所有条件均触发 → 四个 JOIN 全部启用')
  it('[BIZ] ROW_NUMBER() OVER (ORDER BY trade_date DESC) 在 LATERAL 中')
    // ROW_NUMBER 限定在 WHERE ts_code = sb.ts_code 的 LATERAL 子查询内
    // 无需 PARTITION BY（LATERAL 已按单只股票关联）
```

---

### 2.12 Tushare Sync — 补充业务场景

#### sync.service.spec.ts（现有 8 用例，追加）

```
describe('onApplicationBootstrap()')
  it('[BIZ] 非交易日跳过所有 tradingDayOnly 任务')
    mock tradeCal → 今天 isOpen='0'
    expect: scheduled cron 注册但当日不执行

describe('runManualSync()')
  it('[DATA] targetTradeDate 格式校验')
```

#### basic-sync.service.spec.ts（现有 13 用例，追加）

```
describe('syncStockBasic()')
  it('[DATA] API 返回字段名与 Prisma schema 不一致时 mapper 不丢数据')
  it('[BIZ] incremental 且非首日 → 跳过')
  it('[BIZ] full 模式 → 清空后重写')
```

#### market-sync.service.spec.ts（现有 16 用例，追加）

```
describe('syncDaily()')
  it('[EDGE] lastSyncDate = 今日 → 不重复同步')
  it('[ERR] 单日 API 失败 → 跳过该日，继续后续')
  it('[BIZ] full 模式重置进度后从头开始')
```

#### tushare-client.service.spec.ts（追加场景）

```
describe('请求与重试')
  it('[ERR] 超时 → 重试指定次数后抛出')
  it('[ERR] 40203 配额限制 → 等待后重试')
  it('[ERR] -2001 积分不足 → 直接抛出不重试')
```

---

## 三、实施计划

### 3.1 文件清单

| 序号 | 文件路径                                        | 操作 | 预计用例数 |
| :--: | ----------------------------------------------- | :--: | :--------: |
|  1   | `test/event-study/event-study.service.spec.ts`  | 新建 |    ~30     |
|  2   | `test/event-study/event-signal.service.spec.ts` | 新建 |    ~20     |
|  3   | `test/pattern/similarity.spec.ts`               | 新建 |    ~25     |
|  4   | `test/pattern/pattern.service.spec.ts`          | 新建 |    ~15     |
|  5   | `test/stock/stock-analysis.service.spec.ts`     | 追加 |     +8     |
|  6   | `test/market/market.service.spec.ts`            | 追加 |     +8     |
|  7   | `test/heatmap/heatmap.service.spec.ts`          | 追加 |     +8     |
|  8   | `test/index/index.service.spec.ts`              | 追加 |     +6     |
|  9   | `test/stock/technical-indicators.spec.ts`       | 追加 |     +5     |
|  10  | `test/stock/stock-financial.service.spec.ts`    | 追加 |     +6     |
|  11  | `test/stock/stock-screener.service.spec.ts`     | 追加 |     +4     |
|  12  | `test/tushare/sync.service.spec.ts`             | 追加 |     +3     |
|  13  | `test/tushare/basic-sync.service.spec.ts`       | 追加 |     +3     |
|  14  | `test/tushare/market-sync.service.spec.ts`      | 追加 |     +3     |
|  15  | `test/tushare/tushare-client.service.spec.ts`   | 追加 |     +3     |
|      | **合计**                                        |      |  **~147**  |

### 3.2 分组实施顺序

| 批次  | 模块                                                    | 理由                      |
| :---: | ------------------------------------------------------- | ------------------------- |
| **A** | similarity.spec.ts                                      | 纯函数，无依赖，最快验证  |
| **B** | event-study.service.spec.ts                             | 核心计算，Bug 密度最高    |
| **C** | event-signal.service.spec.ts                            | 与 B 同模块，共享 mock    |
| **D** | pattern.service.spec.ts                                 | 依赖 similarity，先完成 A |
| **E** | stock-analysis / market / heatmap / index               | 增量追加，相互独立可并行  |
| **F** | technical-indicators / stock-financial / stock-screener | 增量追加                  |
| **G** | tushare sync 系列                                       | 增量追加，已有较好基础    |

### 3.3 测试基础设施新增需求

- `test/helpers/factory.ts` 需新增：`buildForecastRecord()`, `buildDividendRecord()`, `buildStkHolderTradeRecord()`, `buildEventSignalRule()`, `buildAdjustedPoint()`
- `test/helpers/prisma-mock.ts` 需新增 mock 模型：`eventSignalRule`, `eventSignal`, `shareFloat`, `finaAudit`, `disclosureDate`, `repurchase`
- Event Signal 测试需 mock `EventsGateway`（WebSocket 网关）
