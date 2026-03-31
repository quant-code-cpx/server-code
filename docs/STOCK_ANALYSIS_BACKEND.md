# 股票详情 — 分析 Tab 后端实现规划

> **目标读者**：AI 代码生成助手。请严格按照本文定义的接口签名、字段名称、DTO 结构、数据来源实现。
> **前置上下文**：本文基于现有后端仓库 `server-code` 的 Prisma Schema、Stock 模块 (`src/apps/stock/`)、Tushare 同步架构 (`src/tushare/sync/`) 和前端仓库 `client-code` 的 `src/sections/stock-detail/` 页面结构编写。

---

## 一、功能总览

分析 Tab 是股票详情页的核心决策支持区域。它不是简单地展示原始数据（财务报表、K 线等已在其他 Tab 实现），而是对现有数据做 **二次计算、趋势提炼、多维度综合评分**，帮助用户快速判断一只股票值不值得关注。

### 1.1 分析 Tab 要解决的问题

| 用户问题 | 对应分析模块 |
|---------|-------------|
| 这只股票贵不贵？ | 估值分析 |
| 公司盈利能力怎么样？趋势如何？ | 盈利能力分析 |
| 公司财务健不健康？ | 财务健康度分析 |
| 公司在增长还是在衰退？ | 成长性分析 |
| 主力资金在进还是在出？ | 资金面分析 |
| 技术面怎么看？ | 技术指标分析（需新增数据） |
| 综合来看这只股票如何？ | 综合评分雷达图 |

### 1.2 模块与接口映射

| 模块 | 接口路径 | 数据源表 | 是否需新增数据 | 状态 |
|------|---------|---------|--------------|------|
| 综合分析总览 | `POST /stock/detail/analysis` | 多表聚合计算 | 否 | 🆕 新建 |
| 估值分析 | ↑ 同上（`valuation` 字段） | `stock_daily_valuation_metrics` | 否 | 🆕 新建 |
| 盈利能力分析 | ↑ 同上（`profitability` 字段） | `financial_indicator_snapshots` + `income_statement_reports` | 否 | 🆕 新建 |
| 财务健康度 | ↑ 同上（`financialHealth` 字段） | `financial_indicator_snapshots` + `balance_sheet_reports` + `cashflow_reports` | 否 | 🆕 新建 |
| 成长性分析 | ↑ 同上（`growth` 字段） | `financial_indicator_snapshots` + `income_statement_reports` | 否 | 🆕 新建 |
| 资金面分析 | ↑ 同上（`capitalFlow` 字段） | `stock_capital_flows` + `stock_daily_valuation_metrics` | 否 | 🆕 新建 |
| 技术指标分析 | ↑ 同上（`technical` 字段） | `stock_daily_prices` + `stock_daily_valuation_metrics` | 否（自行计算） | 🆕 新建 |
| 行业对比 | `POST /stock/detail/analysis/industry-compare` | 多表 + `stock_basic_profiles` 行业分组 | 否 | 🆕 新建 |

### 1.3 数据源评估结论

**不需要新增 Tushare 数据同步。** 所有分析指标均可基于已有的数据库表通过后端二次计算得出：

- 估值数据 → `stock_daily_valuation_metrics`（PE/PB/PS/股息率/市值/换手率，每日更新）
- 财务指标 → `financial_indicator_snapshots`（ROE/ROA/毛利率/净利率/资产负债率/流动比率/YoY 增长率等，季度更新）
- 三大报表 → `income_statement_reports` / `balance_sheet_reports` / `cashflow_reports`（季度更新）
- 资金流 → `stock_capital_flows`（每日更新，近 60 个交易日）
- 价格数据 → `stock_daily_prices`（每日 OHLCV）
- 股东数据 → `top_ten_shareholder_snapshots`（季度更新）
- 技术指标 → 基于 `stock_daily_prices` 和 `stock_daily_valuation_metrics` 自行计算 MA/MACD/RSI/KDJ/BOLL

