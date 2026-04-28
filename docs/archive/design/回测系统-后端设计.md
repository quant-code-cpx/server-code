# 策略回测（Backtesting）— 后端实现规划

> **目标读者**：AI 代码生成助手。请严格按照本文定义的模块边界、接口签名、执行规则、数据依赖和持久化结构实现。不要把本规划理解成“简单跑一个假回测任务”，而是实现一个可持续扩展的 A 股日频策略回测模块。

---

## 一、目标与范围

本模块的目标不是做一个“返回几个绩效指标的假接口”，而是做一个**可执行真实日频策略回测**的研究模块，满足以下需求：

1. 提交策略回测任务
2. 异步执行长时间回测（BullMQ）
3. 通过 WebSocket 推送任务进度
4. 将回测结果持久化到数据库
5. 支持查看回测摘要、收益曲线、回撤、交易明细、持仓快照、调仓日志
6. 支持多种策略模板（至少 3~4 种）
7. 支持回测前的数据完备性校验，避免“提交成功但结果不可信”

### 一期必须实现（MVP）

- **日频、A 股、做多、多标的组合回测**
- **按日收盘生成信号，默认下一个交易日开盘撮合**
- 策略模板：
  - `MA_CROSS_SINGLE`：单股票均线择时（用于引擎 sanity check）
  - `SCREENING_ROTATION`：基于选股器条件的定期轮动
  - `FACTOR_RANKING`：基于现有因子/评分的定期轮动
  - `CUSTOM_POOL_REBALANCE`：自定义股票池等权/自定义权重再平衡
- 回测产物：
  - 摘要指标（收益、年化、回撤、夏普、波动率、胜率等）
  - 日度净值曲线 / 基准曲线 / 回撤曲线
  - 月收益统计
  - 交易明细
  - 持仓快照
  - 调仓日志
- 异步任务状态：排队 / 执行中 / 成功 / 失败 / 取消

### 二期增强（不是本次必须）

- 止损止盈 / 仓位风控规则
- 事件驱动 / 盘中级别回测
- 融资融券 / 做空 / 杠杆
- 自定义脚本策略 DSL
- 多策略组合对比
- Walk-forward / 参数寻优

---

## 二、现有实现评估：哪些能沿用，哪些必须重构

当前仓库已有两个和“回测”沾边的部分，但**都不能直接等同于正式策略回测模块**。

### 2.1 现有 `src/queue/backtesting/` 模板评估

当前已有：

- `POST /backtesting/submit`
- `POST /backtesting/status`
- BullMQ 队列：`BACKTESTING_QUEUE`
- WebSocket 事件：
  - `subscribe_backtest`
  - `backtest_progress`
  - `backtest_completed`
  - `backtest_failed`

#### 当前模板的优点（保留）

- ✅ 已接入 BullMQ，适合长任务异步执行
- ✅ 已接入 `EventsGateway`，支持按 `jobId` 订阅任务进度
- ✅ 有基础 DTO 和处理器骨架，可作为最底层“任务执行通道”保留

#### 当前模板的缺陷（必须重构）

- ❌ `SubmitBacktestingDto` 只有 `strategyId / startDate / endDate / initialCapital / params`，远远不够
- ❌ 没有 benchmark、股票池、交易成本、调仓频率、执行价格模型等关键参数
- ❌ `processor` 返回的是假数据，没有真实引擎
- ❌ 回测结果**没有数据库持久化**，Bull job 清理后就丢失
- ❌ 没有任务历史列表、详情、取消、复制重跑等接口
- ❌ 没有数据完备性校验，无法判断回测结果是否可信
- ❌ 业务 controller/service 全放在 `src/queue/backtesting/` 下，职责边界不清晰

### 2.2 现有 `factor/analysis/quantile` 评估

仓库当前已有 `POST /factor/analysis/quantile` 等因子分析接口。

#### 它能做什么

- 做**分层回测 / 因子有效性研究**
- 输出 quantile 收益序列
- 用于评价因子的截面排序能力

#### 它不能替代什么

- 不能替代真实组合持仓回测
- 不管理现金、仓位、交易成本、调仓约束
- 不产出真实交易明细 / 持仓快照
- 不适合作为“策略回测模块”的最终实现

### 2.3 最终结论

**推荐方案：保留 BullMQ + WebSocket 思路，但重构为真正的 `BacktestModule`。**

即：

- **保留**：队列、任务处理器、WebSocket 推送机制
- **重构**：Controller、Service、DTO、回测引擎、数据库持久化、策略模板、报告查询接口

---

## 三、数据底座是否足够

