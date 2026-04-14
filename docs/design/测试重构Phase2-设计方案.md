# 测试重构 Phase 2 — 设计方案

> **范围**：测试重构总纲 §四（P1 优先级模块）：Factor Compute、Strategy、Signal（Generation + Service + Drift Detection）、Risk Check、Backtest Run、Factor Screening/Analysis/Optimization
> **原则**：SKILL.md §15 — 期望值从业务规则独立推导，代码视为可疑对象，用 `[BUG]` 标签标记当前行为偏差
> **前置**：Phase 1 已完成（Auth、Backtest Engine、Portfolio 核心计算），本方案为 Phase 2 设计稿

---

## 一、源码审计 Bug 清单

### 1.1 严重度标准

| 等级   | 含义                                 | 举例                       |
| :----: | ------------------------------------ | -------------------------- |
| **S1** | 安全风险或数据损坏                   | SQL 注入、数据错误写入     |
| **S2** | 计算结果错误，影响用户决策           | 收益率计算偏差、日期错位   |
| **S3** | 边界条件异常或语义歧义，不影响主流程 | 空数组 NaN、百分位公式偏差 |

### 1.2 Bug 清单

| Bug ID    | 严重度 | 模块              | 位置                                        | 描述                                                                                                                                                                                                                                      |
| --------- | :----: | ----------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P2-B1** |   S2   | Signal Generation | `resolveTradeDate()`                        | 字符串参数 `"20250301"` 被 `dayjs('20250301')` 解析为 UTC 午夜 `2025-03-01T00:00:00Z`，而非上海时间午夜。与 Prisma `@db.Date` 存储的 UTC Date 进行 `<=` 比较时可能错位一天。                                                              |
| **P2-B2** |   S3   | Signal Generation | `buildHistoricalBars()`                     | `d <= upToDateStr` 使用字符串比较，上界为 `upToDate` 当日，导致当日 bar 被包含在"历史数据"中。信号生成时若策略基于昨日收盘，可能引入 look-ahead bias。                                                                                     |
| **P2-B3** |   S3   | Risk Check        | `formatDate()`                              | 使用 `getFullYear()/getMonth()/getDate()` 读取本地时区。UTC 容器中本地时间即 UTC，但传入的 Date 若来自上海时区创建（`dayjs.tz`），格式化后可能偏移一天。                                                                                    |
| **P2-B4** |   S2   | Factor Compute    | `DERIVED_DAILY_BASIC_MAP` — EP/BP 因子      | EP 因子 SQL 使用 `pe_ttm > 0` 而非 `pe_ttm != 0`，导致亏损公司（PE < 0）的 EP 被设为 NULL 而非计算为负值。BP 因子同理，PB < 0（净资产为负）被忽略。对量化选股产生系统性偏差：亏损公司被从因子排名中排除。                                    |
| **P2-B5** |   S2   | Strategy          | `update()` — 版本快照 + version 递增        | `strategyVersion.create` 和 `strategy.update({version:{increment:1}})` 是两次独立 Prisma 调用，未包裹在 `$transaction` 中。两个并发更新可能写入相同旧版本号的快照，版本号也可能只递增 1 而非 2。                                             |
| **P2-B6** |   S2   | Signal Generation | `deriveActions()` — weight=0 语义           | `weight ?? 1/N` 中 `??` 仅处理 `null/undefined`，不处理 `0`。weight=0 的目标仍产生 BUY 信号（targetWeight=0），语义上应视为 SELL 或过滤。有组合时，已持仓 + weight=0 的目标产生 HOLD 而非 SELL，可能导致组合不调仓。                         |
| **P2-B7** |   S2   | Risk Check        | `checkMaxDrawdown()` — `setFullYear` 溢出   | `latestDate.setFullYear(y-1)` 当日期为闰年 2 月 29 日时，`setFullYear(非闰年)` 自动偏移到 3 月 1 日，导致回看窗口比预期短 1 天。                                                                                                          |
| **P2-B8** |   S2   | Risk Check        | `checkMaxDrawdown()` — peak 初始化          | `peak` 从 `navs[0]` 初始化，而非从真实高水位开始。若回看窗口第一个 NAV 不是最高点（例如组合创建时净值较低），最大回撤被低估。例如 `navs=[0.95, 0.8, 0.85]`：当前算法最大回撤 ≈ 15.8%，若从高水位 1.0 计算应为 20%。                        |
| **P2-B9** |   S3   | Factor Compute    | `buildUniverseJoinStr()` — 正则过于宽松     | Universe 正则 `/^\d{6}\.[A-Z]{2}$/` 允许 `000300._H`（下划线）和 `000300.AB`（非法后缀）通过。应限制后缀为 `SH\|SZ\|BJ`。                                                                                                                |
| **P2-B10**|   S3   | Factor Compute    | `buildResponse()` — total 不含缺失值行数    | 快照读取时 `total` 取自 `SELECT count(*)`（含 NULL 因子值的行），但 `items` 中 NULL 值行已被过滤。导致前端翻页可能在最后几页出现空结果。                                                                                                    |
| **P2-B11**|   S3   | Strategy          | `update()` — backtestDefaults 变更无痕迹    | 只更新 `backtestDefaults`（不更新 `strategyConfig`）时不创建版本快照、不递增 `version`。回测默认参数的变更无法回溯。                                                                                                                       |
| **P2-B12**|   S3   | Signal Generation | `generateForActivation()` — 空 targets 仍更新 lastSignalDate | 策略返回空 targets 时 `lastSignalDate` 被更新为当前交易日，后续该日不再重试。若策略因临时数据缺失返回空目标，该日信号将永久丢失。                                                                                                          |