> **关于 stk_factor**：Tushare 的 `stk_factor` 接口提供预计算的技术指标，但需要额外积分。本方案选择在后端自行计算技术指标（基于已有的日线数据），不新增 Tushare 接口依赖。如后续需要更高精度的因子数据（如 alpha101），再考虑接入。

---

## 二、接口设计

### 2.1 综合分析接口 — `POST /stock/detail/analysis`

> 一次性返回该股票的全维度分析数据，前端各分析卡片共享同一个请求结果。

#### 请求 DTO

```typescript
// 文件: src/apps/stock/dto/stock-request.dto.ts (新增 class)

export class StockDetailAnalysisDto {
  /** 股票代码，例如 '000001.SZ' */
  @IsString()
  @IsNotEmpty()
  tsCode: string;
}
```

#### 响应 DTO

```typescript
// 文件: src/apps/stock/dto/stock-response.dto.ts (新增 class)

/** 估值分析数据 */
export class ValuationAnalysisDto {
  /** 当前 PE(TTM) */
  peTtm: number | null;
  /** 当前 PB */
  pb: number | null;
  /** 当前 PS(TTM) */
  psTtm: number | null;
  /** 当前股息率(TTM)，百分比 */
  dvTtm: number | null;
  /** 总市值（万元） */
  totalMv: number | null;
  /** 流通市值（万元） */
  circMv: number | null;

  /** PE 在近 1 年日频数据中的百分位（0~100），值越低表示越便宜 */
  peTtmPercentile1Y: number | null;
  /** PB 在近 1 年日频数据中的百分位（0~100） */
  pbPercentile1Y: number | null;
  /** PE 在近 3 年日频数据中的百分位（0~100） */
  peTtmPercentile3Y: number | null;
  /** PB 在近 3 年日频数据中的百分位（0~100） */
  pbPercentile3Y: number | null;

  /** PE(TTM) 近 1 年日频历史序列，用于前端绘制分布图/趋势图 */
  peTtmHistory: ValuationHistoryPoint[];
  /** PB 近 1 年日频历史序列 */
  pbHistory: ValuationHistoryPoint[];
}

export class ValuationHistoryPoint {
  tradeDate: string; // 'YYYY-MM-DD'
  value: number | null;
}

/** 盈利能力分析数据 */
export class ProfitabilityAnalysisDto {
  /** 最近一期报告期（如 '2025-12-31'） */
  latestPeriod: string | null;
  /** 最新 ROE(%) */
  roe: number | null;
  /** 最新 ROA(%) */
  roa: number | null;
  /** 最新毛利率(%) */
  grossMargin: number | null;
  /** 最新净利率(%) */
  netMargin: number | null;
  /** 最新 EPS */
  eps: number | null;

  /** 最近 N 个季度的趋势（按 endDate 降序，最多 12 期即 3 年） */
  trend: ProfitabilityTrendPoint[];
}

export class ProfitabilityTrendPoint {
  /** 报告期 'YYYY-MM-DD' */
  endDate: string;
  roe: number | null;
  roa: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  eps: number | null;
}

/** 财务健康度分析数据 */
export class FinancialHealthAnalysisDto {
  latestPeriod: string | null;
  /** 资产负债率(%) */
  debtToAssets: number | null;
  /** 流动比率 */
  currentRatio: number | null;
  /** 速动比率 */
  quickRatio: number | null;
  /** 经营现金流/净利润(%) — 现金流质量 */
  ocfToNetprofit: number | null;
  /** 最近一期自由现金流（元） */
  freeCashflow: number | null;

  /** 最近 N 个季度的趋势（最多 12 期） */
  trend: FinancialHealthTrendPoint[];
}

export class FinancialHealthTrendPoint {
  endDate: string;
  debtToAssets: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  ocfToNetprofit: number | null;
}

/** 成长性分析数据 */
export class GrowthAnalysisDto {
  latestPeriod: string | null;
  /** 营收同比(%) */
  revenueYoy: number | null;
  /** 净利润同比(%) */
  netprofitYoy: number | null;
  /** 扣非净利润同比(%) */
  dtNetprofitYoy: number | null;
  /** 营收（元） */
  revenue: number | null;
  /** 净利润（元） */
  nIncome: number | null;

  /** 最近 N 个季度的趋势（最多 12 期） */
  trend: GrowthTrendPoint[];
}

export class GrowthTrendPoint {
  endDate: string;
  revenue: number | null;
  nIncome: number | null;
  revenueYoy: number | null;
  netprofitYoy: number | null;
}

/** 资金面分析数据 */
export class CapitalFlowAnalysisDto {
  /** 最近 5 日净流入累计（万元） */
  netInflow5d: number | null;
  /** 最近 10 日净流入累计（万元） */
  netInflow10d: number | null;
  /** 最近 20 日净流入累计（万元） */
  netInflow20d: number | null;
  /** 最近 5 日主力（超大+大单）净流入（万元） */
  mainNetInflow5d: number | null;
  /** 最近 20 日主力净流入（万元） */
  mainNetInflow20d: number | null;
  /** 最近 5 日换手率均值(%) */
  avgTurnover5d: number | null;
  /** 最近 20 日换手率均值(%) */
  avgTurnover20d: number | null;

  /** 最近 20 个交易日的每日资金流数据，用于前端绘制柱状图 */
  dailyFlow: CapitalFlowDailyPoint[];
}

export class CapitalFlowDailyPoint {
  tradeDate: string;
  /** 全市场净流入（万元） */
  netMfAmount: number | null;
  /** 主力净流入 = 超大单净 + 大单净（万元） */
  mainNetAmount: number | null;
  /** 收盘价 */
  close: number | null;
}

/** 技术指标分析数据 */
export class TechnicalAnalysisDto {
  /** 最新交易日 */
  tradeDate: string | null;

  /** 均线数据 */
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  ma250: number | null;

  /** 均线多头排列判断: true=多头排列, false=空头排列, null=无法判断 */
  maBullish: boolean | null;

  /** MACD 指标 */
  macdDif: number | null;
  macdDea: number | null;
  macdHist: number | null;
  /** MACD 金叉/死叉信号: 'golden_cross' | 'death_cross' | null */
  macdSignal: string | null;

  /** RSI 指标（14 日） */
  rsi6: number | null;
  rsi12: number | null;
  rsi24: number | null;

  /** KDJ 指标 */
  kdjK: number | null;
  kdjD: number | null;
  kdjJ: number | null;

  /** 布林带 */
  bollUpper: number | null;
  bollMid: number | null;
  bollLower: number | null;

  /** 当前价格相对布林带位置: 'above_upper' | 'near_upper' | 'middle' | 'near_lower' | 'below_lower' */
  bollPosition: string | null;

  /**
   * 最近 60 个交易日的技术指标历史序列，用于前端绘制附图指标。
   * 每个点包含 tradeDate, close, ma5~ma60, macdDif, macdDea, macdHist, rsi6, rsi12, rsi24, kdjK, kdjD, kdjJ, bollUpper, bollMid, bollLower
   */
  history: TechnicalHistoryPoint[];
}

export class TechnicalHistoryPoint {
  tradeDate: string;
  close: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  macdDif: number | null;
  macdDea: number | null;
  macdHist: number | null;
  rsi6: number | null;
  rsi12: number | null;
  rsi24: number | null;
  kdjK: number | null;
  kdjD: number | null;
  kdjJ: number | null;
  bollUpper: number | null;
  bollMid: number | null;
  bollLower: number | null;
}

/** 综合评分数据 */
export class OverallScoreDto {
  /**
   * 各维度评分，0~100 分。
   * 用于前端雷达图展示。
   */
  /** 估值得分：PE/PB 百分位越低越高分 */
  valuationScore: number;
  /** 盈利能力得分：ROE/毛利率/净利率加权 */
  profitabilityScore: number;
  /** 财务健康得分：负债率/流动比率/现金流质量加权 */
  financialHealthScore: number;
  /** 成长性得分：营收/净利润同比增长率加权 */
  growthScore: number;
  /** 资金面得分：主力净流入/换手率趋势加权 */
  capitalFlowScore: number;
  /** 技术面得分：均线排列/MACD/RSI 综合 */
  technicalScore: number;
  /** 综合得分（以上各维度加权平均） */
  totalScore: number;
  /** 综合评级文字：'强烈推荐' | '推荐' | '中性' | '谨慎' | '回避' */
  rating: string;
}

/** 分析 Tab 总响应 */
export class StockAnalysisDataDto {
  tsCode: string;
  /** 股票名称（冗余返回，方便前端显示） */
  name: string | null;
  /** 所属行业 */
  industry: string | null;
  /** 数据截止交易日 */
  dataDate: string | null;
  /** 综合评分 */
  score: OverallScoreDto;
  /** 估值分析 */
  valuation: ValuationAnalysisDto;
  /** 盈利能力分析 */
  profitability: ProfitabilityAnalysisDto;
  /** 财务健康度 */
  financialHealth: FinancialHealthAnalysisDto;
  /** 成长性分析 */
  growth: GrowthAnalysisDto;
  /** 资金面分析 */
  capitalFlow: CapitalFlowAnalysisDto;
  /** 技术指标分析 */
  technical: TechnicalAnalysisDto;
}
```