## 3.1 当前已存在且可直接用于回测的数据表

下表为本地实际已落库的数据（已抽查真实表行数）：

| 表名                            | 用途                       | 当前数据量    | 是否可用 |
| ------------------------------- | -------------------------- | ------------- | -------- |
| `stock_daily_prices`            | 个股日线 OHLCV             | 17,600,990    | ✅ 可用  |
| `stock_adjustment_factors`      | 复权因子                   | 18,420,928    | ✅ 可用  |
| `stock_daily_valuation_metrics` | daily_basic 指标           | 17,504,029    | ✅ 可用  |
| `exchange_trade_calendars`      | 交易日历                   | 26,128        | ✅ 可用  |
| `index_daily_prices`            | 基准指数行情               | 3,275         | ✅ 可用  |
| `stock_basic_profiles`          | 股票基础信息               | 5,494（上市） | ✅ 可用  |
| `financial_indicator_snapshots` | 财务指标（ROE/增速等）     | 245,953       | ✅ 可用  |
| `income_statement_reports`      | 利润表                     | 309,526       | ✅ 可用  |
| `balance_sheet_reports`         | 资产负债表                 | 337,844       | ✅ 可用  |
| `cashflow_reports`              | 现金流量表                 | 315,553       | ✅ 可用  |
| `stock_capital_flows`           | 个股资金流向（近60交易日） | 310,558       | ✅ 可用  |
| `stock_dividend_events`         | 分红送转事件               | 158,625       | ✅ 可用  |

### 这些数据能支持什么

- 价格回测：`daily + trade_cal`
- 复权处理：`adj_factor`
- 基准收益：`index_daily`
- 基本面信号：`daily_basic + fina_indicator + income + balance_sheet + cashflow`
- 因子 / 评分策略：现有 factor 模块 + 股票基本面
- 股票池过滤：`stock_basic`
- 资金流向策略：`moneyflow`

## 3.2 当前不够的地方

以下三张表**对 A 股真实可交易回测非常关键**，但目前库里还是空表：

| 表名                        | 当前行数 | 作用                           | 结论          |
| --------------------------- | -------- | ------------------------------ | ------------- |
| `stock_limit_prices`        | 0        | 判断涨跌停可否成交             | ❗ 必须补数据 |
| `stock_suspend_events`      | 0        | 判断停牌不可成交               | ❗ 必须补数据 |
| `index_constituent_weights` | 0        | 历史指数成分股，避免幸存者偏差 | ❗ 必须补数据 |

### 为什么这三张表必须补

#### `stock_limit_prices`

没有它，回测会默认“涨停也能买、跌停也能卖”，结果会虚高，尤其是强趋势或打板类策略。

#### `stock_suspend_events`

没有它，回测会默认停牌股票也能撮合，这在 A 股是不成立的。

#### `index_constituent_weights`

没有它，若股票池使用“沪深300 / 中证500 / 中证1000 / 上证50”，就只能用**当前成分股**代替历史成分股，会产生明显的**幸存者偏差**。

## 3.3 最终判断

### 研究级别（可勉强跑）

如果只是快速验证策略方向，可以先在没有 `stk_limit / suspend_d / index_weight` 的情况下跑“研究版回测”，但结果不适合当成正式回测报告。

### 正式回测（本规划默认目标）

必须补齐：

- `stk_limit`
- `suspend_d`
- `index_weight`

**因此结论是：当前数据底座“接近够用”，但要做正式回测仍需补数据。**

---

## 四、是否需要新增 Tushare 数据 / 同步逻辑

## 4.1 结论先说

### 本次回测模块一期：

- **需要新增回测依赖数据**（`stk_limit / suspend_d / index_weight`）
- **但不需要从零新增 Tushare API 封装与同步服务**

因为这三项的同步链路已经在仓库里存在：

- `FactorDataApiService`
- `FactorDataSyncService`
- `mapStkLimitRecord`
- `mapSuspendDRecord`
- `mapIndexWeightRecord`
- `TushareSyncTaskName.STK_LIMIT`
- `TushareSyncTaskName.SUSPEND_D`
- `TushareSyncTaskName.INDEX_WEIGHT`

也就是说，**要补的是“把已有同步计划真正跑起来并纳入正式回测依赖校验”，不是重新写一套 Tushare 接入。**

## 4.2 当前已有同步计划

`FactorDataSyncService` 已内置以下任务：

| Task           | 标签         | 当前计划        | 说明            |
| -------------- | ------------ | --------------- | --------------- |
| `STK_LIMIT`    | 涨跌停价格   | 交易日 19:30    | 已支持增量/全量 |
| `SUSPEND_D`    | 停牌信息     | 交易日 19:35    | 已支持增量/全量 |
| `INDEX_WEIGHT` | 指数成分权重 | 每月 1 日 20:00 | 已支持增量/全量 |

