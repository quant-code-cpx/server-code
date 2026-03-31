# 股票详情 — 分析 Tab 后端实现规划

> **目标读者**：AI 代码生成助手。请严格按照本文定义的接口签名、字段名称、DTO 结构、数据来源实现。
> **前置上下文**：本文基于现有后端仓库 `server-code` 的 Prisma Schema、Stock 模块 (`src/apps/stock/`)、Tushare 同步架构 (`src/tushare/sync/`) 和前端仓库 `client-code` 的 `src/sections/stock-detail/` 页面结构编写。

---

## 一、功能定位与已有 Tab 分工

### 1.1 已有 Tab 覆盖范围（不要重复实现）

| Tab | 已实现功能 |
|-----|-----------|
| 行情 | K 线图（日/周/月 + 前复权/后复权）、MA5/MA10/MA20/MA60 均线叠加、成交量柱状图、今日资金流向（按单笔规格分级）、历史资金流向（净流入柱 + 涨跌幅线，60 日） |
| 公司概况 | 公司简介、基本信息（法人/员工/注册资本/地址等） |
| 财务 | 关键财务指标（ROE/ROA/毛利率/净利率/EPS/负债率/流动比率等 8 期）、利润表、资产负债表、现金流量表、业绩快报 |
| 股本股东 | 前十大股东 + 前十大流通股东 |
| 分红融资 | 分红记录、配股记录、融资记录 |

### 1.2 分析 Tab 的定位

分析 Tab **聚焦技术分析与量化信号**，是其他 Tab 不涉及的纯技术面内容：

| 用户问题 | 对应模块 |
|---------|---------|
| 各种技术指标怎么看？（MACD/KDJ/RSI/BOLL/WR 等） | 经典技术指标 |
| 均线趋势、多空排列？ | 均线系统分析 |
| 量价关系如何？量能是否异常？ | 量价分析 |
| 筹码集中还是分散？主力成本在哪？ | 筹码分布估算 |
| 融资融券余额什么趋势？ | 融资融券数据 |
| 有没有买卖择时信号？ | 择时信号综合 |
| 波动率和风险怎么样？ | 波动率与风险指标 |
| 和大盘/行业比走势如何？ | 相对强弱分析 |

---

## 二、数据源评估

### 2.1 已有数据（可直接使用，无需新增同步）

| 数据 | 表 | 用途 |
|------|---|------|
| 日线 OHLCV | `stock_daily_prices` | 所有技术指标计算的基础输入 |
| 周线/月线 OHLCV | `stock_weekly_prices` / `stock_monthly_prices` | 多周期技术指标 |
| 复权因子 | `stock_adjustment_factors` | 前复权/后复权价格计算 |
| 每日估值指标 | `stock_daily_valuation_metrics` | 换手率、量比、市值 |
| 个股资金流向 | `stock_capital_flows` | 主力资金流入流出（近 60 交易日） |
| 涨跌停价格 | `stock_limit_prices` | 涨停/跌停判断 |
| 指数日线 | `index_daily_prices` | 相对强弱对比（沪深300等） |
| 股票基础信息 | `stock_basic_profiles` | 行业归属，用于行业指数对比 |

### 2.2 需要新增的 Tushare 数据同步

| Tushare 接口 | 说明 | 用途 | 积分要求 | 优先级 |
|-------------|------|------|---------|--------|
| `margin_detail` | 融资融券交易明细 | 融资融券余额趋势 | 2000 积分 | P1 — 融资融券是重要的技术分析维度 |
| `cyq_perf` | 筹码分布（获利比例等） | 筹码集中度、获利盘比例 | 2000 积分 | P2 — 如果积分不够可用估算替代 |
| `cyq_chips` | 筹码分布（成本分布曲线） | 套牢盘/获利盘分布图 | 2000 积分 | P2 — 与 cyq_perf 配合 |

> **积分说明**：`margin_detail` 和 `cyq_perf`/`cyq_chips` 均需 2000 积分。请用户确认当前 Tushare 账户积分是否满足后再决定是否集成。如果积分不足，融资融券和筹码分布模块在后端返回 `null`，前端显示"暂无数据"。

### 2.3 无需 Tushare 额外接口、后端自行计算的数据

以下所有技术指标均基于已有的 `stock_daily_prices`（OHLCV）数据在后端计算：

- 移动平均线（MA/EMA/WMA）
- MACD、KDJ、RSI、BOLL、WR、CCI、DMI、TRIX、DMA、BIAS、OBV、VR、EMV、ROC、PSY、BR/AR/CR、ASI、SAR
- 量价关系指标
- 波动率指标（ATR、历史波动率）
- 相对强弱（需要对应指数日线，已有）
- 择时信号（基于以上指标组合）

---

## 三、接口设计

### 3.1 技术指标接口 — `POST /stock/detail/analysis/technical`

> 核心接口：返回该股票的全部技术指标数据 + 历史序列，前端用于绘制指标图表。

#### 请求 DTO