#### Controller 定义

```typescript
// 文件: src/apps/stock/stock.controller.ts（新增 method）

@Post('detail/analysis')
@ApiSuccessResponse(StockAnalysisDataDto)
async getDetailAnalysis(@Body() dto: StockDetailAnalysisDto) {
  return this.stockService.getDetailAnalysis(dto.tsCode);
}
```

---

### 2.2 行业对比接口 — `POST /stock/detail/analysis/industry-compare`

> 返回该股票所在行业的关键指标对比数据，帮助用户判断该股票在行业中的相对位置。

#### 请求 DTO

```typescript
export class StockAnalysisIndustryCompareDto {
  @IsString()
  @IsNotEmpty()
  tsCode: string;
}
```

#### 响应 DTO

```typescript
export class IndustryCompareItemDto {
  tsCode: string;
  name: string | null;
  /** 总市值（万元） */
  totalMv: number | null;
  peTtm: number | null;
  pb: number | null;
  roe: number | null;
  revenueYoy: number | null;
  netprofitYoy: number | null;
  grossMargin: number | null;
  debtToAssets: number | null;
  /** 最近 5 日主力净流入（万元） */
  mainNetInflow5d: number | null;
  /** 是否为当前查询股票 */
  isCurrent: boolean;
}

export class IndustryCompareDataDto {
  tsCode: string;
  /** 行业名称 */
  industry: string;
  /** 行业内股票数量 */
  totalCount: number;
  /** 当前股票在行业中的排名（按总市值降序） */
  rankByMv: number;
  /** 行业平均 PE(TTM) */
  industryAvgPeTtm: number | null;
  /** 行业平均 PB */
  industryAvgPb: number | null;
  /** 行业平均 ROE */
  industryAvgRoe: number | null;

  /** 行业内 Top 20 + 当前股票（如果不在 Top 20 中则追加），按总市值降序 */
  items: IndustryCompareItemDto[];
}
```