## 4.3 需要补的不是后端 API，而是“正式启用链路”

### 必做项 A：把这三项纳入正式回测依赖

新增 `BacktestDataReadinessService`，在提交回测前校验：

- 回测区间内是否有 `daily`
- 回测区间内是否有 `adj_factor`
- 回测区间内是否有 `trade_cal`
- 如启用真实交易约束，是否有 `stk_limit`
- 如启用停牌过滤，是否有 `suspend_d`
- 如 universe 是指数成分池，是否有 `index_weight`
- 基准指数 `index_daily` 是否完整

### 必做项 B：前端同步页面补出 `factor` 分类

当前 `client-code/src/sections/tushare-sync/view/tushare-sync-view.tsx` 只展示：

- `basic`
- `market`
- `financial`
- `moneyflow`

但 `factor` 分类没有出现在 `CATEGORY_LABELS / CATEGORY_ORDER` 中，因此：

- `STK_LIMIT`
- `SUSPEND_D`
- `INDEX_WEIGHT`

虽然**后端已经支持**，但**同步管理页当前看不到这些任务**。

> 这意味着：如果不改同步管理前端，用户很难手动补齐回测必需数据。

### 必做项 C：回测模块拒绝“数据不完整”的正式回测

如果以下任意条件不满足：

- 价格数据缺失
- 基准数据缺失
- `stk_limit` / `suspend_d` 缺失但又启用了真实交易约束
- index universe 回测但 `index_weight` 缺失

则 `POST /backtests/runs/validate` 应返回 `isValid = false` 或 warning，`POST /backtests/runs` 应阻止正式提交。

## 4.4 是否需要额外新增 Tushare 接口（一期）

### 一期不强制新增

本次一期正式回测，**不强制再额外接入新的 Tushare 接口**，因为：

- 真实成交约束：`stk_limit` 已足够做日频近似
- 停牌：`suspend_d` 已足够
- 历史指数股票池：`index_weight` 已足够
- 信号构建：现有 `daily / daily_basic / fina_indicator / income / balance_sheet / cashflow / moneyflow` 已够用

### 可选增强（不是一期必须）

| 接口名称       | 积分要求 | 用途                                             | 一期是否必须 |
| -------------- | -------- | ------------------------------------------------ | ------------ |
| `limit_list_d` | 5000     | 更精细的涨跌停明细（封板时间、原因、是否一字板） | 否           |

> 一期不依赖 `limit_list_d`。若后续要做更高拟真度的“封板打不开 / 炸板 / 临停”回测，再单独引入。

---

## 五、推荐架构：不要把正式业务继续堆在 `src/queue/backtesting/`

## 5.1 推荐模块结构

建议新增独立 `BacktestModule`，而不是继续把 controller/service 全塞在 `QueueModule` 里。

```text
src/apps/backtest/
├── backtest.module.ts
├── backtest.controller.ts
├── dto/
│   ├── backtest-validate.dto.ts
│   ├── create-backtest-run.dto.ts
│   ├── list-backtest-runs.dto.ts
│   ├── backtest-trade-query.dto.ts
│   ├── backtest-position-query.dto.ts
│   └── backtest-response.dto.ts
├── services/
│   ├── backtest-run.service.ts            # 提交、取消、历史列表、详情
│   ├── backtest-data-readiness.service.ts # 数据完备性校验
│   ├── backtest-data.service.ts           # 统一读取行情/交易日/基准/停牌/涨跌停/指数成分
│   ├── backtest-engine.service.ts         # 回测主循环 orchestrator
│   ├── backtest-execution.service.ts      # 下单撮合 / 交易成本 / 可成交判断
│   ├── backtest-metrics.service.ts        # 收益/回撤/夏普/胜率/换手等指标
│   ├── backtest-report.service.ts         # 汇总曲线、月收益、摘要
│   └── backtest-strategy-registry.service.ts
├── strategies/
│   ├── backtest-strategy.interface.ts
│   ├── ma-cross-single.strategy.ts
│   ├── screening-rotation.strategy.ts
│   ├── factor-ranking.strategy.ts
│   └── custom-pool-rebalance.strategy.ts
└── types/
    └── backtest-engine.types.ts

src/queue/backtesting/
├── backtesting.processor.ts               # BullMQ worker，仅负责调用 engine
└── backtesting.queue.service.ts           # enqueue / job helpers
```