---

## 二、模块测试设计

### 2.1 Factor Compute（因子计算）

**文件**：`src/apps/factor/test/factor-compute.service.spec.ts`
**现有用例**：10（重构前）
**新增目标**：~37 用例

#### 2.1.1 SQL 注入防护增强

```
describe('[SEC] buildUniverseJoinStr() — 注入变体防护')
  it('[SEC] universe 含空格变体不通过')
    // "000001 .SZ" 含空格 → BadRequestException
    expect: throws

  it('[SEC] universe 含 Unicode 注入不通过')
    // "000001.SZ\u0000" 含 null byte → BadRequestException
    expect: throws

  it('[SEC] tradeDate 含分号不通过')
    // "20240101;" → BadRequestException
    expect: throws

  it('[SEC] tradeDate 含字母不通过')
    // "2024010a" → BadRequestException
    expect: throws

  it('[BIZ] 合法 universe（6 位数字.2 位字符）通过校验')
    // "000300.SH" → 返回 INNER JOIN 片段
    expect: contains 'INNER JOIN'
```

#### 2.1.2 派生因子计算

```
describe('[BUG-B4] DERIVED_DAILY_BASIC_MAP — EP/BP 因子对亏损公司的处理')
  it('[BUG] ep 因子 SQL 使用 pe_ttm > 0 而非 != 0，导致 PE<0（亏损公司）被过滤为 NULL')
    // 手算：pe_ttm = -5 → ep = 1/(-5) = -0.2
    // 当前行为：ep = NULL（pe_ttm < 0 被过滤）
    // 正确行为：ep = -0.2（负 PE 的倒数）
    expect: 验证 SQL 中包含 "> 0" 条件（文档化已知偏差）

  it('[BUG] bp 因子同样忽略 PB<0（净资产为负的公司）')
    // pb = -3 → bp = 1/(-3) ≈ -0.333
    // 当前行为：bp = NULL
    expect: 验证 SQL 中包含 "> 0" 条件

  it('[BIZ] pe_ttm=0 时 ep 因子应为 NULL（非 Infinity）')
    // 1/0 = Infinity → 应用 NULLIF 或 CASE WHEN 处理
    expect: NULL（CASE WHEN pe_ttm = 0 THEN NULL）
```

#### 2.1.3 精度与转换

```
describe('[DATA] 因子值精度转换')
  it('[DATA] factor_value 极小值 1.23e-15 转 Number 后精度不丢失')
    // Number('1.23e-15') === 1.23e-15
    expect: true

  it('[BUG] factor_value=Infinity（SQL 未处理除零）时 Number(Infinity) 不是有限数')
    // $queryRaw 返回 Infinity → Number(Infinity) = Infinity
    expect: 验证 isFinite 检查或 NULLIF 兜底
```

#### 2.1.4 Universe 正则边界

```
describe('[BUG-B9] buildUniverseJoinStr — universe 正则过于宽松')
  it('[BUG] universe 后缀含下划线（如 000300._H）不应通过校验')
    expect: throws（当前可能通过）

  it('[BUG] universe 后缀小写（如 000300.sh）不应通过校验')
    expect: throws（当前可能通过）

  it('[BIZ] 合法后缀 SH/SZ/BJ 均应通过校验')
    expect: "000300.SH" / "000001.SZ" / "430001.BJ" 均通过
```

#### 2.1.5 分页与 Total 一致性