#### Controller 定义

```typescript
@Post('detail/analysis/industry-compare')
@ApiSuccessResponse(IndustryCompareDataDto)
async getAnalysisIndustryCompare(@Body() dto: StockAnalysisIndustryCompareDto) {
  return this.stockService.getAnalysisIndustryCompare(dto.tsCode);
}
```

---

## 三、Service 实现指导

### 3.1 文件组织

由于 `stock.service.ts` 已经约 53KB，**不应继续在其中添加大量分析逻辑**。建议新建一个独立的分析 service：

```
src/apps/stock/
├── stock.controller.ts          # 新增 2 个 endpoint
├── stock.module.ts              # 注册新 service
├── stock.service.ts             # 现有逻辑不动
├── stock-analysis.service.ts    # 🆕 分析 Tab 所有计算逻辑
├── dto/
│   ├── stock-request.dto.ts     # 新增 2 个请求 DTO class
│   └── stock-response.dto.ts    # 新增分析相关响应 DTO class
```

### 3.2 `StockAnalysisService` 核心方法

```typescript
// 文件: src/apps/stock/stock-analysis.service.ts

@Injectable()
export class StockAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  /** 综合分析入口 */
  async getDetailAnalysis(tsCode: string): Promise<StockAnalysisDataDto> {
    // 1. 获取股票基础信息
    const basic = await this.getBasicInfo(tsCode);
    // 2. 并行计算各维度
    const [valuation, profitability, financialHealth, growth, capitalFlow, technical] =
      await Promise.all([
        this.analyzeValuation(tsCode),
        this.analyzeProfitability(tsCode),
        this.analyzeFinancialHealth(tsCode),
        this.analyzeGrowth(tsCode),
        this.analyzeCapitalFlow(tsCode),
        this.analyzeTechnical(tsCode),
      ]);
    // 3. 计算综合评分
    const score = this.calculateOverallScore(valuation, profitability, financialHealth, growth, capitalFlow, technical);
    // 4. 组装返回
    return { tsCode, name: basic.name, industry: basic.industry, dataDate: ..., score, valuation, profitability, financialHealth, growth, capitalFlow, technical };
  }

  /** 行业对比 */
  async getIndustryCompare(tsCode: string): Promise<IndustryCompareDataDto> { ... }
}
```