```typescript
export class StockTechnicalIndicatorsDto {
  /** 股票代码，例如 '000001.SZ' */
  @IsString()
  @IsNotEmpty()
  tsCode: string;

  /** K线周期：D=日线, W=周线, M=月线，默认 D */
  @IsOptional()
  @IsIn(['D', 'W', 'M'])
  period?: string; // 默认 'D'

  /** 返回最近多少个交易日的历史序列，默认 120，最大 500 */
  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(500)
  days?: number; // 默认 120
}
```

#### 响应 DTO

```typescript
/** 单日技术指标完整数据点 */
export class TechnicalDataPoint {
  tradeDate: string;        // 'YYYYMMDD'
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  vol: number | null;       // 成交量（手）
  amount: number | null;    // 成交额（千元）
  pctChg: number | null;    // 涨跌幅(%)

  // ── 均线系统 ──
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  ma250: number | null;
  ema12: number | null;
  ema26: number | null;

  // ── MACD ──
  macdDif: number | null;
  macdDea: number | null;
  macdHist: number | null;  // (DIF - DEA) * 2

  // ── KDJ（9,3,3）──
  kdjK: number | null;
  kdjD: number | null;
  kdjJ: number | null;

  // ── RSI ──
  rsi6: number | null;
  rsi12: number | null;
  rsi24: number | null;

  // ── 布林带（20,2）──
  bollUpper: number | null;
  bollMid: number | null;
  bollLower: number | null;

  // ── WR 威廉指标 ──
  wr6: number | null;       // 6日 Williams %R
  wr10: number | null;      // 10日

  // ── CCI 商品通道指数（14）──
  cci: number | null;

  // ── DMI 趋势指标（14）──
  dmiPdi: number | null;    // +DI
  dmiMdi: number | null;    // -DI
  dmiAdx: number | null;    // ADX
  dmiAdxr: number | null;   // ADXR

  // ── TRIX 三重指数平均（12）──
  trix: number | null;
  trixMa: number | null;    // TRIX 的信号线 MA(20)

  // ── DMA 平行线差（10,50,10）──
  dma: number | null;
  dmaMa: number | null;

  // ── BIAS 乖离率 ──
  bias6: number | null;
  bias12: number | null;
  bias24: number | null;

  // ── OBV 能量潮 ──
  obv: number | null;
  obvMa: number | null;     // OBV 的 30 日均线

  // ── VR 成交量变异率（26）──
  vr: number | null;

  // ── EMV 简易波动指标（14）──
  emv: number | null;
  emvMa: number | null;

  // ── ROC 变动速率（12）──
  roc: number | null;
  rocMa: number | null;     // ROC 的 MA(6) 信号线

  // ── PSY 心理线（12）──
  psy: number | null;
  psyMa: number | null;     // PSY 的 MA(6)

  // ── BRAR 人气意愿指标（26）──
  br: number | null;
  ar: number | null;

  // ── CR 带状能量线（26）──
  cr: number | null;

  // ── SAR 抛物线指标 ──
  sar: number | null;
  sarBullish: boolean | null; // true = 多头，false = 空头

  // ── 量价关系 ──
  volMa5: number | null;    // 成交量 5 日均量
  volMa10: number | null;
  volMa20: number | null;
  /** 量比（当日成交量 / 近 5 日平均成交量） */
  volumeRatio: number | null;

  // ── 波动率 ──
  atr14: number | null;     // 14 日 ATR
  /** 20 日历史波动率（年化，%） */
  hv20: number | null;
}

/** 均线多空状态摘要 */
export class MaStatusSummary {
  /** 多头排列: MA5 > MA10 > MA20 > MA60 */
  bullishAlign: boolean | null;
  /** 空头排列: MA5 < MA10 < MA20 < MA60 */
  bearishAlign: boolean | null;
  /** 价格站上/跌破 MA20 */
  aboveMa20: boolean | null;
  /** 价格站上/跌破 MA60 */
  aboveMa60: boolean | null;
  /** 价格站上/跌破 MA250（年线） */
  aboveMa250: boolean | null;
  /** 金叉/死叉事件: 'ma5_cross_ma10_up' | 'ma5_cross_ma10_down' | ... | null */
  latestCross: string | null;
}

/** 信号摘要 */
export class SignalSummary {
  /** MACD: 'golden_cross' | 'death_cross' | 'above_zero' | 'below_zero' | null */
  macd: string | null;
  /** KDJ: 'golden_cross' | 'death_cross' | 'overbought' | 'oversold' | null */
  kdj: string | null;
  /** RSI: 'overbought' | 'oversold' | 'neutral' */
  rsi: string | null;
  /** BOLL: 'above_upper' | 'near_upper' | 'middle' | 'near_lower' | 'below_lower' */
  boll: string | null;
  /** WR: 'overbought' | 'oversold' | 'neutral' */
  wr: string | null;
  /** CCI: 'overbought' | 'oversold' | 'neutral' */
  cci: string | null;
  /** DMI: 'bullish_trend' | 'bearish_trend' | 'no_trend' */
  dmi: string | null;
  /** SAR: 'bullish' | 'bearish' */
  sar: string | null;
  /** 量价配合: 'volume_price_up' | 'volume_price_diverge' | 'shrink_consolidate' | null */
  volumePrice: string | null;
}

/** 技术指标总响应 */
export class StockTechnicalDataDto {
  tsCode: string;
  period: string;          // 'D' | 'W' | 'M'
  /** 数据截止交易日 */
  dataDate: string | null;
  /** 均线状态摘要 */
  maStatus: MaStatusSummary;
  /** 各指标信号摘要（最新交易日） */
  signals: SignalSummary;
  /** 历史序列（按 tradeDate 升序，最近 N 个交易日），前端用于绘制图表 */
  history: TechnicalDataPoint[];
}
```