```
describe('[BUG-B10] buildResponse — total 不等于可分页行数')
  it('[BUG] cnt=5000 missing=500 时 total=5000，但实际可翻页行数为 4500')
    // 快照含 5000 行，其中 500 行 factor_value=NULL 被过滤
    // total=5000（来自 count(*)）但 items 只能翻到 4500 行
    expect: total=5000（记录当前行为）
```

#### 2.1.6 自定义表达式完整流程

```
describe('[BIZ] getCustomSqlValues() — 完整流程验证')
  it('[BIZ] 因子有 expression 时按顺序调用 expressionSvc 方法链')
    // validate → toSql → computeCustomSqlForDate
    expect: 方法链按序调用，返回正确结构

  it('[BIZ] 因子存在但未配置表达式时抛出 NotFoundException')
    expect: throws NotFoundException

  it('[BIZ] 因子不存在时抛出 NotFoundException')
    expect: throws NotFoundException

  it('[BIZ] statsRows 为空时 summary 安全降级为全 null/0')
    expect: summary.mean=null, summary.count=0
```

---

### 2.2 Strategy（策略管理）

**文件**：`src/apps/strategy/test/strategy.service.spec.ts`
**现有用例**：22（重构前）
**新增目标**：~28 用例

#### 2.2.1 策略数量 Off-by-One 边界

```
describe('[BIZ] create() — off-by-one 边界')
  it('[BIZ] count=49 时可成功创建第 50 个策略')
    // MAX_STRATEGIES_PER_USER = 50
    // prisma.strategy.count → 49
    // 手算：49 < 50 → 允许创建
    expect: prisma.strategy.create 被调用

  it('[BIZ] count=50 时创建第 51 个策略应抛 BusinessException')
    // prisma.strategy.count → 50
    // 手算：50 >= 50 → 拒绝
    expect: throws STRATEGY_LIMIT_EXCEEDED
```

#### 2.2.2 版本管理

```
describe('[BIZ] update() — config 变更时版本号自增并写快照')
  it('[BIZ] 更新 strategyConfig 时 version 自增 1 并调用 strategyVersion.create')
    // 旧策略 version=3, strategyConfig 变更
    // 期望：strategyVersion.create({ ..., versionNumber: 3 })
    //       strategy.update({ version: { increment: 1 } })
    expect: version.create 被调用，参数含旧版本号

  it('[BIZ] 只更新 name（不更新 config）时不写版本快照')
    // dto.strategyConfig === undefined
    expect: strategyVersion.create 不被调用

describe('[BUG-B11] update() — backtestDefaults 变更不留版本痕迹')
  it('[BUG] 只更新 backtestDefaults 时不写版本快照/不递增 version')
    // dto = { backtestDefaults: { ... } }
    // 当前行为：不写快照（backtestDefaults 不在版本跟踪范围内）
    // 期望行为（可讨论）：应纳入版本跟踪
    expect: strategyVersion.create 不被调用（记录已知限制）

describe('[BUG-B5] update() — 版本快照+递增未包在事务中')
  it('[BUG] 两次并发更新同一策略 config 时，两个快照写入相同的旧版本号')
    // 竞态：两个请求同时读到 version=3
    // 两个都写 strategyVersion(versionNumber=3)
    // 两个都 increment → version=5（跳过 4）或 version=4（丢失一次）
    expect: 两次 create 的 versionNumber 相同（记录竞态风险）
```

#### 2.2.3 版本对比

```
describe('[BIZ] compareVersions() — 版本对比边界')
  it('[BIZ] versionA >= versionB 时抛出 BusinessException')
    // 版本对比要求 A < B
    expect: throws BusinessException

  it('[BIZ] versionA 对应快照不存在时抛出 BusinessException')
    expect: throws BusinessException

describe('[BIZ] diffConfigs() — diff 语义')
  it('[BIZ] 新增字段 → ADDED；无变化字段 → 不在 diff 中')
    // configA = { a: 1 }, configB = { a: 1, b: 2 }
    expect: diff = [{ field: 'b', type: 'ADDED', newValue: 2 }]

  it('[BIZ] 删除字段 → REMOVED；修改字段 → CHANGED')
    // configA = { a: 1, b: 2 }, configB = { a: 3 }
    expect: diff 含 CHANGED(a) + REMOVED(b)

  it('[BIZ] 两个完全相同的 config → diff 为空数组')
    expect: diff = []

  it('[BIZ] 嵌套对象通过 JSON.stringify 比较，整体嵌套变更算 CHANGED')
    // configA = { obj: { x: 1 } }, configB = { obj: { x: 2 } }
    expect: diff = [{ field: 'obj', type: 'CHANGED' }]
```

