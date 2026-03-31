# 股票详情 — 分析 Tab 前端实现规划

> **目标读者**：AI 代码生成助手。请严格按照本文定义的组件结构、API 调用方式、图表类型实现。
> **前置上下文**：
> - 前端仓库 `client-code`，技术栈：React + TypeScript + MUI (Material UI) + echarts-for-react
> - 分析 Tab 已在 `src/sections/stock-detail/stock-detail-analysis-tab.tsx` 中以空占位页面存在
> - 后端接口设计见 `docs/STOCK_ANALYSIS_BACKEND.md`
> - 已有 Tab 组件（行情、公司概况、财务、股本股东、分红融资）可作为实现参考

---

## 一、页面整体结构

分析 Tab 分为以下区域，自上而下排列：

```
┌─────────────────────────────────────────────────────┐
│  ① 综合评分卡 (Overall Score Card)                    │
│  ┌─────────────┐  ┌───────────────────────────────┐  │
│  │  雷达图      │  │  评分明细 + 评级标签           │  │
│  └─────────────┘  └───────────────────────────────┘  │
├─────────────────────────────────────────────────────┤
│  ② 估值分析卡 (Valuation Analysis)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ 当前估值   │  │ 百分位仪表│  │ PE/PB 历史趋势图  │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
├─────────────────────────────────────────────────────┤
│  ③ 盈利能力分析卡 (Profitability Analysis)             │
│  ┌──────────┐  ┌────────────────────────────────┐   │
│  │ 最新指标   │  │ ROE/毛利率/净利率 趋势折线图    │   │
│  └──────────┘  └────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  ④ 财务健康度卡 (Financial Health)                     │
│  ┌──────────┐  ┌────────────────────────────────┐   │
│  │ 最新指标   │  │ 负债率/流动比率 趋势折线图      │   │
│  └──────────┘  └────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  ⑤ 成长性分析卡 (Growth Analysis)                      │
│  ┌──────────┐  ┌────────────────────────────────┐   │
│  │ 最新增速   │  │ 营收/净利润 双轴柱线图          │   │
│  └──────────┘  └────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  ⑥ 资金面分析卡 (Capital Flow Analysis)                │
│  ┌──────────┐  ┌────────────────────────────────┐   │
│  │ 资金汇总   │  │ 每日资金流向 柱状图 + 价格线    │   │
│  └──────────┘  └────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  ⑦ 技术指标分析卡 (Technical Analysis)                 │
│  ┌──────────┐  ┌────────────────────────────────┐   │
│  │ 信号摘要   │  │ 副图指标（MACD/RSI/KDJ 可切换） │   │
│  └──────────┘  └────────────────────────────────┘   │
├─────────────────────────────────────────────────────┤
│  ⑧ 行业对比卡 (Industry Comparison)                   │
│  ┌────────────────────────────────────────────────┐  │
│  │ 行业对比数据表 + 当前股票高亮                     │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

---

## 二、API 调用定义

### 2.1 新增 API 类型

在 `src/api/stock.ts` 中新增以下类型和方法：

```typescript
// ========== 分析 Tab 类型 ==========

/** 估值历史点 */
export type ValuationHistoryPoint = {
  tradeDate: string;
  value: number | null;
};

/** 估值分析数据 */
export type ValuationAnalysis = {
  peTtm: number | null;
  pb: number | null;
  psTtm: number | null;
  dvTtm: number | null;
  totalMv: number | null;
  circMv: number | null;
  peTtmPercentile1Y: number | null;
  pbPercentile1Y: number | null;
  peTtmPercentile3Y: number | null;
  pbPercentile3Y: number | null;
  peTtmHistory: ValuationHistoryPoint[];
  pbHistory: ValuationHistoryPoint[];
};

/** 盈利能力趋势点 */
export type ProfitabilityTrendPoint = {
  endDate: string;
  roe: number | null;
  roa: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  eps: number | null;
};

/** 盈利能力分析数据 */
export type ProfitabilityAnalysis = {
  latestPeriod: string | null;
  roe: number | null;
  roa: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  eps: number | null;
  trend: ProfitabilityTrendPoint[];
};

/** 财务健康趋势点 */
export type FinancialHealthTrendPoint = {
  endDate: string;
  debtToAssets: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  ocfToNetprofit: number | null;
};

/** 财务健康度分析数据 */
export type FinancialHealthAnalysis = {
  latestPeriod: string | null;
  debtToAssets: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  ocfToNetprofit: number | null;
  freeCashflow: number | null;
  trend: FinancialHealthTrendPoint[];
};