---

### 3.2 择时信号接口 — `POST /stock/detail/analysis/timing-signals`

> 综合多指标生成买卖择时信号列表，帮助用户识别关键买卖点。

#### 请求 DTO

```typescript
export class StockTimingSignalsDto {
  @IsString()
  @IsNotEmpty()
  tsCode: string;

  /** 回看天数，默认 60 */
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(250)
  days?: number; // 默认 60
}
```

#### 响应 DTO

```typescript
/** 单个择时信号 */
export class TimingSignalItem {
  /** 信号触发日期 */
  tradeDate: string;
  /** 信号类型: 'buy' | 'sell' | 'warning' */
  type: string;
  /** 信号强度: 1-5（5 最强） */
  strength: number;
  /** 信号来源指标 */
  source: string;   // 'MACD' | 'KDJ' | 'RSI' | 'BOLL' | 'MA_CROSS' | 'VOLUME' | 'COMPOSITE' 等
  /** 信号描述（中文） */
  description: string;
  /** 触发时收盘价 */
  closePrice: number | null;
}

/** 择时评分摘要 */
export class TimingScoreSummary {
  /** 综合择时评分 0-100（越高越看多） */
  score: number;
  /** 评级: '强烈看多' | '看多' | '中性' | '看空' | '强烈看空' */
  rating: string;
  /** 看多指标数量 */
  bullishCount: number;
  /** 看空指标数量 */
  bearishCount: number;
  /** 中性指标数量 */
  neutralCount: number;
  /** 各指标打分明细 */
  details: TimingScoreDetail[];
}

export class TimingScoreDetail {
  /** 指标名称 */
  indicator: string;  // 'MA' | 'MACD' | 'KDJ' | 'RSI' | 'BOLL' | 'WR' | 'CCI' | 'DMI' | 'SAR' | 'VOL' | 'MARGIN'
  /** 信号: 'bullish' | 'bearish' | 'neutral' */
  signal: string;
  /** 分数 0-100 */
  score: number;
  /** 说明 */
  reason: string;
}

export class StockTimingSignalsDataDto {
  tsCode: string;
  /** 择时评分摘要 */
  scoreSummary: TimingScoreSummary;
  /** 最近的择时信号列表（按日期降序） */
  signals: TimingSignalItem[];
}
```

---

### 3.3 筹码分布接口 — `POST /stock/detail/analysis/chip-distribution`

> 返回筹码分布估算数据。如果 Tushare `cyq_perf`/`cyq_chips` 可用则使用真实数据，否则基于历史成交量做估算。

#### 请求 DTO

```typescript
export class StockChipDistributionDto {
  @IsString()
  @IsNotEmpty()
  tsCode: string;

  /** 可选：指定某个交易日的筹码分布，不传则使用最新交易日 */
  @IsOptional()
  @IsString()
  tradeDate?: string;
}
```

#### 响应 DTO

```typescript
/** 筹码分布数据 */
export class ChipDistributionDataDto {
  tsCode: string;
  tradeDate: string;
  currentPrice: number | null;

  /** 筹码集中度指标 */
  concentration: ChipConcentration;

  /** 成本分布直方图（价格区间 → 筹码占比） */
  distribution: ChipDistributionBin[];

  /** 关键价位 */
  keyLevels: ChipKeyLevels;

  /** 是否为真实数据（Tushare cyq 接口），false 表示估算 */
  isEstimated: boolean;
}

export class ChipConcentration {
  /** 90% 筹码集中度价格区间 */
  range90Low: number | null;
  range90High: number | null;
  /** 70% 筹码集中度价格区间 */
  range70Low: number | null;
  range70High: number | null;
  /** 集中度评分: 0-100（越高越集中） */
  score: number | null;
  /** 获利比例 (%) */
  profitRatio: number | null;
  /** 平均成本 */
  avgCost: number | null;
}

export class ChipDistributionBin {
  /** 价格区间下界 */
  priceLow: number;
  /** 价格区间上界 */
  priceHigh: number;
  /** 该价格区间内的筹码占比 (0-100 %) */
  percent: number;
  /** 该区间是否在当前价格之下（获利盘） */
  isProfit: boolean;
}

export class ChipKeyLevels {
  /** 最密集成交价位（主力成本） */
  peakPrice: number | null;
  /** 上方套牢密集区上界 */
  resistanceHigh: number | null;
  /** 上方套牢密集区下界 */
  resistanceLow: number | null;
  /** 下方支撑密集区上界 */
  supportHigh: number | null;
  /** 下方支撑密集区下界 */
  supportLow: number | null;
}
```