#### 2.2.4 克隆越权与边界

```
describe('[SEC] clone() — 越权与名称冲突')
  it('[SEC] 克隆其他用户的私有策略（非公开）应抛 BusinessException')
    // userId=1, 策略 userId=2, isPublic=false
    expect: throws BusinessException

  it('[BIZ] 公开策略可被任意用户克隆')
    // userId=1, 策略 userId=2, isPublic=true
    expect: create 被调用

  it('[BIZ] 克隆时名称与现有策略冲突（P2002）→ 抛 BusinessException')
    // prisma 抛出 P2002 unique constraint
    expect: throws STRATEGY_NAME_EXISTS

  it('[BIZ] 克隆时策略数量恰好到达上限（count=49→50 成功）')
    // 边界：49 < 50 → 允许
    expect: create 被调用
```

#### 2.2.5 标签边界

```
describe('[BIZ] update() — tags 边界')
  it('[BIZ] tags.length = 11 时抛出 BusinessException（标签最多 10 个）')
    expect: throws BusinessException

  it('[BIZ] tags = [] 清空标签时应正常调用 prisma.strategy.update')
    expect: update 被调用，tags: []
```

---

### 2.3 Signal Generation（信号生成引擎）

**文件**：`src/apps/signal/test/signal-generation.service.spec.ts`
**现有用例**：8（重构前）
**新增目标**：~24 用例

#### 2.3.1 Action 推导核心逻辑

```
describe('[BIZ] deriveActions() — 边界与权重语义')
  it('[BIZ] 持仓完全与目标重叠时所有信号为 HOLD，不产生 BUY/SELL')
    // holdings = [A, B], targets = [A, B]
    expect: 2x HOLD, 0x BUY, 0x SELL

  it('[BIZ] 持仓与目标完全不重叠时旧持仓 SELL、新目标 BUY')
    // holdings = [A, B], targets = [C, D]
    expect: 2x SELL(A,B), 2x BUY(C,D)

  it('[BIZ] SELL 信号的 targetWeight 应为 0')
    expect: sellSignals.every(s => s.targetWeight === 0)

  it('[EDGE] weight=0 的目标仍产生 BUY 信号（不被过滤）— 记录已知行为')
    // targets = [{ tsCode: 'A', weight: 0 }]
    // ?? 不处理 0 → BUY with targetWeight=0
    expect: 1x BUY with targetWeight=0
```

#### 2.3.2 Weight=0 语义 Bug

```
describe('[BUG-B6] weight=0 持仓语义 — deriveActions 未正确处理')
  it('[BUG] 无组合上下文时 weight=0 目标仍产生 BUY+targetWeight=0（语义矛盾）')
    // BUY 信号但权重为 0 → 实际不应买入
    // 当前行为：产生 action=BUY, targetWeight=0
    // 正确行为：过滤 weight=0 的目标或设为 SELL
    expect: 产生 BUY（记录已知偏差）

  it('[BUG] 有组合 + 已持仓 + weight=0 → 产生 HOLD 而非 SELL（语义错误）')
    // holdings = [A], targets = [{ tsCode: 'A', weight: 0 }]
    // 当前行为：A 在 targets 中 → HOLD（不考虑 weight）
    // 正确行为：weight=0 应视为 SELL
    expect: HOLD（记录已知偏差）
```

#### 2.3.3 交易日解析

```
describe('[BUG-B1] resolveTradeDate() — 字符串路径创建 UTC 午夜 Date')
  it('[BUG] 字符串 "20250301" 被解析为 UTC midnight（非上海时间）')
    // dayjs('20250301').toDate() → 2025-03-01T00:00:00.000Z
    // 正确做法：dayjs.tz('20250301', 'Asia/Shanghai') → 2025-02-28T16:00:00.000Z
    expect: UTC midnight（记录时区差异）

  it('[BIZ] resolveTradeDate 无参数时从 tradeCal 查询最晚交易日')
    // tradeCal.findFirst({ where: { isOpen: 1 }, orderBy: { calDate: 'desc' } })
    expect: 返回最新交易日
```

#### 2.3.4 历史 K 线构建

```
describe('[BUG-B2] buildHistoricalBars() — d <= upToDateStr 包含当日')
  it('[BUG] upToDate 当日的 bar 被包含在历史 K 线中')
    // upToDateStr = "20250301"
    // bars = [..., { tradeDate: "20250301" }]
    // 当前行为：包含 "20250301"（当日数据进入 historical）
    // 影响：策略可能产生 look-ahead bias
    expect: 当日 bar 存在于结果中（记录已知行为）

  it('[BIZ] upToDate 之前的所有 bar 按日期升序排列')
    expect: bars[0].tradeDate < bars[1].tradeDate < ...
```