### 3.3 各维度计算逻辑说明

#### 3.3.1 估值分析 (`analyzeValuation`)

**数据来源**：`stock_daily_valuation_metrics` 表

**计算步骤**：

1. 查最新一条记录获取当前 PE/PB/PS/股息率/市值
2. 查近 1 年（约 250 个交易日）的所有记录
3. 计算 PE 百分位：`percentile = (数据中 <= 当前值的记录数) / 总记录数 * 100`
4. 计算 PB 百分位：同上
5. 查近 3 年数据计算 3 年百分位
6. 返回近 1 年日频 PE/PB 历史序列（用于前端绘图）

```sql
-- 伪 SQL：计算 PE 百分位
SELECT COUNT(*) as total,
       SUM(CASE WHEN pe_ttm <= :currentPe THEN 1 ELSE 0 END) as below
FROM stock_daily_valuation_metrics
WHERE ts_code = :tsCode
  AND trade_date >= :oneYearAgo
  AND pe_ttm IS NOT NULL;
-- percentile = below / total * 100
```

#### 3.3.2 盈利能力分析 (`analyzeProfitability`)

**数据来源**：`financial_indicator_snapshots` 表

**计算步骤**：

1. 查最近 12 期（3 年，每季度一期）的财务指标，按 `endDate` 降序
2. 取最新一期的 ROE/ROA/毛利率/净利率/EPS
3. 返回趋势数组

```sql
-- Prisma 查询
prisma.financialIndicatorSnapshots.findMany({
  where: { tsCode },
  orderBy: { endDate: 'desc' },
  take: 12,
  select: { endDate, roe, roa, grossprofitMargin, netprofitMargin, eps }
})
```

#### 3.3.3 财务健康度 (`analyzeFinancialHealth`)

**数据来源**：`financial_indicator_snapshots` + `cashflow_reports`

**计算步骤**：

1. 查最近 12 期财务指标：`debtToAssets`, `currentRatio`, `quickRatio`, `ocfToNetprofit`
2. 查最近一期现金流：`freeCashflow`
3. 返回趋势数组

#### 3.3.4 成长性分析 (`analyzeGrowth`)