/** 成长性趋势点 */
export type GrowthTrendPoint = {
  endDate: string;
  revenue: number | null;
  nIncome: number | null;
  revenueYoy: number | null;
  netprofitYoy: number | null;
};

/** 成长性分析数据 */
export type GrowthAnalysis = {
  latestPeriod: string | null;
  revenueYoy: number | null;
  netprofitYoy: number | null;
  dtNetprofitYoy: number | null;
  revenue: number | null;
  nIncome: number | null;
  trend: GrowthTrendPoint[];
};

/** 资金流日数据 */
export type CapitalFlowDailyPoint = {
  tradeDate: string;
  netMfAmount: number | null;
  mainNetAmount: number | null;
  close: number | null;
};

/** 资金面分析数据 */
export type CapitalFlowAnalysis = {
  netInflow5d: number | null;
  netInflow10d: number | null;
  netInflow20d: number | null;
  mainNetInflow5d: number | null;
  mainNetInflow20d: number | null;
  avgTurnover5d: number | null;
  avgTurnover20d: number | null;
  dailyFlow: CapitalFlowDailyPoint[];
};

/** 技术指标历史点 */
export type TechnicalHistoryPoint = {
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
};

/** 技术指标分析数据 */
export type TechnicalAnalysis = {
  tradeDate: string | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  ma250: number | null;
  maBullish: boolean | null;
  macdDif: number | null;
  macdDea: number | null;
  macdHist: number | null;
  macdSignal: string | null;
  rsi6: number | null;
  rsi12: number | null;
  rsi24: number | null;
  kdjK: number | null;
  kdjD: number | null;
  kdjJ: number | null;
  bollUpper: number | null;
  bollMid: number | null;
  bollLower: number | null;
  bollPosition: string | null;
  history: TechnicalHistoryPoint[];
};

/** 综合评分 */
export type OverallScore = {
  valuationScore: number;
  profitabilityScore: number;
  financialHealthScore: number;
  growthScore: number;
  capitalFlowScore: number;
  technicalScore: number;
  totalScore: number;
  rating: string;
};

/** 分析 Tab 完整数据 */
export type StockAnalysisData = {
  tsCode: string;
  name: string | null;
  industry: string | null;
  dataDate: string | null;
  score: OverallScore;
  valuation: ValuationAnalysis;
  profitability: ProfitabilityAnalysis;
  financialHealth: FinancialHealthAnalysis;
  growth: GrowthAnalysis;
  capitalFlow: CapitalFlowAnalysis;
  technical: TechnicalAnalysis;
};

/** 行业对比条目 */
export type IndustryCompareItem = {
  tsCode: string;
  name: string | null;
  totalMv: number | null;
  peTtm: number | null;
  pb: number | null;
  roe: number | null;
  revenueYoy: number | null;
  netprofitYoy: number | null;
  grossMargin: number | null;
  debtToAssets: number | null;
  mainNetInflow5d: number | null;
  isCurrent: boolean;
};

/** 行业对比数据 */
export type IndustryCompareData = {
  tsCode: string;
  industry: string;
  totalCount: number;
  rankByMv: number;
  industryAvgPeTtm: number | null;
  industryAvgPb: number | null;
  industryAvgRoe: number | null;
  items: IndustryCompareItem[];
};
```

### 2.2 新增 API 方法

在 `stockDetailApi` 对象中新增：

```typescript
export const stockDetailApi = {
  // ... 已有方法 ...

  /** 股票详情 - 分析 Tab 综合数据 */
  analysis: (tsCode: string): Promise<StockAnalysisData> =>
    apiClient.post<StockAnalysisData>('/api/stock/detail/analysis', { tsCode }),

  /** 股票详情 - 行业对比 */
  industryCompare: (tsCode: string): Promise<IndustryCompareData> =>
    apiClient.post<IndustryCompareData>('/api/stock/detail/analysis/industry-compare', { tsCode }),
};
```

---

## 三、组件结构

### 3.1 文件组织

```
src/sections/stock-detail/
├── stock-detail-analysis-tab.tsx            # 🔄 改造：分析 Tab 主容器
├── analysis/                                # 🆕 新建目录
│   ├── analysis-overall-score-card.tsx       # ① 综合评分卡（雷达图 + 评分明细）
│   ├── analysis-valuation-card.tsx           # ② 估值分析卡
│   ├── analysis-profitability-card.tsx       # ③ 盈利能力分析卡
│   ├── analysis-financial-health-card.tsx    # ④ 财务健康度卡
│   ├── analysis-growth-card.tsx              # ⑤ 成长性分析卡
│   ├── analysis-capital-flow-card.tsx        # ⑥ 资金面分析卡
│   ├── analysis-technical-card.tsx           # ⑦ 技术指标分析卡
│   └── analysis-industry-compare-card.tsx    # ⑧ 行业对比卡
```

### 3.2 主容器改造

```typescript
// 文件: src/sections/stock-detail/stock-detail-analysis-tab.tsx