## 5.2 对现有 `QueueModule` 的建议

### 可以保留的部分

- `BullModule.forRootAsync(...)`
- 队列名称 `BACKTESTING_QUEUE`
- `EventsGateway` WebSocket 推送

### 不建议继续保留的部分

- `BacktestingController` 不应再挂在 `src/queue/backtesting/`
- `BacktestingService` 不应再同时承担“API 入参 + 队列提交 + 状态查询 + 业务编排”
- `BacktestingProcessor` 不应直接写业务逻辑细节，应调用 `BacktestEngineService`

## 5.3 推荐落地方式

### 方案 A（推荐）

- 新建 `BacktestModule`
- `QueueModule` 只保留 BullMQ 基础设施
- `BacktestingProcessor` 注入 `BacktestEngineService`
- controller/service/dto 全部迁移到 `src/apps/backtest/`

### 方案 B（不推荐，但可兼容过渡）

- 保持 `QueueModule` 不动
- 在 `src/queue/backtesting/` 下继续扩容正式功能

> 不推荐方案 B，因为会让“队列基础设施模块”和“回测业务模块”长期耦合，违背单一职责。

---

## 六、策略模板设计（必须内置）

回测模块不是直接执行自由脚本，而是先提供**内置策略模板**，每个模板有固定参数 schema，便于前端动态渲染表单。

## 6.1 `MA_CROSS_SINGLE` — 单股均线择时

**用途**：

- 用作引擎 sanity check
- 让回测链路先在单股票上可验证

**参数**：

```typescript
interface MaCrossSingleConfig {
  tsCode: string
  shortWindow: number // 默认 5
  longWindow: number // 默认 20
  priceField?: 'close' // 一期固定 close
  allowFlat?: boolean // 默认 true
}
```

**逻辑**：

- 短均线上穿长均线 → 下一交易日开盘买入
- 短均线下穿长均线 → 下一交易日开盘卖出
- 单股票满仓 / 空仓切换

## 6.2 `SCREENING_ROTATION` — 选股器轮动

**用途**：

- 复用选股器筛选 DSL
- 最契合当前项目的“研究 -> 回测”闭环

**参数**：

```typescript
interface ScreeningRotationConfig {
  screenerFilters: Record<string, unknown> // 与 /stock/screener 的筛选条件一致
  rankBy?: string // 如 totalMv / peTtm / dvTtm / roe / revenueYoy
  rankOrder?: 'asc' | 'desc'
  topN: number // 默认 20
  rebalanceFrequency: 'WEEKLY' | 'MONTHLY'
  weightMode?: 'EQUAL' | 'RANK'
  minDaysListed?: number // 默认 60
}
```

**逻辑**：

- 每次调仓日先跑一次选股 DSL
- 按 `rankBy` 取 Top N
- 卖出不在目标池中的股票，买入新股票
- 默认等权

## 6.3 `FACTOR_RANKING` — 因子排序轮动

**用途**：

- 与现有 factor 模块打通
- 将“因子分析 -> 因子选股 -> 组合回测”闭环串起来

**参数**：

```typescript
interface FactorRankingConfig {
  factorName: string
  universe: 'ALL_A' | 'HS300' | 'CSI500' | 'CSI1000' | 'SSE50'
  rankOrder: 'asc' | 'desc'
  topN?: number
  quantile?: number // 如 top quantile = 5
  rebalanceFrequency: 'WEEKLY' | 'MONTHLY'
  minDaysListed?: number
  optionalFilters?: {
    minTotalMv?: number
    minTurnoverRate?: number
    maxPeTtm?: number
  }
}
```

**逻辑**：

- 每个调仓日获取指定股票池的因子值
- 按因子值排序取 Top N 或 Top quantile
- 组合做多持有到下个调仓日

## 6.4 `CUSTOM_POOL_REBALANCE` — 自定义股票池再平衡

**用途**：

- 给用户做“手动股票池回测”
- 也适合后续从 watchlist / 选股结果一键发起回测

**参数**：

```typescript
interface CustomPoolRebalanceConfig {
  tsCodes: string[]
  rebalanceFrequency: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY'
  weightMode: 'EQUAL' | 'CUSTOM'
  customWeights?: Array<{ tsCode: string; weight: number }>
}
```

---

## 七、统一回测执行规则（必须严格实现）

以下规则是为了避免 AI 生成一个“看起来在回测，实际上充满未来函数”的实现。

## 7.1 时间口径

- 信号日期：`T`
- 默认撮合日期：`T+1` 交易日
- 默认撮合价格：`T+1` 开盘价（`NEXT_OPEN`）
- 允许可选价格模型：`NEXT_CLOSE`