---

### 3.4 融资融券接口 — `POST /stock/detail/analysis/margin`

> 返回融资融券余额趋势。需要新增 `margin_detail` Tushare 同步。

#### 请求 DTO

```typescript
export class StockMarginDataDto {
  @IsString()
  @IsNotEmpty()
  tsCode: string;

  /** 回看天数，默认 60 */
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(250)
  days?: number;
}
```

#### 响应 DTO

```typescript
export class MarginDailyItem {
  tradeDate: string;
  /** 融资余额（元） */
  rzye: number | null;
  /** 融资买入额（元） */
  rzmre: number | null;
  /** 融资偿还额（元） */
  rzche: number | null;
  /** 融资净买入 = 买入 - 偿还（元） */
  rzjmre: number | null;
  /** 融券余额（元） */
  rqye: number | null;
  /** 融券卖出量（股） */
  rqmcl: number | null;
  /** 融券偿还量（股） */
  rqchl: number | null;
  /** 融资融券余额合计（元） */
  rzrqye: number | null;
  /** 收盘价（用于叠加价格线） */
  close: number | null;
}

export class MarginSummary {
  /** 最新融资余额（元） */
  latestRzye: number | null;
  /** 最新融券余额（元） */
  latestRqye: number | null;
  /** 最新融资融券余额合计（元） */
  latestRzrqye: number | null;
  /** 5日融资净买入累计（元） */
  rzNetBuy5d: number | null;
  /** 20日融资净买入累计（元） */
  rzNetBuy20d: number | null;
  /** 融资余额较 5 日前变化率(%) */
  rzye5dChgPct: number | null;
  /** 融资余额较 20 日前变化率(%) */
  rzye20dChgPct: number | null;
  /** 趋势判断: 'increasing' | 'decreasing' | 'stable' */
  trend: string;
}

export class StockMarginDataResponseDto {
  tsCode: string;
  /** 融资融券摘要 */
  summary: MarginSummary;
  /** 每日明细（按 tradeDate 升序） */
  history: MarginDailyItem[];
  /** 数据是否可用（Tushare 积分不足时为 false） */
  available: boolean;
}
```

---

### 3.5 相对强弱接口 — `POST /stock/detail/analysis/relative-strength`

> 对比个股与大盘/行业指数的相对走势。

#### 请求 DTO

```typescript
export class StockRelativeStrengthDto {
  @IsString()
  @IsNotEmpty()
  tsCode: string;

  /** 对比的指数代码，默认沪深300 '000300.SH' */
  @IsOptional()
  @IsString()
  benchmarkCode?: string;

  /** 回看天数，默认 120 */
  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(500)
  days?: number;
}
```

#### 响应 DTO

```typescript
export class RelativeStrengthPoint {
  tradeDate: string;
  /** 个股累计涨跌幅 (%) — 以起始日为基准 */
  stockCumReturn: number;
  /** 基准指数累计涨跌幅 (%) */
  benchmarkCumReturn: number;
  /** 超额收益 = stock - benchmark */
  excessReturn: number;
  /** 相对强弱比率 = 个股收盘价 / 指数收盘价（归一化） */
  rsRatio: number;
}

export class RelativeStrengthSummary {
  /** 期间个股累计涨跌幅 (%) */
  stockTotalReturn: number | null;
  /** 期间基准累计涨跌幅 (%) */
  benchmarkTotalReturn: number | null;
  /** 超额收益 (%) */
  excessReturn: number | null;
  /** 最近 20 日超额收益 (%) */
  excess20d: number | null;
  /** 年化波动率 (%) */
  annualizedVol: number | null;
  /** 最大回撤 (%) */
  maxDrawdown: number | null;
  /** Beta（相对基准） */
  beta: number | null;
  /** 信息比率 */
  informationRatio: number | null;
}

export class StockRelativeStrengthDataDto {
  tsCode: string;
  benchmarkCode: string;
  benchmarkName: string;
  /** 统计摘要 */
  summary: RelativeStrengthSummary;
  /** 每日数据（按 tradeDate 升序） */
  history: RelativeStrengthPoint[];
}
```

---

## 四、技术指标计算逻辑详解

### 4.1 工具文件组织

所有技术指标计算逻辑抽成独立的纯函数，**不依赖数据库、不依赖 NestJS**，方便单元测试：

```
src/apps/stock/utils/
├── technical-indicators.ts       # 所有指标计算的纯函数
├── technical-indicators.spec.ts  # 单元测试
├── chip-estimation.ts            # 筹码估算算法
└── timing-signals.ts             # 择时信号生成逻辑
```