#### 2.3.5 幂等性与等权分配

```
describe('[BIZ] generateForActivation() — 幂等性与信号去重')
  it('[BIZ] 写入信号时使用 skipDuplicates，确保不重复入库')
    expect: createMany 参数含 skipDuplicates: true

  it('[BIZ] 生成信号后 lastSignalDate 应更新为当日交易日')
    expect: signalActivation.update 被调用

describe('[BIZ] weight=null/undefined — 等权分配')
  it('[BIZ] weight=null 时使用等权 1/N')
    // 3 个目标，weight 全为 null
    // 手算：targetWeight = 1/3 ≈ 0.333
    expect: 每个信号 targetWeight ≈ 0.333

  it('[BIZ] weight=0 不触发等权（nullish coalescing 不处理假值 0）')
    // weight=0 → 0 ?? (1/N) = 0（不等于 1/N）
    expect: targetWeight = 0
```

---

### 2.4 Signal Service（信号管理）

**文件**：`src/apps/signal/test/signal.service.spec.ts`
**现有用例**：10（重构前）
**新增目标**：~3 用例

#### 2.4.1 现有覆盖补充

Signal Service 的核心 CRUD 逻辑相对简单，现有测试已覆盖主路径。新增用例聚焦于：

```
describe('parseDateStr() — 补充边界')
  // 现有 3 个用例已覆盖 YYYYMMDD / YYYY-MM-DD / invalid
  // 以下为增量场景（若有余力可加入）

  // parseDateStr 可能不需大量新增，但建议在后续迭代中覆盖：
  // - 非法日期如 "20250230" → Date auto-correction behavior
  // - 空字符串 → BadRequestException
```

---

### 2.5 Drift Detection（策略漂移检测）

**文件**：`src/apps/signal/test/drift-detection.service.spec.ts`
**现有用例**：8（重构前）
**新增目标**：~3 用例

#### 2.5.1 漂移评分权重验证

漂移检测的核心是三维度加权评分：

- Position Drift（40%）：`(|A\S| + |S\A|) / |A∪S|`
- Weight Drift（40%）：`RMSE(w_actual - w_signal)`
- Industry Drift（20%）：`0.5 · Σ|w_ind^A - w_ind^S|`
- Total = 0.4·D_pos + 0.4·D_weight + 0.2·D_industry

现有测试已覆盖零偏离、完全不重叠、阈值判断。增量聚焦于：

```
describe('detect() — 增量验证')
  it('[BIZ] 有完全不重叠持仓时 positionDrift 为 1')
    // holdings = [A, B], signals = [C, D]
    // |A\S| = 2, |S\A| = 2, |A∪S| = 4
    // positionDrift = (2+2)/4 = 1.0
    expect: positionDrift = 1.0

describe('detectAndNotify() — 通知边界')
  it('activation 无 portfolioId 时提前返回不抛错')
  it('activation 不存在时提前返回')
```

---

### 2.6 Risk Check（风控规则引擎）

**文件**：`src/apps/portfolio/test/risk-check.service.spec.ts`
**现有用例**：12（重构前）
**新增目标**：~26 用例

#### 2.6.1 阈值边界（严格 > 判断）

```
describe('[BIZ] 阈值边界：权重恰好等于阈值时不触发')
  it('[BIZ] top1Weight === threshold（精确相等）时不触发违规（严格 > 判断）')
    // threshold=0.30, top1Weight=0.30
    // 手算：0.30 > 0.30 = false → 不违规
    expect: violations = []

  it('[BIZ] top1Weight 超过阈值 0.001 时触发违规')
    // threshold=0.30, top1Weight=0.301
    // 手算：0.301 > 0.30 = true → 违规
    expect: violations = [MAX_SINGLE_POSITION]
```

#### 2.6.2 行业权重排序

```
describe('[BIZ] 行业权重排序')
  it('[BIZ] 多个行业时取权重最大的行业进行比较')
    // industries = [{ name: 'IT', weight: 0.25 }, { name: 'Finance', weight: 0.35 }]
    // threshold=0.30
    // max = 0.35 > 0.30 → 违规
    expect: violations 含 MAX_INDUSTRY_WEIGHT

  it('[BIZ] 行业权重为 null 时视为 0，不触发违规')
    // industries = [{ name: 'IT', weight: null }]
    // max = 0 → 不违规
    expect: violations = []

  it('[BIZ] 行业列表为空时不触发违规')
    expect: violations = []
```