### 禁止的错误实现

- ❌ 当天收盘生成信号，当天收盘成交
- ❌ 直接使用未来已知的复权价格做撮合

## 7.2 成交约束

### 买入约束

以下任一命中则买单跳过：

- `suspend_d` 标记停牌
- `stk_limit` 显示涨停且撮合价格无法合理成交
- 开盘价缺失 / 成交量为 0

### 卖出约束

以下任一命中则卖单无法成交，继续持仓：

- `suspend_d` 停牌
- `stk_limit` 显示跌停且无法合理成交
- 开盘价缺失 / 成交量为 0

## 7.3 交易成本

默认值：

```typescript
commissionRate = 0.0003 // 3 bps
stampDutyRate = 0.0005 // 5 bps，卖出收取
minCommission = 5
slippageBps = 5 // 5 bps
```

### 执行顺序

1. 先卖出
2. 再买入
3. 卖出释放现金后才能买入
4. 买入数量按 100 股整数倍向下取整

## 7.4 复权与收益计算

### 一期推荐实现

- **撮合价格使用原始行情价格（raw `daily`）**
- **信号构建允许使用 `adj_factor` 计算后的连续收益序列**
- **持仓收益计算应基于相邻两日 `adj_factor` 比率处理除权除息影响**

### 强制要求

- 不要直接把“当前时点一次性计算出的 qfq 全序列”拿来做成交价
- 避免未来函数

## 7.5 股票池口径

### 若 `universe = ALL_A`

- `stock_basic_profiles.list_status = 'L'`
- `list_date <= T`
- 默认排除上市不足 `minDaysListed` 的新股

### 若 `universe = HS300 / CSI500 / CSI1000 / SSE50`

- 必须按 `index_constituent_weights` 的**历史成分**取股票池
- 禁止用“当前成分股”替代历史成分股

---

## 八、接口设计

统一前缀：`/backtests`

> 不再建议继续使用 `/backtesting/submit` 这种模板式接口作为正式 API。若要兼容，可保留旧接口并内部转发到新服务。

## 8.1 `GET /backtests/strategy-templates`

**功能**：获取内置策略模板和参数 schema，供前端动态渲染表单。

#### 响应结构

```typescript
interface StrategyTemplateResponse {
  templates: Array<{
    id: 'MA_CROSS_SINGLE' | 'SCREENING_ROTATION' | 'FACTOR_RANKING' | 'CUSTOM_POOL_REBALANCE'
    name: string
    description: string
    category: 'TECHNICAL' | 'SCREENING' | 'FACTOR' | 'CUSTOM'
    parameterSchema: Array<{
      field: string
      label: string
      type: 'string' | 'number' | 'select' | 'multiselect' | 'boolean' | 'json'
      required: boolean
      defaultValue?: unknown
      options?: Array<{ label: string; value: string }>
      placeholder?: string
      helpText?: string
    }>
  }>
}
```

## 8.2 `POST /backtests/runs/validate`

**功能**：在正式提交前校验配置合法性与数据完整性。

#### 请求 DTO：`ValidateBacktestRunDto`

```typescript
class ValidateBacktestRunDto {
  strategyType: BacktestStrategyType
  strategyConfig: Record<string, unknown>
  startDate: string // YYYYMMDD
  endDate: string // YYYYMMDD
  benchmarkTsCode?: string = '000300.SH'
  universe?: 'ALL_A' | 'HS300' | 'CSI500' | 'CSI1000' | 'SSE50' | 'CUSTOM'
  initialCapital: number
  rebalanceFrequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY'
  priceMode?: 'NEXT_OPEN' | 'NEXT_CLOSE'
  enableTradeConstraints?: boolean = true
}
```

#### 响应结构

```typescript
interface ValidateBacktestRunResponse {
  isValid: boolean
  warnings: string[]
  errors: string[]
  dataReadiness: {
    hasDaily: boolean
    hasAdjFactor: boolean
    hasTradeCal: boolean
    hasIndexDaily: boolean
    hasStkLimit: boolean
    hasSuspendD: boolean
    hasIndexWeight: boolean
  }
  stats: {
    tradingDays: number
    estimatedUniverseSize: number | null
    earliestAvailableDate: string | null
    latestAvailableDate: string | null
  }
}
```

## 8.3 `POST /backtests/runs`

**功能**：创建回测运行记录并投递 BullMQ 任务。

#### 请求 DTO：`CreateBacktestRunDto`