### 4.2 输入数据结构

所有计算函数接受统一的 OHLCV 数组作为输入：

```typescript
interface OhlcvBar {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;      // 成交量（手）
  amount: number;   // 成交额（千元）
  preClose: number; // 昨收
}
```

### 4.3 各指标计算公式

#### 4.3.1 移动平均线（MA / EMA）

```
MA(N)  = SUM(Close, N) / N
EMA(N) = Close × 2/(N+1) + EMA_prev × (N-1)/(N+1)
WMA(N) = SUM(Close_i × i, 1..N) / SUM(i, 1..N)   // 加权移动平均
```

#### 4.3.2 MACD（12, 26, 9）

```
DIF  = EMA(Close, 12) - EMA(Close, 26)
DEA  = EMA(DIF, 9)
HIST = (DIF - DEA) × 2
信号：DIF 上穿 DEA → 金叉（买入）; DIF 下穿 DEA → 死叉（卖出）
      DIF 从负变正 → 零轴上穿；DIF 从正变负 → 零轴下穿
```

#### 4.3.3 KDJ（9, 3, 3）

```
RSV = (Close - Low9) / (High9 - Low9) × 100      // Low9/High9 = 9日最低/最高
K   = 2/3 × K_prev + 1/3 × RSV                   // 初始 K=50
D   = 2/3 × D_prev + 1/3 × K                     // 初始 D=50
J   = 3K - 2D
信号：K 上穿 D 且在低位(K<20) → 金叉; K 下穿 D 且在高位(K>80) → 死叉
      J>100 → 超买; J<0 → 超卖
```

#### 4.3.4 RSI（6, 12, 24）

```
U = MAX(Close - Close_prev, 0)
D = MAX(Close_prev - Close, 0)
RS = SMA(U, N) / SMA(D, N)
RSI = 100 - 100 / (1 + RS)
信号：RSI > 80 → 超买; RSI < 20 → 超卖
      RSI 从低位(30以下)上穿 → 可能反弹
```

#### 4.3.5 BOLL 布林带（20, 2）

```
MID   = MA(Close, 20)
STD   = 标准差(Close, 20)
UPPER = MID + 2 × STD
LOWER = MID - 2 × STD
信号：价格突破上轨 → 超买/强势突破；价格跌破下轨 → 超卖/弱势破位
      带宽收窄 → 变盘信号
```

#### 4.3.6 WR 威廉指标（6, 10）

```
WR(N) = (High_N - Close) / (High_N - Low_N) × (-100)
信号：WR > -20 → 超买; WR < -80 → 超卖
```

#### 4.3.7 CCI 商品通道指数（14）

```
TP  = (High + Low + Close) / 3
MA  = MA(TP, 14)
MD  = 平均偏差(TP, 14)
CCI = (TP - MA) / (0.015 × MD)
信号：CCI > 100 → 超买区/强势; CCI < -100 → 超卖区/弱势
      CCI 突破 +100 → 买入信号; CCI 跌破 -100 → 卖出信号
```

#### 4.3.8 DMI 趋势指标（14）

```
+DM = MAX(High - High_prev, 0)    当 +DM > -DM 时取值，否则为 0
-DM = MAX(Low_prev - Low, 0)      当 -DM > +DM 时取值，否则为 0
TR  = MAX(High-Low, ABS(High-Close_prev), ABS(Low-Close_prev))
+DI = EMA(+DM, 14) / EMA(TR, 14) × 100
-DI = EMA(-DM, 14) / EMA(TR, 14) × 100
DX  = ABS(+DI - -DI) / (+DI + -DI) × 100
ADX = EMA(DX, 14)
ADXR= (ADX + ADX_14日前) / 2
信号：+DI > -DI → 多头趋势; +DI < -DI → 空头趋势; ADX > 25 → 有明确趋势
```

#### 4.3.9 TRIX 三重指数平均（12）

```
EMA1 = EMA(Close, 12)
EMA2 = EMA(EMA1, 12)
EMA3 = EMA(EMA2, 12)
TRIX = (EMA3 - EMA3_prev) / EMA3_prev × 100
MATRIX = MA(TRIX, 20)
信号：TRIX 上穿 MATRIX → 买入; TRIX 下穿 MATRIX → 卖出
```

#### 4.3.10 DMA 平行线差（10, 50, 10）

```
DMA  = MA(Close, 10) - MA(Close, 50)
AMA  = MA(DMA, 10)
信号：DMA 上穿 AMA → 买入; DMA 下穿 AMA → 卖出
```

#### 4.3.11 BIAS 乖离率（6, 12, 24）

```
BIAS(N) = (Close - MA(Close, N)) / MA(Close, N) × 100
信号：BIAS6 > 5% 或 < -5% → 可能回归均线
```

#### 4.3.12 OBV 能量潮

```
if Close > Close_prev:   OBV += Vol
elif Close < Close_prev: OBV -= Vol
else:                    OBV 不变
OBVMA = MA(OBV, 30)
信号：OBV 持续上升且价格未明显上涨 → 潜在看多（量先行）
```