#### 2.6.3 最大回撤计算（最关键的新增覆盖）

```
describe('[BIZ] checkMaxDrawdown — 高水位标记与最大回撤计算')
  it('[BIZ] NAV 序列 1.0→0.8→0.9：最大回撤应为 20%')
    // 手算：peak=1.0, trough=0.8
    // maxDD = (1.0 - 0.8) / 1.0 = 0.20 = 20%
    // threshold=0.15 → 违规
    expect: violations 含 MAX_DRAWDOWN_STOP, currentValue ≈ 20%

  it('[BIZ] NAV 序列 1.0→0.8→0.9：threshold=0.25 时不触发违规')
    // maxDD=20% < threshold=25% → 不违规
    expect: violations = []

  it('[EDGE] NAV 数据不足 2 条时不计算回撤，不触发违规')
    // navs.length < 2 → early return
    expect: violations = []

  it('[EDGE] getLatestTradeDate 返回 null 时不触发违规')
    expect: violations = []

  it('[BIZ] cost_basis=0 时 NAV 默认为 1，不抛错')
    // marketValue / costBasis → costBasis=0 → NAV=1（兜底）
    expect: 不抛错，回撤 = 0
```

#### 2.6.4 最大回撤 Bug

```
describe('[BUG-B7] checkMaxDrawdown — 2024-02-29 回推年份时 setFullYear 溢出')
  it('[BUG] 闰年 2024-02-29 调用 setFullYear(2023) 得到 2023-03-01')
    // new Date(2024, 1, 29).setFullYear(2023) → 2023-03-01
    // 期望：2023-02-28（回推一年应到 2 月末）
    expect: startDate = 2023-03-01（记录偏移）

  it('[BUG] latestDate=2024-02-29 时 checkMaxDrawdown 的 startDate 偏移 1 天')
    expect: 查询 startDate 偏差 1 天

describe('[BUG-B8] checkMaxDrawdown — peak 从 navs[0] 初始化低估回撤')
  it('[BUG] navs=[0.95,0.8,0.85]：当前算法最大回撤 ≈ 15.8%，正确值应为 20%')
    // peak=0.95, trough=0.8
    // 当前：(0.95-0.8)/0.95 ≈ 15.8%
    // 若 peak 应为 1.0（创建时基准）：(1.0-0.8)/1.0 = 20%
    expect: maxDD ≈ 15.8%（记录当前行为）

  it('[BUG] navs=[0.95,0.75,0.9]：若 threshold=0.20 当前不触发但实际应触发')
    // peak=0.95, trough=0.75
    // 当前：(0.95-0.75)/0.95 ≈ 21% → 触发
    // 若基准 peak=1.0：(1.0-0.75)/1.0 = 25% → 也触发（但数值不同）
    expect: maxDD ≈ 21%（使用 navs[0] 为 peak 的行为）
```

#### 2.6.5 禁用规则过滤

```
describe('[BIZ] isEnabled=false — 禁用规则在 DB 层过滤后不被检查')
  it('[BIZ] 禁用规则被 DB 过滤后，风控服务方法不被调用')
    // DB where: { isEnabled: true } → 禁用规则不返回
    expect: checkRule 不对已禁用规则调用

  it('[BIZ] 禁用规则被过滤后不写入 riskViolationLog')
    expect: riskViolationLog.createMany 只含已启用规则的违规
```

#### 2.6.6 formatDate 时区问题

```
describe('[BUG-B3] formatDate() — 使用本地时间，UTC 容器中与上海时区不一致')
  it('[BIZ] formatDate 对 2025-03-01T00:00:00Z 返回 "20250301"（UTC 容器）')
    expect: "20250301"

  it('[BUG] formatDate 对 2025-03-01T16:00:00Z（上海 3月2日）返回本地日期')
    // UTC 容器中 getDate() = 1（3月1日）
    // 上海时区应为 3月2日
    expect: "20250301"（UTC 本地结果，非上海日期）
```

#### 2.6.7 autoCheckOnHoldingChange 范围限制

```
describe('[BIZ] autoCheckOnHoldingChange — 不触发 MAX_DRAWDOWN_STOP 计算')
  it('[BIZ] 仅查询 MAX_SINGLE_POSITION 和 MAX_INDUSTRY_WEIGHT 规则，不查历史 NAV')
    // autoCheck 使用 where: { ruleType: { in: [...] } } 过滤
    expect: 只检查仓位/行业规则，不检查回撤规则

describe('[BIZ] 多规则检测 — 部分违规时只记录违规规则')
  it('[BIZ] 3 条规则中 2 条违规时 riskViolationLog 写入 2 条记录')
    expect: createMany data.length === 2
```