type Props = { tsCode: string };

export function StockDetailAnalysisTab({ tsCode }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<StockAnalysisData | null>(null);
  const [compareData, setCompareData] = useState<IndustryCompareData | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // 主分析数据 + 行业对比并行加载
  useEffect(() => {
    if (!tsCode) return;
    setLoading(true);
    setError('');
    Promise.all([
      stockDetailApi.analysis(tsCode),
      stockDetailApi.industryCompare(tsCode),
    ])
      .then(([analysisRes, compareRes]) => {
        setData(analysisRes);
        setCompareData(compareRes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : '加载分析数据失败'))
      .finally(() => setLoading(false));
  }, [tsCode]);

  if (loading) return <AnalysisSkeleton />;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return null;

  return (
    <Stack spacing={3}>
      <AnalysisOverallScoreCard score={data.score} />
      <AnalysisValuationCard data={data.valuation} />
      <AnalysisProfitabilityCard data={data.profitability} />
      <AnalysisFinancialHealthCard data={data.financialHealth} />
      <AnalysisGrowthCard data={data.growth} />
      <AnalysisCapitalFlowCard data={data.capitalFlow} />
      <AnalysisTechnicalCard data={data.technical} />
      {compareData && <AnalysisIndustryCompareCard data={compareData} />}
    </Stack>
  );
}
```

**注意**：需要同步修改 `stock-detail-view.tsx` 中的调用，将 `tsCode` 传递给分析 Tab：

```typescript
// 修改前
{activeTab === 'analysis' && <StockDetailAnalysisTab />}

// 修改后
{activeTab === 'analysis' && <StockDetailAnalysisTab tsCode={tsCode} />}
```

---

## 四、各卡片组件详细规格

### 4.1 综合评分卡 (`AnalysisOverallScoreCard`)

**布局**：左侧雷达图 + 右侧评分明细

**左侧 — 雷达图**：
- 使用 `echarts-for-react`，图表类型 `radar`
- 6 个维度：估值、盈利能力、财务健康、成长性、资金面、技术面
- 每个维度最大值 100
- 填充颜色使用主题色 `primary.main`，半透明填充

**右侧 — 评分明细**：
- 综合得分：大号数字 + 评级标签（Label 组件，颜色映射：强烈推荐→error, 推荐→warning, 中性→info, 谨慎→default, 回避→default）
- 6 个维度分数：每行一个维度，显示维度名称 + 进度条 (LinearProgress) + 分数
- 进度条颜色：≥70 绿色, ≥50 橙色, <50 红色

```typescript
type Props = { score: OverallScore };
```

### 4.2 估值分析卡 (`AnalysisValuationCard`)

**布局**：上方当前估值指标网格 + 下方百分位图 + 历史趋势图

**当前估值指标网格**（类似 Header 中的 StatItem 风格）：
- PE(TTM)、PB、PS(TTM)、股息率(TTM)%、总市值、流通市值
- 每个指标值旁边显示百分位标签，例如 "PE 12.5 | 近1年偏低(23%)"

**百分位仪表盘**（2 个半圆仪表盘并排）：
- 使用 `echarts-for-react`，图表类型 `gauge`
- 左：PE(TTM) 百分位仪表盘（0~100，指针指向当前百分位）
- 右：PB 百分位仪表盘
- 颜色分段：0-30 绿色(低估), 30-70 黄色(适中), 70-100 红色(高估)

**PE/PB 历史趋势图**：
- 使用 `echarts-for-react`，双 Y 轴折线图
- X 轴：近 1 年日期
- 左 Y 轴：PE(TTM) 折线
- 右 Y 轴：PB 折线
- 工具栏：dataZoom 支持拖拽缩放

```typescript
type Props = { data: ValuationAnalysis };
```

### 4.3 盈利能力分析卡 (`AnalysisProfitabilityCard`)

**布局**：左侧最新指标面板 + 右侧趋势折线图

**最新指标面板**（竖向排列）：
- ROE(%)、ROA(%)、毛利率(%)、净利率(%)、EPS
- 每个指标用颜色标记：高于行业平均→绿色，低于→红色（首版无行业平均数据可先不做颜色标记，显示为中性色）

**趋势折线图**：
- 使用 `echarts-for-react`，多系列折线图
- X 轴：报告期 (endDate)，格式化为 `YYYY-Q{n}`
- 系列：ROE、毛利率、净利率（各一条线），左 Y 轴
- EPS 使用右 Y 轴（数值量级不同）
- legend 可切换显示/隐藏

```typescript
type Props = { data: ProfitabilityAnalysis };
```

### 4.4 财务健康度卡 (`AnalysisFinancialHealthCard`)

**布局**：左侧最新指标面板 + 右侧趋势折线图

**最新指标面板**：
- 资产负债率(%)、流动比率、速动比率、经营现金流/净利润(%)、自由现金流（亿元）
- 资产负债率标记：<40% 绿色, 40~70% 黄色, >70% 红色
- 流动比率标记：>2 绿色, 1~2 黄色, <1 红色

**趋势折线图**：
- X 轴：报告期
- 双 Y 轴：左轴 → 资产负债率(%), 右轴 → 流动比率/速动比率
- 3 条线：资产负债率、流动比率、速动比率

```typescript
type Props = { data: FinancialHealthAnalysis };
```

### 4.5 成长性分析卡 (`AnalysisGrowthCard`)

**布局**：左侧最新增速指标 + 右侧双轴柱线图

**最新增速指标**：
- 营收同比(%)、净利润同比(%)、扣非净利润同比(%)
- 正增长红色, 负增长绿色

**双轴柱线图**：
- X 轴：报告期
- 左 Y 轴（柱状图）：营业收入（亿元，蓝色柱）、净利润（亿元，橙色柱）
- 右 Y 轴（折线图）：营收同比(%)、净利润同比(%) — 两条线
- 这种"柱线混合图"能同时展示绝对规模和增长速度

```typescript
type Props = { data: GrowthAnalysis };
```

### 4.6 资金面分析卡 (`AnalysisCapitalFlowCard`)

**布局**：上方资金汇总指标 + 下方每日资金流向柱状图

**资金汇总指标**（一行 Grid）：
- 5日净流入、10日净流入、20日净流入、5日主力净流入、20日主力净流入、5日换手率均值、20日换手率均值
- 净流入为正红色，为负绿色

**每日资金流向图**：
- X 轴：最近 20 个交易日
- 左 Y 轴（柱状图）：每日净流入（红绿柱，正红负绿）、主力净流入（半透明蓝柱叠加）
- 右 Y 轴（折线图）：收盘价趋势线
- 数据来自 `dailyFlow` 数组

```typescript
type Props = { data: CapitalFlowAnalysis };
```

### 4.7 技术指标分析卡 (`AnalysisTechnicalCard`)

**布局**：上方信号摘要面板 + 下方可切换副图指标图

**信号摘要面板**：
- 均线状态：多头排列 ✅ / 空头排列 ❌ / 中性 ➖
- MACD 信号：金叉 🔴 / 死叉 🟢 / 无信号 ➖
- RSI(14)：显示数值 + 状态标签（<30 超卖，>70 超买，其他中性）
- 布林带位置：显示文字描述
- 各均线当前值：MA5/MA10/MA20/MA60/MA120/MA250（Grid 排列）

**副图指标图**：
- 使用 `Tabs` 切换：MACD | RSI | KDJ | 布林带
- 各 Tab 使用 `echarts-for-react`：
  - **MACD Tab**：柱状图(HIST 红绿柱) + DIF/DEA 双折线
  - **RSI Tab**：RSI6/RSI12/RSI24 三折线，参考线 30/70
  - **KDJ Tab**：K/D/J 三折线，参考线 20/80
  - **布林带 Tab**：上/中/下三条线 + 收盘价线，区间填充
- X 轴：最近 60 个交易日
- 数据来自 `history` 数组

```typescript
type Props = { data: TechnicalAnalysis };
```

### 4.8 行业对比卡 (`AnalysisIndustryCompareCard`)

**布局**：标题行（行业名 + 排名标签） + 数据表格

**标题行**：
- "XX行业对比" + "共 N 只" + "市值排名第 X"

**数据表格**：
- 使用 MUI `Table`，固定首列（股票名称）
- 列：股票名称、总市值、PE(TTM)、PB、ROE(%)、营收同比(%)、净利润同比(%)、毛利率(%)、资产负债率(%)、5日主力净流入
- **当前股票行高亮**（背景色 `primary.lighter`）
- 行业平均值显示在底部汇总行
- 表头可点击排序

```typescript
type Props = { data: IndustryCompareData };
```

---

## 五、图表库使用约定

### 5.1 统一使用 `echarts-for-react`

所有图表使用 `echarts-for-react` 组件，**不要** 使用 `recharts` 或其他图表库。

```typescript
import ReactECharts from 'echarts-for-react';

// 用法
<ReactECharts
  option={chartOption}
  style={{ height: 300 }}
  opts={{ renderer: 'canvas' }}
/>
```

### 5.2 图表主题配色

遵循已有行情 Tab 中图表的风格：
- 上涨/正值：红色 `#d32f2f` (error.main)
- 下跌/负值：绿色 `#2e7d32` (success.main)
- 主题色：使用 MUI theme `primary.main`
- 折线颜色：使用 ECharts 默认调色盘，或手动指定 `['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272']`

### 5.3 响应式

- 图表高度固定（如 300px / 400px），宽度自适应
- 卡片内左右布局在移动端（xs/sm）改为上下布局
- 使用 MUI `Grid` 或 `Box` 的 responsive sx：
  ```typescript
  sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 2fr' }, gap: 3 }}
  ```

---

## 六、Loading / Error / Empty 状态

### 6.1 加载骨架 (`AnalysisSkeleton`)

参考已有 Tab 中的 Skeleton 写法：

```typescript
function AnalysisSkeleton() {
  return (
    <Stack spacing={3}>
      <Skeleton variant="rectangular" height={200} sx={{ borderRadius: 1.5 }} />
      {[...Array(6)].map((_, i) => (
        <Skeleton key={i} variant="rectangular" height={300} sx={{ borderRadius: 1.5 }} />
      ))}
    </Stack>
  );
}
```

### 6.2 错误状态

使用 MUI `Alert severity="error"`，显示错误信息。

### 6.3 空数据

各卡片内部判断数据是否有效：
- 如果核心数据全部为 `null`（如新股没有历史估值），显示提示文案："暂无数据"
- 如果部分数据为 `null`，图表中跳过该数据点，不影响其他展示

---

## 七、实现顺序建议

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 在 `src/api/stock.ts` 中新增类型定义和 API 方法 | 无 |
| 2 | 改造 `stock-detail-analysis-tab.tsx` 为主容器，传入 `tsCode` | 步骤 1 |
| 3 | 修改 `stock-detail-view.tsx` 传递 `tsCode` 给分析 Tab | 步骤 2 |
| 4 | 实现 `analysis-overall-score-card.tsx` （雷达图 + 评分） | 步骤 2 |
| 5 | 实现 `analysis-valuation-card.tsx` （仪表盘 + 趋势图） | 步骤 2 |
| 6 | 实现 `analysis-profitability-card.tsx` （折线图） | 步骤 2 |
| 7 | 实现 `analysis-financial-health-card.tsx` （折线图） | 步骤 2 |
| 8 | 实现 `analysis-growth-card.tsx` （柱线混合图） | 步骤 2 |
| 9 | 实现 `analysis-capital-flow-card.tsx` （柱状图） | 步骤 2 |
| 10 | 实现 `analysis-technical-card.tsx` （副图切换） | 步骤 2 |
| 11 | 实现 `analysis-industry-compare-card.tsx` （数据表格） | 步骤 2 |
| 12 | 联调 + 响应式优化 + 空数据处理 | 后端接口就绪 |

---

## 八、注意事项

1. **所有卡片都包裹在 MUI `<Card><CardContent>` 中**，保持和其他 Tab 一致的视觉风格。
2. **数字格式化**：复用 `src/utils/format-number.ts` 中已有的 `fNumber`、`fPercent`、`fPctChg`、`fWanYuan` 等工具函数。金额统一用万元/亿元自动切换。
3. **日期格式化**：复用 `src/utils/format-time.ts` 中的 `fDate`。报告期格式化为 `YYYY-MM-DD` 或 `YYYY-Q{n}`。
4. **颜色语义**：涨/正→红色(error)，跌/负→绿色(success)，符合 A 股用户习惯（已有 Tab 已遵循此规则）。
5. **图表无障碍**：每个图表的 `option` 中设置 `tooltip.trigger = 'axis'`，方便用户悬停查看数据。
6. **不要引入新的图表库**，统一使用 `echarts-for-react`。如果项目中尚未安装，需先执行 `pnpm add echarts echarts-for-react`。
7. **组件导出**：所有新建组件使用命名导出（`export function AnalysisXxxCard`），不使用默认导出，保持项目一致性。