#### 4.3.13 VR 成交量变异率（26）

```
26日内上涨日成交量之和 = AVS
26日内下跌日成交量之和 = BVS
26日内平盘日成交量之和 = CVS
VR = (AVS + CVS/2) / (BVS + CVS/2) × 100
信号：VR > 450 → 超买; VR < 40 → 超卖; 70-150 → 安全区
```

#### 4.3.14 EMV 简易波动指标（14）

```
MM = ((High + Low)/2 - (High_prev + Low_prev)/2) / ((High - Low) / Vol)
EMV = MA(MM, 14)
EMVMA = MA(EMV, 9)
信号：EMV 从负变正 → 买入; EMV 从正变负 → 卖出
```

#### 4.3.15 ROC 变动速率（12）

```
ROC   = (Close - Close_N前) / Close_N前 × 100
ROCMA = MA(ROC, 6)
信号：ROC 上穿零轴 → 看多; ROC 下穿零轴 → 看空
```

#### 4.3.16 PSY 心理线（12）

```
PSY = N日内上涨天数 / N × 100
PSYMA = MA(PSY, 6)
信号：PSY > 75 → 超买; PSY < 25 → 超卖
```

#### 4.3.17 BR/AR 人气意愿指标（26）

```
AR = SUM(High - Open, 26) / SUM(Open - Low, 26) × 100
BR = SUM(MAX(High - Close_prev, 0), 26) / SUM(MAX(Close_prev - Low, 0), 26) × 100
信号：AR > 150 → 超买; AR < 50 → 超卖; BR > 300 → 超买; BR < 40 → 超卖
      BR < AR 且均在低位 → 可能见底
```

#### 4.3.18 CR 带状能量线（26）

```
MID = (High_prev + Low_prev + Close_prev) / 3
CR = SUM(MAX(High - MID, 0), 26) / SUM(MAX(MID - Low, 0), 26) × 100
信号：CR > 200 → 偏热; CR < 40 → 偏冷
```

#### 4.3.19 SAR 抛物线指标

```
初始 AF = 0.02, 步长 = 0.02, 最大 AF = 0.2
多头时: SAR_next = SAR + AF × (EP - SAR)，EP = 期间最高价
空头时: SAR_next = SAR + AF × (EP - SAR)，EP = 期间最低价
每创新高/新低，AF += 0.02（不超过 0.2）
翻转条件: 多头时价格跌破 SAR → 转空; 空头时价格突破 SAR → 转多
```

#### 4.3.20 波动率指标

```
ATR(14) = EMA(TR, 14)，TR = MAX(High-Low, |High-Close_prev|, |Low-Close_prev|)
HV(20)  = STD(ln(Close/Close_prev), 20) × √252 × 100   // 20日年化历史波动率
```

#### 4.3.21 筹码分布估算（无 Tushare cyq 接口时）

```
基本思路：利用历史每日成交量在当日价格区间内均匀分配，按时间衰减。

1. 取近 120 个交易日数据
2. 将价格区间 [期间最低价, 期间最高价] 划分为 100 个 bin
3. 每个交易日的成交量，按该日 OHLC 的正态分布近似分配到各 bin：
   - 中心 = (Open + Close) / 2
   - 标准差 = (High - Low) / 4
   - 该日成交量按此正态分布加权分配
4. 近期数据权重更高（时间衰减因子 = 0.97^(距今天数)）
5. 最终归一化，每个 bin 的值表示筹码占比 (%)
6. 获利比例 = 当前价格以下 bin 占比之和
7. 筹码集中度 = 70%/90% 分位价格区间
```

---

## 五、新增 Tushare 数据同步（条件性）

### 5.1 融资融券同步 — `margin_detail`

如果用户 Tushare 积分 ≥ 2000，需新增：

**新增 Prisma Schema**：`prisma/tushare_margin.prisma`

```prisma
model MarginDetail {
  tsCode    String   @map("ts_code")    @db.VarChar(12)
  tradeDate DateTime @map("trade_date") @db.Date

  rzye   Float? @map("rzye")     // 融资余额（元）
  rzmre  Float? @map("rzmre")    // 融资买入额
  rzche  Float? @map("rzche")    // 融资偿还额
  rzjmre Float? @map("rzjmre")   // 融资净买入
  rqye   Float? @map("rqye")     // 融券余额（元）
  rqmcl  Float? @map("rqmcl")    // 融券卖出量（股）
  rqchl  Float? @map("rqchl")    // 融券偿还量（股）
  rqyl   Float? @map("rqyl")     // 融券余量（股）
  rzrqye Float? @map("rzrqye")   // 融资融券余额
  rzrqyl Float? @map("rzrqyl")   // 融资融券余量

  @@id([tsCode, tradeDate])
  @@map("margin_detail")
}
```

**新增 API 方法**：`src/tushare/api/market-api.service.ts`