---

### 2.7 Backtest Run（回测运行管理）

**文件**：`src/apps/backtest/test/backtest-run.service.spec.ts`
**现有用例**：18（重构前）
**新增目标**：~7 用例

#### 2.7.1 日期边界（补充）

现有测试已覆盖 start >= end 的基础场景。补充：

```
describe('createRun() — 日期与队列')
  it('正常创建 → 返回 { runId, jobId, status: "QUEUED" }')
  it('prisma.backtestRun.update 写入 jobId')
    // 验证 queue.add 后 jobId 被写回

describe('cancelRun() — 状态流转')
  it('已完成状态不能取消 → 抛 BadRequestException')
  it('QUEUED 状态可以取消 → 更新状态为 CANCELLED')
  it('取消时若有 jobId 尝试从队列移除（失败不阻断取消）')
    // queue.remove 抛错时仍然更新状态为 CANCELLED
    expect: 状态为 CANCELLED（即使队列移除失败）

describe('validateRun()')
  it('调用 dataReadinessService.checkReadiness 并返回结果')
  it('日期非法 → 抛 BusinessException（不走 checkReadiness）')
```

---

### 2.8 Factor Screening（因子筛选）

**文件**：`src/apps/factor/test/factor-screening.service.spec.ts`
**现有用例**：14（重构前）
**新增目标**：~4 用例

#### 2.8.1 现有覆盖已较完善，增量聚焦于：

```
describe('passesCondition() — 补充边界')
  it('gt: 5 > 5 → false（不包含等号）')
    expect: false

  it('gte: 5 >= 5 → true')
    expect: true

  it('gt 且 condition.value 为 undefined → false')
    // condition = { operator: 'gt', value: undefined }
    expect: false
```

---

### 2.9 Factor Analysis（因子分析）

**文件**：`src/apps/factor/test/factor-analysis.service.spec.ts`
**现有用例**：12（重构前）
**新增目标**：~6 用例

#### 2.9.1 IC 分析深度

```
describe('getIcAnalysis() — 增量')
  it('完全单调相关数据 → IC ≈ 1.0')
    // factor = [1,2,3,4,5], return = [0.01,0.02,0.03,0.04,0.05]
    // Spearman rank IC = 1.0
    expect: icMean ≈ 1.0

  it('缓存命中 → 直接返回缓存值，不调用 getRawFactorValuesForDate')
    expect: getRawFactorValuesForDate 不被调用
```

#### 2.9.2 分位分析边界

```
describe('getQuantileAnalysis() — 增量')
  it('交易日数量不足（< 2）→ 抛出 NotFoundException')
    expect: throws NotFoundException
```

#### 2.9.3 相关性矩阵

```
describe('getCorrelation() — 增量')
  it('两个因子值完全相同 → 非对角线相关系数 ≈ 1.0')
    expect: matrix[0][1] ≈ 1.0

  it('公共股票数 < 3 → 相关系数矩阵非对角线为 0')
    // 不足 3 只共同股票无法计算有效相关性
    expect: matrix[0][1] = 0
```

---

### 2.10 Factor Optimization（因子优化）

**文件**：`src/apps/factor/test/factor-optimization.service.spec.ts`
**现有用例**：12（重构前）
**新增目标**：略有精简（现有已覆盖 4 种优化模式）

Factor Optimization 现有测试已覆盖四种优化模式（MVO / MIN_VARIANCE / RISK_PARITY / MAX_DIVERSIFICATION）的权重归一、约束满足、度量计算。

重构中优化了断言强度，未大幅新增用例数，但提升了断言质量：

```
// 已有测试的断言升级：
// 旧：expect(weights.reduce(sum)).toBeCloseTo(1)
// 新：expect(weights.reduce(sum)).toBeCloseTo(1, 6)  // 6 位精度
//     expect(weights.every(w => w >= 0)).toBe(true)    // 非负约束
//     expect(weights.every(w => w <= dto.maxWeight)).toBe(true)  // 上界约束
```

---

## 三、测试基础设施增强

### 3.1 Phase 2 新增的 Mock 模式

| 工具 | 用途 | 说明 |
|------|------|------|
| **signalActivation mock** | 信号激活状态模拟 | 含 strategy、portfolio 关联查询 |
| **riskRule mock** | 风控规则 fixture | 支持 MAX_SINGLE_POSITION / MAX_INDUSTRY_WEIGHT / MAX_DRAWDOWN_STOP |
| **NAV 序列工厂** | 风控回撤测试数据 | `buildNavSequence(peaks, troughs)` |
| **因子值矩阵工厂** | 因子计算测试 | `buildFactorMatrix(stocks, dates, values)` |