```typescript
class CreateBacktestRunDto {
  name?: string
  strategyType: BacktestStrategyType
  strategyConfig: Record<string, unknown>

  startDate: string // YYYYMMDD
  endDate: string // YYYYMMDD
  benchmarkTsCode?: string = '000300.SH'
  universe?: 'ALL_A' | 'HS300' | 'CSI500' | 'CSI1000' | 'SSE50' | 'CUSTOM'
  customUniverseTsCodes?: string[]

  initialCapital: number
  rebalanceFrequency?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' = 'MONTHLY'
  priceMode?: 'NEXT_OPEN' | 'NEXT_CLOSE' = 'NEXT_OPEN'

  commissionRate?: number = 0.0003
  stampDutyRate?: number = 0.0005
  minCommission?: number = 5
  slippageBps?: number = 5

  maxPositions?: number = 20
  maxWeightPerStock?: number = 0.1
  minDaysListed?: number = 60

  enableTradeConstraints?: boolean = true
}
```

#### 响应结构

```typescript
interface CreateBacktestRunResponse {
  runId: string
  jobId: string
  status: 'QUEUED'
}
```

## 8.4 `GET /backtests/runs`

**功能**：分页查询回测历史。

#### 请求参数

- `page`
- `pageSize`
- `status`
- `strategyType`
- `keyword`（按名称模糊搜索）

#### 响应结构

```typescript
interface BacktestRunListResponse {
  page: number
  pageSize: number
  total: number
  items: Array<{
    runId: string
    name: string | null
    strategyType: string
    status: string
    startDate: string
    endDate: string
    benchmarkTsCode: string
    totalReturn: number | null
    annualizedReturn: number | null
    maxDrawdown: number | null
    sharpeRatio: number | null
    progress: number
    createdAt: string
    completedAt: string | null
  }>
}
```

## 8.5 `GET /backtests/runs/:runId`

**功能**：获取某次回测的摘要、配置、状态。

#### 响应结构

```typescript
interface BacktestRunDetailResponse {
  runId: string
  jobId: string | null
  name: string | null
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  progress: number
  failedReason: string | null

  strategyType: string
  strategyConfig: Record<string, unknown>
  startDate: string
  endDate: string
  benchmarkTsCode: string
  universe: string
  initialCapital: number
  rebalanceFrequency: string
  priceMode: string

  summary: {
    totalReturn: number | null
    annualizedReturn: number | null
    benchmarkReturn: number | null
    excessReturn: number | null
    maxDrawdown: number | null
    sharpeRatio: number | null
    sortinoRatio: number | null
    calmarRatio: number | null
    volatility: number | null
    alpha: number | null
    beta: number | null
    informationRatio: number | null
    winRate: number | null
    turnoverRate: number | null
    tradeCount: number | null
  }

  createdAt: string
  startedAt: string | null
  completedAt: string | null
}
```

## 8.6 `GET /backtests/runs/:runId/equity`

**功能**：获取日度净值序列、基准序列、回撤序列。

```typescript
interface BacktestEquityResponse {
  points: Array<{
    tradeDate: string
    nav: number
    benchmarkNav: number
    drawdown: number
    dailyReturn: number
    benchmarkReturn: number
    exposure: number
    cashRatio: number
  }>
}
```

## 8.7 `GET /backtests/runs/:runId/trades`

**功能**：分页查询交易明细。

```typescript
interface BacktestTradeListResponse {
  page: number
  pageSize: number
  total: number
  items: Array<{
    tradeDate: string
    tsCode: string
    name: string | null
    side: 'BUY' | 'SELL'
    price: number
    quantity: number
    amount: number
    commission: number
    stampDuty: number
    slippageCost: number
    reason: string | null
  }>
}
```

## 8.8 `GET /backtests/runs/:runId/positions`

**功能**：按某个交易日查询持仓快照；不传日期则返回最新持仓。

```typescript
interface BacktestPositionResponse {
  tradeDate: string
  items: Array<{
    tsCode: string
    name: string | null
    quantity: number
    costPrice: number
    closePrice: number
    marketValue: number
    weight: number
    unrealizedPnl: number
    holdingDays: number
  }>
}
```

## 8.9 `POST /backtests/runs/:runId/cancel`

**功能**：取消排队中或执行中的回测任务。

#### 响应结构

```typescript
interface CancelBacktestRunResponse {
  runId: string
  status: 'CANCELLED'
}
```

---

## 九、数据库持久化设计（Prisma 模型）

> 现有 TODO 中提到的单个 `BacktestResult` 模型不够。正式实现建议采用“运行主表 + 日度净值 + 交易明细 + 持仓快照”的规范化结构。

## 9.1 `BacktestRun`

**用途**：回测主表，记录配置、状态和摘要指标。