```typescript
/** 按交易日获取融资融券明细 */
getMarginDetailByTradeDate(tradeDate: string) {
  return this.client.call({
    api_name: 'margin_detail',
    params: { trade_date: tradeDate },
    fields: ['ts_code', 'trade_date', 'rzye', 'rzmre', 'rzche', 'rzjmre', 'rqye', 'rqmcl', 'rqchl', 'rqyl', 'rzrqye', 'rzrqyl'],
  })
}
```

**同步策略**：与 `moneyflow` 类似，每日盘后同步，保留近 120 个交易日。

**同步注册**：在 `src/tushare/sync/market-sync.service.ts` 中新增 `MARGIN_DETAIL` 计划，在 TushareSyncTaskName 枚举中新增。

### 5.2 筹码分布同步 — `cyq_perf` / `cyq_chips`（可选）

如果积分满足：

**新增 Prisma Schema**：`prisma/tushare_cyq.prisma`

```prisma
model CyqPerf {
  tsCode    String   @map("ts_code")    @db.VarChar(12)
  tradeDate DateTime @map("trade_date") @db.Date

  hisLow     Float? @map("his_low")      // 历史最低价
  hisHigh    Float? @map("his_high")     // 历史最高价
  cost5Pct   Float? @map("cost_5pct")    // 5%成本区
  cost15Pct  Float? @map("cost_15pct")   // 15%成本区
  cost50Pct  Float? @map("cost_50pct")   // 50%成本区
  cost85Pct  Float? @map("cost_85pct")   // 85%成本区
  cost95Pct  Float? @map("cost_95pct")   // 95%成本区
  weightAvg  Float? @map("weight_avg")   // 加权平均成本
  winner     Float? @map("winner")       // 获利比例 (%)

  @@id([tsCode, tradeDate])
  @@map("cyq_performance")
}
```

> **降级方案**：如果积分不足以调用 `cyq_perf`，后端使用 4.3.21 中描述的筹码估算算法，基于已有的 OHLCV 数据估算。响应中 `isEstimated: true` 告知前端。

---

## 六、Service 层组织

由于 `stock.service.ts` 已约 53KB，分析功能使用独立 service：

```
src/apps/stock/
├── stock.controller.ts                    # 新增 5 个 endpoint
├── stock.module.ts                        # 注册新 service
├── stock.service.ts                       # 现有逻辑不动
├── stock-analysis.service.ts              # 🆕 分析 Tab 主服务（编排层）
├── utils/
│   ├── technical-indicators.ts            # 🆕 所有技术指标纯函数
│   ├── technical-indicators.spec.ts       # 🆕 单元测试
│   ├── chip-estimation.ts                 # 🆕 筹码估算
│   └── timing-signals.ts                  # 🆕 择时信号
├── dto/
│   ├── stock-request.dto.ts               # 新增 5 个请求 DTO
│   └── stock-response.dto.ts              # 新增分析响应 DTO
```

### `StockAnalysisService` 核心方法

```typescript
@Injectable()
export class StockAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  /** 技术指标 */
  async getTechnicalIndicators(dto: StockTechnicalIndicatorsDto): Promise<StockTechnicalDataDto> {
    // 1. 按 period 查 OHLCV 数据（需要额外 buffer 来计算长周期指标如 MA250）
    //    查 days + 300 条原始数据，计算后截取最近 days 条返回
    // 2. 如需前复权，查 adj_factor 做价格调整
    // 3. 调用 utils/technical-indicators.ts 中的纯函数计算全部指标
    // 4. 组装 maStatus + signals + history
  }

  /** 择时信号 */
  async getTimingSignals(dto: StockTimingSignalsDto): Promise<StockTimingSignalsDataDto> {
    // 1. 调用 getTechnicalIndicators 获取技术指标
    // 2. 调用 utils/timing-signals.ts 生成信号列表 + 评分
  }

  /** 筹码分布 */
  async getChipDistribution(dto: StockChipDistributionDto): Promise<ChipDistributionDataDto> {
    // 1. 尝试从 cyq_performance 表读取（如果已同步）
    // 2. 否则用 chip-estimation.ts 从 OHLCV 估算
  }

  /** 融资融券 */
  async getMarginData(dto: StockMarginDataDto): Promise<StockMarginDataResponseDto> {
    // 1. 从 margin_detail 表读取
    // 2. 如果表不存在或无数据，返回 available: false
  }

  /** 相对强弱 */
  async getRelativeStrength(dto: StockRelativeStrengthDto): Promise<StockRelativeStrengthDataDto> {
    // 1. 查个股日线 + 对应指数日线
    // 2. 计算累计收益率、超额收益、Beta、最大回撤等
  }
}
```

---

## 七、Controller 注册