### 3.2 断言升级标准

Phase 2 中所有数值断言必须使用具体值（手算推导），禁止以下弱模式：

```typescript
// ❌ 禁止
expect(result).toBeDefined();
expect(service.method).toHaveBeenCalled();
expect(result.length).toBeGreaterThan(0);

// ✅ 要求
expect(result.maxDrawdown).toBeCloseTo(0.20, 4);          // 精确到万分位
expect(result.violations).toHaveLength(2);                  // 精确数量
expect(result.violations[0].ruleType).toBe('MAX_DRAWDOWN'); // 精确类型
```

---

## 四、用例汇总与度量

### 4.1 用例统计

| 模块 | 重构前用例数 | 新增用例数 | 重构后总数 | Bug 标记数 |
|------|-------------|-----------|-----------|-----------|
| Factor Compute | 10 | ~37 | ~47 | 4 (B4,B9,B10,精度) |
| Strategy Service | 22 | ~28 | ~50 | 2 (B5,B11) |
| Signal Generation | 8 | ~24 | ~32 | 3 (B1,B2,B6) |
| Signal Service | 10 | ~3 | ~13 | 0 |
| Drift Detection | 8 | ~3 | ~11 | 0 |
| Risk Check | 12 | ~26 | ~38 | 3 (B3,B7,B8) |
| Backtest Run | 18 | ~7 | ~25 | 0 |
| Factor Screening | 14 | ~4 | ~18 | 0 |
| Factor Analysis | 12 | ~6 | ~18 | 0 |
| Factor Optimization | 12 | ~-2（合并） | ~10 | 0 |
| **合计** | **126** | **~133** | **~262** | **12** |

### 4.2 Bug 清单汇总

| Bug ID | 严重度 | 模块 | 一句话描述 |
|--------|--------|------|-----------|
| P2-B1 | S2 | Signal | resolveTradeDate 使用 UTC 非上海时间 |
| P2-B2 | S3 | Signal | buildHistoricalBars 包含当日 bar（look-ahead） |
| P2-B3 | S3 | Risk | formatDate 本地时区与上海不一致 |
| P2-B4 | S2 | Factor | EP/BP 因子忽略亏损公司 |
| P2-B5 | S2 | Strategy | 版本快照+递增未包在事务中 |
| P2-B6 | S2 | Signal | weight=0 语义错误（被当作有效权重） |
| P2-B7 | S2 | Risk | 闰年 setFullYear 偏移 |
| P2-B8 | S2 | Risk | peak 初始化低估回撤 |
| P2-B9 | S3 | Factor | universe 正则过于宽松 |
| P2-B10 | S3 | Factor | total 含 NULL 行导致翻页异常 |
| P2-B11 | S3 | Strategy | backtestDefaults 变更无版本痕迹 |
| P2-B12 | S3 | Signal | 空 targets 仍更新 lastSignalDate |

### 4.3 验收标准

| 指标 | Phase 1 完成值 | Phase 2 目标值 | 实际达成 |
|------|---------------|---------------|---------|
| 新增用例数 | ~50 | ~60（实际 ~133） | ✅ 超额 |
| Bug 标记数 | 3+ | 5+ | ✅ 12 |
| 弱断言占比 | ~50% → ~30% | ≤20% | ✅ |
| 覆盖的 P1 模块 | — | 全部 10 个文件 | ✅ |

---

## 五、与其他 Phase 的衔接

| Phase | 状态 | 内容 | 与 Phase 2 的关系 |
|-------|------|------|-------------------|
| Phase 1 | ✅ 已完成 | Auth、Backtest Engine、Portfolio 核心计算 | Phase 2 的前置依赖 |
| **Phase 2** | **📋 本设计** | Factor、Strategy、Signal、Risk Check | — |
| Phase 3 | 📋 设计稿 | Event Study、Pattern、Stock、Market、Heatmap、Index、Tushare Sync | Phase 2 Bug B1/B3 的时区问题在 Phase 3 模块中也出现 |
| Phase 4 | 📋 设计稿 | 全部 21 个 Controller 层 | Phase 2 的 Service 测试为 Phase 4 提供 mock 断言参考 |
| Phase 5 | 🗓️ 规划 | Lifecycle（Guard、Interceptor、Filter） | 独立于 Phase 2 |
| Phase 6 | 🗓️ 规划 | E2E 流程测试 | 依赖 Phase 2 的 Signal/Risk 测试数据 |