建议字段：

```prisma
model BacktestRun {
  id                String   @id @default(cuid())
  userId            Int      @map("user_id")
  jobId             String?  @map("job_id")
  name              String?  @db.VarChar(128)

  strategyType      String   @map("strategy_type") @db.VarChar(64)
  strategyConfig    Json     @map("strategy_config")

  startDate         DateTime @map("start_date") @db.Date
  endDate           DateTime @map("end_date") @db.Date
  benchmarkTsCode   String   @map("benchmark_ts_code") @db.VarChar(16)
  universe          String   @db.VarChar(32)
  customUniverse    Json?    @map("custom_universe")

  initialCapital    Decimal  @map("initial_capital") @db.Decimal(20, 4)
  rebalanceFrequency String  @map("rebalance_frequency") @db.VarChar(32)
  priceMode         String   @map("price_mode") @db.VarChar(32)

  commissionRate    Decimal? @map("commission_rate") @db.Decimal(10, 6)
  stampDutyRate     Decimal? @map("stamp_duty_rate") @db.Decimal(10, 6)
  minCommission     Decimal? @map("min_commission") @db.Decimal(20, 4)
  slippageBps       Int?     @map("slippage_bps")

  status            String   @db.VarChar(32)
  progress          Int      @default(0)
  failedReason      String?  @map("failed_reason") @db.Text

  totalReturn       Float?   @map("total_return")
  annualizedReturn  Float?   @map("annualized_return")
  benchmarkReturn   Float?   @map("benchmark_return")
  excessReturn      Float?   @map("excess_return")
  maxDrawdown       Float?   @map("max_drawdown")
  sharpeRatio       Float?   @map("sharpe_ratio")
  sortinoRatio      Float?   @map("sortino_ratio")
  calmarRatio       Float?   @map("calmar_ratio")
  volatility        Float?
  alpha             Float?
  beta              Float?
  informationRatio  Float?   @map("information_ratio")
  winRate           Float?   @map("win_rate")
  turnoverRate      Float?   @map("turnover_rate")
  tradeCount        Int?     @map("trade_count")

  createdAt         DateTime @default(now()) @map("created_at")
  startedAt         DateTime? @map("started_at")
  completedAt       DateTime? @map("completed_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@index([userId, createdAt(sort: Desc)])
  @@index([status, createdAt(sort: Desc)])
  @@map("backtest_runs")
}
```

## 9.2 `BacktestDailyNav`

**用途**：保存每日净值序列与回撤，供曲线图与月收益统计使用。

```prisma
model BacktestDailyNav {
  runId            String   @map("run_id")
  tradeDate        DateTime @map("trade_date") @db.Date
  nav              Decimal  @db.Decimal(20, 8)
  benchmarkNav     Decimal? @map("benchmark_nav") @db.Decimal(20, 8)
  dailyReturn      Float?   @map("daily_return")
  benchmarkReturn  Float?   @map("benchmark_return")
  drawdown         Float?
  cash             Decimal? @db.Decimal(20, 4)
  positionValue    Decimal? @map("position_value") @db.Decimal(20, 4)
  exposure         Float?
  cashRatio        Float?   @map("cash_ratio")

  @@id([runId, tradeDate])
  @@index([tradeDate])
  @@map("backtest_daily_navs")
}
```

## 9.3 `BacktestTrade`

**用途**：保存每笔成交记录。

```prisma
model BacktestTrade {
  id            BigInt   @id @default(autoincrement())
  runId         String   @map("run_id")
  tradeDate     DateTime @map("trade_date") @db.Date
  tsCode        String   @map("ts_code") @db.VarChar(16)
  side          String   @db.VarChar(8)
  price         Decimal  @db.Decimal(20, 4)
  quantity      Int
  amount        Decimal  @db.Decimal(20, 4)
  commission    Decimal? @db.Decimal(20, 4)
  stampDuty     Decimal? @map("stamp_duty") @db.Decimal(20, 4)
  slippageCost  Decimal? @map("slippage_cost") @db.Decimal(20, 4)
  reason        String?  @db.Text
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([runId, tradeDate(sort: Desc)])
  @@index([tsCode, tradeDate(sort: Desc)])
  @@map("backtest_trades")
}
```

## 9.4 `BacktestPositionSnapshot`

**用途**：保存调仓后或日末持仓快照。