```typescript
// 文件: src/apps/stock/stock.controller.ts — 新增 5 个方法

@Post('detail/analysis/technical')
@ApiSuccessResponse(StockTechnicalDataDto)
async getTechnicalIndicators(@Body() dto: StockTechnicalIndicatorsDto) {
  return this.stockAnalysisService.getTechnicalIndicators(dto);
}

@Post('detail/analysis/timing-signals')
@ApiSuccessResponse(StockTimingSignalsDataDto)
async getTimingSignals(@Body() dto: StockTimingSignalsDto) {
  return this.stockAnalysisService.getTimingSignals(dto);
}

@Post('detail/analysis/chip-distribution')
@ApiSuccessResponse(ChipDistributionDataDto)
async getChipDistribution(@Body() dto: StockChipDistributionDto) {
  return this.stockAnalysisService.getChipDistribution(dto);
}

@Post('detail/analysis/margin')
@ApiSuccessResponse(StockMarginDataResponseDto)
async getMarginData(@Body() dto: StockMarginDataDto) {
  return this.stockAnalysisService.getMarginData(dto);
}

@Post('detail/analysis/relative-strength')
@ApiSuccessResponse(StockRelativeStrengthDataDto)
async getRelativeStrength(@Body() dto: StockRelativeStrengthDto) {
  return this.stockAnalysisService.getRelativeStrength(dto);
}
```

---

## 八、数据库查询优化

### 8.1 已有索引（可直接利用）

| 表 | 索引 | 用途 |
|---|------|------|
| `stock_daily_prices` | `(tsCode, tradeDate)` 主键 | 技术指标计算 |
| `stock_weekly_prices` | `(tsCode, tradeDate)` 主键 | 周线指标 |
| `stock_monthly_prices` | `(tsCode, tradeDate)` 主键 | 月线指标 |
| `stock_adjustment_factors` | `(tsCode, tradeDate)` 主键 | 前复权 |
| `stock_daily_valuation_metrics` | `(tsCode, tradeDate)` 主键 | 换手率/量比 |
| `stock_capital_flows` | `(tsCode, tradeDate)` 主键 | 资金流 |
| `index_daily_prices` | `(tsCode, tradeDate)` 主键 | 相对强弱 |

### 8.2 查询量控制

| 接口 | 原始查询量 | 返回量 |
|------|-----------|--------|
| 技术指标 | days + 300 条日线（计算长周期指标需要 buffer） | days 条 |
| 择时信号 | 复用技术指标查询 | 信号列表（通常 <50 条） |
| 筹码分布 | 120 条日线 | 100 个 bin + 摘要 |
| 融资融券 | days 条 | days 条 |
| 相对强弱 | days 条日线 + days 条指数日线 | days 条 |

---

## 九、实现顺序建议

| 步骤 | 内容 | 优先级 |
|------|------|--------|
| 1 | 创建 `utils/technical-indicators.ts` — 实现全部 20+ 个技术指标纯函数 + 单元测试 | P0 |
| 2 | 创建 DTO 定义（请求 + 响应，所有 5 个接口） | P0 |
| 3 | 创建 `StockAnalysisService` 骨架 + Module 注册 | P0 |
| 4 | 实现技术指标接口（`/technical`） | P0 |
| 5 | 实现择时信号接口（`/timing-signals`） | P0 |
| 6 | 实现筹码估算算法（`utils/chip-estimation.ts`） | P1 |
| 7 | 实现筹码分布接口（`/chip-distribution`） | P1 |
| 8 | 实现相对强弱接口（`/relative-strength`） | P1 |
| 9 | （条件性）新增 `margin_detail` Prisma Schema + 同步 + Mapper | P1 |
| 10 | 实现融资融券接口（`/margin`） | P1 |
| 11 | Controller 注册全部 5 个 endpoint + Swagger 文档 | P0 |
| 12 | 编译验证 + 接口联调 | P0 |

---

## 十、注意事项

1. **不要在 stock.service.ts 中堆砌分析逻辑**。stock.service.ts 已经约 53KB，分析逻辑全部在新建的 `stock-analysis.service.ts` 中。
2. **技术指标计算函数必须是纯函数**：输入为 OhlcvBar[]，输出为指标数值数组。不依赖数据库，不依赖 NestJS DI。放在 `src/apps/stock/utils/technical-indicators.ts`。
3. **单元测试覆盖核心指标**：至少对 MA/MACD/KDJ/RSI/BOLL/SAR 各写 1 个测试用例，使用固定输入数据验证输出正确性。
4. **遵循现有 Controller 约定**：使用 `@ApiSuccessResponse(Dto)` 装饰器，`TransformInterceptor` 会自动包装响应。
5. **前复权处理**：技术指标计算默认使用前复权价格。从 `stock_adjustment_factors` 表查最新 adjFactor，对历史 OHLC 做调整。
6. **空数据处理**：新股或停牌股可能数据不足，技术指标返回 `null`。融资融券如果积分不足，`available: false`。筹码分布如果无 cyq 数据，用估算算法并标记 `isEstimated: true`。
7. **融资融券同步是可选的**：先确认用户 Tushare 积分后再决定是否实现。无论是否同步，接口先定义好，数据不可用时返回 `available: false`。