**数据来源**：`financial_indicator_snapshots` + `income_statement_reports`

**计算步骤**：

1. 查最近 12 期财务指标：`revenueYoy`, `netprofitYoy`, `dtNetprofitYoy`
2. 查最近 12 期利润表：`revenue`, `nIncome`（用于绝对值趋势图）
3. 返回趋势数组

#### 3.3.5 资金面分析 (`analyzeCapitalFlow`)

**数据来源**：`stock_capital_flows` + `stock_daily_valuation_metrics`

**计算步骤**：

1. 查近 20 个交易日的资金流向记录
2. 计算 5 日/10 日/20 日累计净流入
3. 计算主力净流入 = `(buyElgAmount - sellElgAmount) + (buyLgAmount - sellLgAmount)`（每日）
4. 查近 20 日换手率均值
5. 返回每日流向数据

#### 3.3.6 技术指标分析 (`analyzeTechnical`)

**数据来源**：`stock_daily_prices`

**计算步骤**：后端自行计算，不依赖 Tushare `stk_factor`。

1. 查近 300 个交易日的日线数据（需要足够多的历史来计算 MA250）
2. 计算以下指标：

| 指标 | 算法 |
|------|------|
| MA(N) | 最近 N 日收盘价的简单移动平均 |
| MACD | DIF = EMA(12) - EMA(26); DEA = EMA(DIF, 9); HIST = (DIF - DEA) * 2 |
| RSI(N) | 100 - 100 / (1 + 平均涨幅N日 / 平均跌幅N日) |
| KDJ | 9日RSV → K = 2/3×前K + 1/3×RSV; D = 2/3×前D + 1/3×K; J = 3K - 2D |
| BOLL | MID = MA(20); UPPER = MID + 2σ; LOWER = MID - 2σ（σ为20日标准差） |

3. 返回最新值 + 最近 60 日历史序列
4. 判断信号：
   - `maBullish`：MA5 > MA10 > MA20 > MA60 为多头排列
   - `macdSignal`：DIF 上穿 DEA 为金叉，DIF 下穿 DEA 为死叉（对比前一日）
   - `bollPosition`：收盘价与布林带的相对位置

> **实现建议**：将技术指标计算逻辑抽成独立的纯函数工具文件 `src/apps/stock/utils/technical-indicators.ts`，方便单元测试。

#### 3.3.7 综合评分 (`calculateOverallScore`)

评分规则（每维度 0~100 分）：

| 维度 | 权重 | 评分逻辑 |
|------|------|---------|
| 估值 | 20% | PE 百分位越低越高分：`score = 100 - peTtmPercentile1Y`；PB 百分位辅助修正 |
| 盈利能力 | 20% | ROE 分段计分：>20%→90分, >15%→75分, >10%→60分, >5%→40分, 其余→20分；毛利率/净利率辅助修正 |
| 财务健康 | 15% | 资产负债率 <40%→90分, <60%→70分, <80%→40分, 其余→20分；流动比率/现金流质量辅助修正 |
| 成长性 | 20% | 营收同比分段：>30%→90分, >15%→70分, >0%→50分, 其余→20分；净利润同比辅助修正 |
| 资金面 | 10% | 5日主力净流入 > 0 且趋势向上→高分；持续流出→低分 |
| 技术面 | 15% | 多头排列+MACD金叉→高分；空头排列+MACD死叉→低分；RSI 超买超卖修正 |

**综合得分** = Σ(各维度得分 × 权重)

**评级映射**：
- ≥80：强烈推荐
- ≥65：推荐
- ≥50：中性
- ≥35：谨慎
- <35：回避

---

## 四、数据库查询优化

### 4.1 已有索引（可直接利用）

以下索引在现有 schema 中已存在，分析查询可以直接高效使用：