```prisma
model BacktestPositionSnapshot {
  runId          String   @map("run_id")
  tradeDate      DateTime @map("trade_date") @db.Date
  tsCode         String   @map("ts_code") @db.VarChar(16)
  quantity       Int
  costPrice      Decimal? @map("cost_price") @db.Decimal(20, 4)
  closePrice     Decimal? @map("close_price") @db.Decimal(20, 4)
  marketValue    Decimal? @map("market_value") @db.Decimal(20, 4)
  weight         Float?
  unrealizedPnl  Decimal? @map("unrealized_pnl") @db.Decimal(20, 4)
  holdingDays    Int?     @map("holding_days")

  @@id([runId, tradeDate, tsCode])
  @@index([runId, tradeDate(sort: Desc)])
  @@map("backtest_position_snapshots")
}
```

## 9.5 `BacktestRebalanceLog`（推荐）

**用途**：保存每次调仓日志，便于解释为什么没有买上/没卖掉。

```prisma
model BacktestRebalanceLog {
  id              BigInt   @id @default(autoincrement())
  runId           String   @map("run_id")
  signalDate      DateTime @map("signal_date") @db.Date
  executeDate     DateTime @map("execute_date") @db.Date
  targetCount     Int?     @map("target_count")
  executedBuyCount Int?    @map("executed_buy_count")
  executedSellCount Int?   @map("executed_sell_count")
  skippedLimitCount Int?   @map("skipped_limit_count")
  skippedSuspendCount Int? @map("skipped_suspend_count")
  message         String?  @db.Text

  @@index([runId, signalDate(sort: Desc)])
  @@map("backtest_rebalance_logs")
}
```

---

## 十、BullMQ / WebSocket 设计

## 10.1 队列保留

继续使用：

- Queue: `BACKTESTING_QUEUE`
- Job: `run-backtest`

## 10.2 Job 数据结构（重写）

当前 `BacktestingJobData` 太简单，建议改为：

```typescript
interface BacktestJobData {
  runId: string
  userId: number
}
```

不要把整个配置大对象都塞进 Bull payload；配置应以 `runId` 为主，从数据库读取。这么做的好处：

- 任务 payload 更稳定
- 便于重试
- 便于取消/恢复/复制运行
- 避免 job payload 与数据库状态不一致

## 10.3 WebSocket 事件建议沿用

继续沿用当前 `EventsGateway` 的这套协议：

- 客户端发：`subscribe_backtest` / `unsubscribe_backtest`
- 服务端推：
  - `backtest_progress`
  - `backtest_completed`
  - `backtest_failed`

建议扩展 payload：

```typescript
backtest_progress: {
  jobId: string
  runId: string
  progress: number
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  step: 'loading-data' | 'generating-signals' | 'matching-orders' | 'computing-metrics' | 'persisting-report'
  message?: string
}
```

---

## 十一、实施顺序建议

```text
Step 1: 新建 Prisma 本地模型（BacktestRun / BacktestDailyNav / BacktestTrade / BacktestPositionSnapshot / BacktestRebalanceLog）
Step 2: prisma generate + 迁移
Step 3: 新建 BacktestModule（controller + dto + services）
Step 4: 把现有 BullMQ processor 改为仅调用 BacktestEngineService
Step 5: 实现 BacktestDataReadinessService（校验 daily/adj_factor/trade_cal/index_daily/stk_limit/suspend_d/index_weight）
Step 6: 实现 StrategyRegistry + 4 个内置策略模板
Step 7: 实现 BacktestExecutionService（交易约束 / 费用 / 滑点 / 买卖顺序 / 100股取整）
Step 8: 实现 BacktestEngineService 主循环
Step 9: 实现 BacktestMetricsService + BacktestReportService
Step 10: 实现对外 API（templates / validate / create / list / detail / equity / trades / positions / cancel）
Step 11: 补齐并运行 STK_LIMIT / SUSPEND_D / INDEX_WEIGHT 同步
Step 12: 编译验证 → Docker 重启 → 日志检查 → 真实跑一个 MA_CROSS_SINGLE sanity case
```

---

## 十二、关键注意事项

1. **不要把正式业务继续堆在 `src/queue/backtesting/`**。队列是执行通道，不是完整业务模块。
2. **不要直接使用当前一次性复权价格做撮合**，避免未来函数。
3. **正式回测默认必须开启数据完备性校验**，否则结果可信度太低。
4. **`stk_limit / suspend_d / index_weight` 不应只做增量存在校验，还要做区间覆盖校验**。
5. **回测持久化模型要用本地业务表，不要依赖 Bull job return value 当唯一结果来源**。
6. **指数股票池必须使用历史成分，不允许用当前成分替代历史成分**。
7. **一期先聚焦日频、多头、A 股、可解释、可复现**，不要一开始就做复杂事件驱动 / 分钟级回测。