| 表 | 索引 | 用途 |
|---|------|------|
| `stock_daily_valuation_metrics` | `(tsCode, tradeDate)` 主键 | 估值历史查询 |
| `financial_indicator_snapshots` | `(tsCode, endDate)` 主键 | 财务指标趋势 |
| `income_statement_reports` | `(tsCode, endDate, reportType)` 主键 | 利润表数据 |
| `balance_sheet_reports` | `(tsCode, endDate, reportType)` 主键 | 资产负债表 |
| `cashflow_reports` | `(tsCode, endDate, reportType)` 主键 | 现金流量表 |
| `stock_capital_flows` | `(tsCode, tradeDate)` 主键 | 资金流向 |
| `stock_daily_prices` | `(tsCode, tradeDate)` 主键 | 日线数据 |
| `stock_basic_profiles` | `(tsCode)` 主键 + `industry` 索引 | 行业对比 |

### 4.2 查询性能建议

1. **并行查询**：`getDetailAnalysis` 中 6 个维度的数据查询互不依赖，使用 `Promise.all()` 并行执行
2. **限制数据量**：
   - 估值历史：最多 750 条（3 年日频）
   - 财务指标趋势：最多 12 条（3 年季度）
   - 技术指标计算：查 300 条日线，返回前端 60 条
   - 资金流向：最多 20 条
3. **行业对比优化**：行业内股票可能较多，使用 `take: 20` 限制返回量，仅当当前股票不在 Top 20 时才追加

---

## 五、Module 注册

```typescript
// 文件: src/apps/stock/stock.module.ts

@Module({
  imports: [PrismaModule],
  controllers: [StockController],
  providers: [StockService, StockAnalysisService], // 新增 StockAnalysisService
})
export class StockModule {}
```

`StockController` 中新增的 2 个 endpoint 可直接注入 `StockAnalysisService`，也可以通过 `StockService` 委托调用（推荐前者，保持职责分离）。

---

## 六、实现顺序建议

| 步骤 | 内容 | 预估复杂度 |
|------|------|-----------|
| 1 | 创建 DTO 定义（请求 + 响应） | 低 |
| 2 | 创建 `StockAnalysisService` 骨架 + Module 注册 | 低 |
| 3 | 实现估值分析（百分位计算 + 历史序列） | 中 |
| 4 | 实现盈利能力分析（财务指标趋势） | 低 |
| 5 | 实现财务健康度分析 | 低 |
| 6 | 实现成长性分析 | 低 |
| 7 | 实现资金面分析 | 低 |
| 8 | 实现技术指标计算工具函数 + 单元测试 | 高 |
| 9 | 实现技术指标分析 | 中 |
| 10 | 实现综合评分逻辑 | 中 |
| 11 | 实现行业对比接口 | 中 |
| 12 | Controller 注册 + Swagger 文档 | 低 |
| 13 | 编译验证 + 接口调试 | 低 |

---

## 七、注意事项

1. **不要在 stock.service.ts 中堆砌分析逻辑**。stock.service.ts 已经很大，分析逻辑全部放在新建的 `stock-analysis.service.ts` 中。
2. **技术指标计算函数应该是纯函数**，输入为价格数组，输出为指标数组，不依赖数据库，方便单元测试。建议放在 `src/apps/stock/utils/technical-indicators.ts`。
3. **评分逻辑的阈值应当可配置**，建议在 service 顶部用常量定义，后续可以抽成配置文件。
4. **响应 DTO 的 `class-validator` 和 `class-transformer` 装饰器**：请求 DTO 需要 `@IsString()` 等校验装饰器；响应 DTO 建议加 `@ApiProperty()` 用于 Swagger 文档生成。
5. **遵循现有 Controller 约定**：使用 `@ApiSuccessResponse(Dto)` 装饰器包装响应，`TransformInterceptor` 会自动将返回值包装为 `ResponseModel.success({ data })`。
6. **空数据处理**：如果某只股票缺少某个维度的数据（例如新上市股票没有 3 年估值历史），对应百分位返回 `null`，评分跳过该维度并调整权重。
