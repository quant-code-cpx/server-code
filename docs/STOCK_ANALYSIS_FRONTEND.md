# 股票详情 — 分析 Tab 前端实现规划

> **目标读者**：AI 代码生成助手。请严格按照本文定义的组件结构、API 调用方式、图表类型实现。
> **前置上下文**：
> - 前端仓库 `client-code`，技术栈：React + TypeScript + MUI (Material UI) + ApexCharts（已有 `src/components/chart` 封装）
> - 分析 Tab 已在 `src/sections/stock-detail/stock-detail-analysis-tab.tsx` 中以空占位页面存在
> - 后端接口设计见 `docs/STOCK_ANALYSIS_BACKEND.md`
> - 已有 Tab 组件（行情、公司概况、财务、股本股东、分红融资）可作为实现参考

---

## 一、已有 Tab 功能覆盖（不要重复）

| Tab | 已有功能 |
|-----|---------|
| **行情** | K 线图（蜡烛图 + MA5/10/20/60 + 成交量柱）、今日资金流向（超大/大/中/小单分级）、历史资金流向（净流入柱 + 涨跌幅线 60 日） |
| **财务** | 关键指标（ROE/ROA/EPS/毛利率/净利率/负债率/流动比率 8 期表）、利润表、资产负债表、现金流量表 |
| **股本股东** | 前十大股东 + 前十大流通股东 |
| **分红融资** | 分红记录、配股记录、融资记录 |

**分析 Tab 聚焦：技术分析指标、筹码分布、融资融券、择时信号、相对强弱 — 全部是纯技术面内容。**

---

## 二、页面整体结构

分析 Tab 采用 **上方标签导航 + 内容区** 的组织方式，按技术分析维度拆分为子 Tab：

```
┌─────────────────────────────────────────────────────────────┐
│  Sub-Tabs: [技术指标] [择时信号] [筹码分布] [融资融券] [相对强弱]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  当前选中的子 Tab 内容区                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 各子 Tab 内容概述

```
📊 技术指标 (Technical Indicators)
├── 信号摘要面板（一行 Chip 标签展示各指标多空状态）
├── 均线系统卡片
│   ├── 当前 MA 值 + 多空排列状态
│   └── 均线趋势图（价格线 + MA5/10/20/60/120/250）
├── 指标图表卡片（可切换子指标）
│   ├── MACD（DIF/DEA 线 + HIST 柱）
│   ├── KDJ（K/D/J 三线 + 超买超卖区间）
│   ├── RSI（RSI6/12/24 三线 + 参考线）
│   ├── BOLL（上/中/下轨 + 价格线 + 区间填充）
│   ├── WR 威廉指标（WR6/WR10 + 超买超卖区间）
│   ├── CCI 商品通道指数
│   ├── DMI 趋势指标（+DI/-DI/ADX/ADXR）
│   ├── TRIX 三重指数平均
│   ├── DMA 平行线差
│   ├── BIAS 乖离率
│   ├── OBV 能量潮
│   ├── VR 成交量变异率
│   ├── EMV 简易波动
│   ├── ROC 变动速率
│   ├── PSY 心理线
│   ├── BR/AR 人气意愿
│   ├── CR 带状能量
│   └── SAR 抛物线指标
└── 量价分析卡片（成交量 + 量比 + 换手率趋势）

📈 择时信号 (Timing Signals)
├── 综合择时评分卡（仪表盘 + 评级）
├── 各指标多空打分明细表（指标 | 信号 | 分数 | 原因）
└── 历史择时信号时间轴（买入/卖出/警告信号列表）

🔢 筹码分布 (Chip Distribution)
├── 筹码分布横向柱状图（价格 Y 轴 vs 筹码占比 X 轴）
├── 筹码集中度摘要（70%/90%区间、获利比例、平均成本）
└── 关键价位标注（主力成本、阻力区、支撑区）

💹 融资融券 (Margin Trading)
├── 融资融券摘要卡（余额 + 5日/20日变化率 + 趋势判断）
├── 融资余额趋势图（双轴：融资余额柱 + 收盘价线）
├── 融资净买入趋势图（柱状图）
└── 融券余额趋势图

📉 相对强弱 (Relative Strength)
├── 风险收益摘要卡（累计收益、超额收益、Beta、最大回撤等）
├── 累计收益对比图（个股 vs 基准指数 双折线）
├── 超额收益趋势图
└── 指数选择器（沪深300 / 上证指数 / 深证成指 / 创业板指）
```

---

## 三、API 调用定义

### 3.1 新增 API 类型

在 `src/api/stock.ts` 中新增以下类型和方法：

```typescript
// ========== 分析 Tab — 技术指标 ==========

/** 技术指标单日数据点 */
export type TechnicalDataPoint = {
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  vol: number | null;
  amount: number | null;
  pctChg: number | null;
  // 均线
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  ma250: number | null;
  ema12: number | null;
  ema26: number | null;
  // MACD
  macdDif: number | null;
  macdDea: number | null;
  macdHist: number | null;
  // KDJ
  kdjK: number | null;
  kdjD: number | null;
  kdjJ: number | null;
  // RSI
  rsi6: number | null;
  rsi12: number | null;
  rsi24: number | null;
  // BOLL
  bollUpper: number | null;
  bollMid: number | null;
  bollLower: number | null;
  // WR
  wr6: number | null;
  wr10: number | null;
  // CCI
  cci: number | null;
  // DMI
  dmiPdi: number | null;
  dmiMdi: number | null;
  dmiAdx: number | null;
  dmiAdxr: number | null;
  // TRIX
  trix: number | null;
  trixMa: number | null;
  // DMA
  dma: number | null;
  dmaMa: number | null;
  // BIAS
  bias6: number | null;
  bias12: number | null;
  bias24: number | null;
  // OBV
  obv: number | null;
  obvMa: number | null;
  // VR
  vr: number | null;
  // EMV
  emv: number | null;
  emvMa: number | null;
  // ROC
  roc: number | null;
  rocMa: number | null;
  // PSY
  psy: number | null;
  psyMa: number | null;
  // BR/AR/CR
  br: number | null;
  ar: number | null;
  cr: number | null;
  // SAR
  sar: number | null;
  sarBullish: boolean | null;
  // 量价
  volMa5: number | null;
  volMa10: number | null;
  volMa20: number | null;
  volumeRatio: number | null;
  // 波动率
  atr14: number | null;
  hv20: number | null;
};

/** 均线多空状态 */
export type MaStatusSummary = {
  bullishAlign: boolean | null;
  bearishAlign: boolean | null;
  aboveMa20: boolean | null;
  aboveMa60: boolean | null;
  aboveMa250: boolean | null;
  latestCross: string | null;
};

/** 指标信号摘要 */
export type SignalSummary = {
  macd: string | null;
  kdj: string | null;
  rsi: string | null;
  boll: string | null;
  wr: string | null;
  cci: string | null;
  dmi: string | null;
  sar: string | null;
  volumePrice: string | null;
};

/** 技术指标响应 */
export type StockTechnicalData = {
  tsCode: string;
  period: string;
  dataDate: string | null;
  maStatus: MaStatusSummary;
  signals: SignalSummary;
  history: TechnicalDataPoint[];
};

// ========== 分析 Tab — 择时信号 ==========

export type TimingSignalItem = {
  tradeDate: string;
  type: string;        // 'buy' | 'sell' | 'warning'
  strength: number;    // 1-5
  source: string;      // 'MACD' | 'KDJ' | ...
  description: string;
  closePrice: number | null;
};

export type TimingScoreDetail = {
  indicator: string;
  signal: string;
  score: number;
  reason: string;
};

export type TimingScoreSummary = {
  score: number;
  rating: string;
  bullishCount: number;
  bearishCount: number;
  neutralCount: number;
  details: TimingScoreDetail[];
};

export type StockTimingSignalsData = {
  tsCode: string;
  scoreSummary: TimingScoreSummary;
  signals: TimingSignalItem[];
};

// ========== 分析 Tab — 筹码分布 ==========

export type ChipConcentration = {
  range90Low: number | null;
  range90High: number | null;
  range70Low: number | null;
  range70High: number | null;
  score: number | null;
  profitRatio: number | null;
  avgCost: number | null;
};

export type ChipDistributionBin = {
  priceLow: number;
  priceHigh: number;
  percent: number;
  isProfit: boolean;
};

export type ChipKeyLevels = {
  peakPrice: number | null;
  resistanceHigh: number | null;
  resistanceLow: number | null;
  supportHigh: number | null;
  supportLow: number | null;
};

export type ChipDistributionData = {
  tsCode: string;
  tradeDate: string;
  currentPrice: number | null;
  concentration: ChipConcentration;
  distribution: ChipDistributionBin[];
  keyLevels: ChipKeyLevels;
  isEstimated: boolean;
};

// ========== 分析 Tab — 融资融券 ==========

export type MarginDailyItem = {
  tradeDate: string;
  rzye: number | null;
  rzmre: number | null;
  rzche: number | null;
  rzjmre: number | null;
  rqye: number | null;
  rqmcl: number | null;
  rqchl: number | null;
  rzrqye: number | null;
  close: number | null;
};

export type MarginSummary = {
  latestRzye: number | null;
  latestRqye: number | null;
  latestRzrqye: number | null;
  rzNetBuy5d: number | null;
  rzNetBuy20d: number | null;
  rzye5dChgPct: number | null;
  rzye20dChgPct: number | null;
  trend: string;
};

export type StockMarginData = {
  tsCode: string;
  summary: MarginSummary;
  history: MarginDailyItem[];
  available: boolean;
};

// ========== 分析 Tab — 相对强弱 ==========

export type RelativeStrengthPoint = {
  tradeDate: string;
  stockCumReturn: number;
  benchmarkCumReturn: number;
  excessReturn: number;
  rsRatio: number;
};

export type RelativeStrengthSummary = {
  stockTotalReturn: number | null;
  benchmarkTotalReturn: number | null;
  excessReturn: number | null;
  excess20d: number | null;
  annualizedVol: number | null;
  maxDrawdown: number | null;
  beta: number | null;
  informationRatio: number | null;
};

export type StockRelativeStrengthData = {
  tsCode: string;
  benchmarkCode: string;
  benchmarkName: string;
  summary: RelativeStrengthSummary;
  history: RelativeStrengthPoint[];
};
```

### 3.2 新增 API 方法

在 `stockDetailApi` 对象中新增：

```typescript
export const stockDetailApi = {
  // ... 已有方法 ...

  /** 分析 - 技术指标 */
  technicalIndicators: (tsCode: string, period?: string, days?: number): Promise<StockTechnicalData> =>
    apiClient.post<StockTechnicalData>('/api/stock/detail/analysis/technical', { tsCode, period, days }),

  /** 分析 - 择时信号 */
  timingSignals: (tsCode: string, days?: number): Promise<StockTimingSignalsData> =>
    apiClient.post<StockTimingSignalsData>('/api/stock/detail/analysis/timing-signals', { tsCode, days }),

  /** 分析 - 筹码分布 */
  chipDistribution: (tsCode: string, tradeDate?: string): Promise<ChipDistributionData> =>
    apiClient.post<ChipDistributionData>('/api/stock/detail/analysis/chip-distribution', { tsCode, tradeDate }),

  /** 分析 - 融资融券 */
  marginData: (tsCode: string, days?: number): Promise<StockMarginData> =>
    apiClient.post<StockMarginData>('/api/stock/detail/analysis/margin', { tsCode, days }),

  /** 分析 - 相对强弱 */
  relativeStrength: (tsCode: string, benchmarkCode?: string, days?: number): Promise<StockRelativeStrengthData> =>
    apiClient.post<StockRelativeStrengthData>('/api/stock/detail/analysis/relative-strength', { tsCode, benchmarkCode, days }),
};
```

---

## 四、组件结构

### 4.1 文件组织

```
src/sections/stock-detail/
├── stock-detail-analysis-tab.tsx                     # 🔄 改造：分析 Tab 主容器（Sub-Tabs）
├── analysis/                                         # 🆕 新建目录
│   ├── analysis-technical-tab.tsx                     # 技术指标子 Tab 主容器
│   ├── analysis-technical-signal-panel.tsx             # 信号摘要面板
│   ├── analysis-technical-ma-card.tsx                  # 均线系统卡片
│   ├── analysis-technical-indicator-card.tsx           # 可切换指标图表卡片
│   ├── analysis-technical-volume-card.tsx              # 量价分析卡片
│   ├── analysis-timing-tab.tsx                        # 择时信号子 Tab
│   ├── analysis-timing-score-card.tsx                  # 择时评分仪表盘
│   ├── analysis-timing-details-table.tsx               # 多空打分明细
│   ├── analysis-timing-signal-timeline.tsx             # 历史信号时间轴
│   ├── analysis-chip-tab.tsx                          # 筹码分布子 Tab
│   ├── analysis-chip-distribution-chart.tsx            # 筹码分布图
│   ├── analysis-chip-summary-card.tsx                  # 筹码摘要
│   ├── analysis-margin-tab.tsx                        # 融资融券子 Tab
│   ├── analysis-margin-summary-card.tsx                # 融资融券摘要
│   ├── analysis-margin-chart.tsx                       # 融资融券趋势图
│   ├── analysis-relative-strength-tab.tsx             # 相对强弱子 Tab
│   ├── analysis-relative-strength-summary-card.tsx     # 风险收益摘要
│   └── analysis-relative-strength-chart.tsx            # 相对强弱对比图
```

### 4.2 主容器改造

```typescript
// 文件: src/sections/stock-detail/stock-detail-analysis-tab.tsx

type Props = { tsCode: string };

const SUB_TABS = [
  { value: 'technical', label: '技术指标' },
  { value: 'timing', label: '择时信号' },
  { value: 'chip', label: '筹码分布' },
  { value: 'margin', label: '融资融券' },
  { value: 'relativeStrength', label: '相对强弱' },
];

export function StockDetailAnalysisTab({ tsCode }: Props) {
  const [subTab, setSubTab] = useState('technical');

  return (
    <Stack spacing={3}>
      <Card>
        <Tabs
          value={subTab}
          onChange={(_, v) => setSubTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}
        >
          {SUB_TABS.map((tab) => (
            <Tab key={tab.value} value={tab.value} label={tab.label} />
          ))}
        </Tabs>
      </Card>

      {subTab === 'technical' && <AnalysisTechnicalTab tsCode={tsCode} />}
      {subTab === 'timing' && <AnalysisTimingTab tsCode={tsCode} />}
      {subTab === 'chip' && <AnalysisChipTab tsCode={tsCode} />}
      {subTab === 'margin' && <AnalysisMarginTab tsCode={tsCode} />}
      {subTab === 'relativeStrength' && <AnalysisRelativeStrengthTab tsCode={tsCode} />}
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

## 五、各子 Tab 组件详细规格

### 5.1 技术指标子 Tab (`AnalysisTechnicalTab`)

这是最核心也最复杂的子 Tab，包含 20+ 个技术指标的可视化。

#### 5.1.1 数据加载

```typescript
function AnalysisTechnicalTab({ tsCode }: { tsCode: string }) {
  const [period, setPeriod] = useState<'D' | 'W' | 'M'>('D');
  const [days, setDays] = useState(120);
  const [data, setData] = useState<StockTechnicalData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    stockDetailApi.technicalIndicators(tsCode, period, days).then(setData)...
  }, [tsCode, period, days]);

  return (
    <Stack spacing={3}>
      {/* 周期选择器: 日线 | 周线 | 月线 */}
      <PeriodSelector period={period} onChange={setPeriod} />
      <AnalysisTechnicalSignalPanel signals={data?.signals} maStatus={data?.maStatus} />
      <AnalysisTechnicalMaCard data={data} />
      <AnalysisTechnicalIndicatorCard data={data} />
      <AnalysisTechnicalVolumeCard data={data} />
    </Stack>
  );
}
```

#### 5.1.2 信号摘要面板 (`AnalysisTechnicalSignalPanel`)

**布局**：一行水平排列的 Chip / Label 标签

```
[MA 多头排列 ✅] [MACD 金叉 🔴] [KDJ 超买 ⚠️] [RSI 中性 ➖] [BOLL 中轨附近] [WR 中性] [CCI 中性] [DMI 有趋势] [SAR 多头]
```

- 每个 Chip 根据信号类型着色：
  - 看多信号 → `color="error"`（红色，A 股红涨）
  - 看空信号 → `color="success"`（绿色）
  - 中性 → `color="default"`
  - 警告 → `color="warning"`
- 数据来源：`data.signals` + `data.maStatus`

#### 5.1.3 均线系统卡片 (`AnalysisTechnicalMaCard`)

**布局**：上方当前 MA 值表格 + 下方均线趋势图

**MA 值表格**（一行 Grid）：

| MA5 | MA10 | MA20 | MA60 | MA120 | MA250 |
|-----|------|------|------|-------|-------|
| 12.34 | 12.56 | 12.78 | 13.02 | 13.45 | 14.12 |

+ 均线排列状态标签：「多头排列 ✅」或「空头排列 ❌」或「交叉 ⚡」

**均线趋势图**：
- 使用 ApexCharts `line` 图（与行情 Tab K 线图用同一 Chart 组件）
- X 轴：交易日
- 系列：收盘价（粗线）+ MA5 + MA10 + MA20 + MA60 + MA120 + MA250（各一条细线，不同颜色）
- Legend 可切换显隐
- 数据来源：`data.history` 中的 `close, ma5, ma10, ma20, ma60, ma120, ma250`

#### 5.1.4 可切换指标图表卡片 (`AnalysisTechnicalIndicatorCard`)

**布局**：指标选择器 (Tabs 或 Select) + 对应图表

**指标选择器**：使用 `<ToggleButtonGroup>` 或 `<Tabs>` 实现，分为两行：

```
经典指标：[MACD] [KDJ] [RSI] [BOLL] [WR] [CCI] [DMI]
扩展指标：[TRIX] [DMA] [BIAS] [OBV] [VR] [EMV] [ROC] [PSY] [BR/AR] [CR] [SAR]
```

**各指标图表规格**：

| 指标 | 图表类型 | 系列 | 参考线 | Y 轴 |
|------|---------|------|--------|------|
| **MACD** | 混合（bar + line） | DIF 线 + DEA 线 + HIST 柱（红绿柱） | 零轴 | 单 Y 轴 |
| **KDJ** | line（3 系列） | K 线 + D 线 + J 线 | 20/80 水平线 | 0-100 |
| **RSI** | line（3 系列） | RSI6 + RSI12 + RSI24 | 20/30/70/80 水平线 | 0-100 |
| **BOLL** | line（4 系列） + area | 收盘价 + 上轨 + 中轨 + 下轨，上下轨间半透明填充 | 无 | 价格轴 |
| **WR** | line（2 系列） | WR6 + WR10 | -20/-80 水平线 | -100 ~ 0 |
| **CCI** | line（1 系列） | CCI | +100/-100 水平线 | 自适应 |
| **DMI** | line（4 系列） | +DI + -DI + ADX + ADXR | 25 水平线 | 0-100 |
| **TRIX** | line（2 系列） | TRIX + MATRIX | 零轴 | 自适应 |
| **DMA** | line（2 系列） | DMA + AMA | 零轴 | 自适应 |
| **BIAS** | line（3 系列） | BIAS6 + BIAS12 + BIAS24 | 零轴 | 自适应 |
| **OBV** | 混合（line + line） | OBV + OBVMA | 无 | 自适应 |
| **VR** | line（1 系列） | VR | 70/150/450 水平线 | 自适应 |
| **EMV** | line（2 系列） | EMV + EMVMA | 零轴 | 自适应 |
| **ROC** | line（2 系列） | ROC + ROCMA | 零轴 | 自适应 |
| **PSY** | line（2 系列） | PSY + PSYMA | 25/75 水平线 | 0-100 |
| **BR/AR** | line（2 系列） | BR + AR | 50/150/300 水平线 | 自适应 |
| **CR** | line（1 系列） | CR | 40/200 水平线 | 自适应 |
| **SAR** | scatter + line | SAR 圆点 + 收盘价线 | 无 | 价格轴 |

**MACD 图表详细规格**（最常用，作为示例）：

```typescript
// 系列定义
const series = [
  {
    name: 'HIST',
    type: 'bar',
    data: history.map(d => ({
      x: d.tradeDate,
      y: d.macdHist,
      fillColor: (d.macdHist ?? 0) >= 0 ? '#EF5350' : '#26A69A',
    })),
  },
  { name: 'DIF', type: 'line', data: history.map(d => ({ x: d.tradeDate, y: d.macdDif })) },
  { name: 'DEA', type: 'line', data: history.map(d => ({ x: d.tradeDate, y: d.macdDea })) },
];

// chart option
const options = useChart({
  chart: { type: 'bar' },
  stroke: { width: [0, 2, 2] },
  colors: ['transparent', '#1877F2', '#FF9800'],
  yaxis: { labels: { formatter: (v) => v.toFixed(3) } },
  annotations: { yaxis: [{ y: 0, borderColor: '#999', strokeDashArray: 3 }] },
});
```

#### 5.1.5 量价分析卡片 (`AnalysisTechnicalVolumeCard`)

**布局**：成交量柱状图（带 5/10/20 日均量线）+ 量比趋势线

- 柱状图颜色：涨日红色，跌日绿色
- 数据来源：`data.history` 中的 `vol, volMa5, volMa10, volMa20, volumeRatio`
- 均量线使用 line 叠加

---

### 5.2 择时信号子 Tab (`AnalysisTimingTab`)

#### 5.2.1 择时评分仪表盘 (`AnalysisTimingScoreCard`)

**布局**：左侧仪表盘 + 右侧统计

**仪表盘**：
- 使用 ApexCharts `radialBar` 类型
- 分数 0-100，颜色分段：0-30 绿色(看空), 30-50 浅绿, 50-70 黄色(中性), 70-90 浅红, 90-100 红色(看多)
- 中心显示分数和评级文字

**右侧统计**：
- 看多指标数量（红色 Badge）
- 看空指标数量（绿色 Badge）
- 中性指标数量（灰色 Badge）

#### 5.2.2 多空打分明细表 (`AnalysisTimingDetailsTable`)

**表格结构**：

| 指标 | 信号 | 分数 | 原因 |
|------|------|------|------|
| MA 均线 | 🔴 看多 | 75 | 多头排列，站上年线 |
| MACD | 🔴 看多 | 80 | 金叉，DIF>0 |
| KDJ | 🟢 看空 | 30 | K 值>80，超买 |
| RSI | ➖ 中性 | 50 | RSI14=55，中性区间 |
| ... | ... | ... | ... |

- 信号列使用 Label/Chip 组件着色
- 分数列使用 LinearProgress + 数字

#### 5.2.3 历史信号时间轴 (`AnalysisTimingSignalTimeline`)

**布局**：纵向时间轴列表

```
🔴 2026-03-28 | 买入 ⭐⭐⭐⭐ | MACD 金叉 | 收盘价 12.56
🟢 2026-03-25 | 卖出 ⭐⭐⭐ | KDJ 死叉且超买区 | 收盘价 12.98
⚠️ 2026-03-20 | 警告 ⭐⭐ | 量价背离 | 收盘价 13.12
...
```

- 使用 MUI `Timeline` 组件或自定义列表
- 买入信号红色圆点，卖出信号绿色圆点，警告黄色
- strength 用星号表示

---

### 5.3 筹码分布子 Tab (`AnalysisChipTab`)

#### 5.3.1 筹码分布图 (`AnalysisChipDistributionChart`)

**布局**：横向柱状图（最关键的可视化）

- Y 轴：价格区间（从低到高）
- X 轴：筹码占比 (%)
- 柱状颜色：当前价格以下（获利盘）→ 红色；当前价格以上（套牢盘）→ 蓝/绿色
- 当前价格用一条水平虚线标注
- 关键价位（主力成本、阻力区、支撑区）用半透明色块标注

```typescript
// ApexCharts 横向 bar
const options = useChart({
  chart: { type: 'bar' },
  plotOptions: { bar: { horizontal: true, barHeight: '80%' } },
  xaxis: { title: { text: '筹码占比 (%)' } },
  yaxis: {
    title: { text: '价格 (元)' },
    categories: bins.map(b => `${b.priceLow.toFixed(2)}-${b.priceHigh.toFixed(2)}`),
  },
  colors: bins.map(b => b.isProfit ? '#EF5350' : '#42A5F5'),
  annotations: {
    yaxis: [{ y: currentPriceIndex, borderColor: '#333', strokeDashArray: 4, label: { text: `当前价 ${currentPrice}` } }],
  },
});
```

#### 5.3.2 筹码摘要卡 (`AnalysisChipSummaryCard`)

**布局**：Grid 排列的 StatItem

| 获利比例 | 平均成本 | 70%集中区 | 90%集中区 | 集中度评分 | 主力成本 |
|---------|---------|----------|----------|-----------|---------|
| 65.3% | ¥12.45 | ¥11.80-13.10 | ¥10.50-14.20 | 72/100 | ¥12.20 |

- 如果数据是估算的 (`isEstimated: true`)，显示提示："⚠️ 数据为估算值，仅供参考"

---

### 5.4 融资融券子 Tab (`AnalysisMarginTab`)

**如果数据不可用** (`available: false`)，显示全 Tab 提示：
```
该股票暂无融资融券数据（可能未纳入两融标的或数据未同步）
```

#### 5.4.1 融资融券摘要卡 (`AnalysisMarginSummaryCard`)

**布局**：类似行情 Tab Header 中的 StatItem 网格

| 融资余额 | 融券余额 | 两融余额 | 5日融资净买入 | 20日融资净买入 | 5日变化率 | 20日变化率 | 趋势 |
|---------|---------|---------|------------|------------|---------|-----------|------|
| 15.2亿 | 0.8亿 | 16.0亿 | +2300万 | +1.2亿 | +1.5% | +8.2% | 📈 增长 |

- 趋势标签着色：increasing → 红色, decreasing → 绿色, stable → 灰色

#### 5.4.2 融资余额趋势图 (`AnalysisMarginChart`)

**图表 1 — 融资余额趋势**：
- 双 Y 轴：左轴 → 融资余额（area + line），右轴 → 收盘价（line）
- X 轴：交易日

**图表 2 — 融资净买入柱状图**：
- 柱状图：每日融资净买入额（正红负绿）
- 可叠加 5 日均线

**图表 3 — 融券余额趋势**：
- 单 Y 轴 line：融券余额趋势

---

### 5.5 相对强弱子 Tab (`AnalysisRelativeStrengthTab`)

#### 5.5.1 基准选择器

顶部 `<ToggleButtonGroup>` 选择对比基准指数：
- 沪深300 (000300.SH)
- 上证指数 (000001.SH)
- 深证成指 (399001.SZ)
- 创业板指 (399006.SZ)

默认选中沪深300。

#### 5.5.2 风险收益摘要卡 (`AnalysisRelativeStrengthSummaryCard`)

| 区间涨跌幅 | 基准涨跌幅 | 超额收益 | 20日超额 | 年化波动率 | 最大回撤 | Beta | 信息比率 |
|-----------|-----------|---------|---------|-----------|---------|------|---------|
| +12.5% | +8.2% | +4.3% | +1.8% | 28.5% | -15.2% | 1.12 | 0.85 |

- 正值红色，负值绿色
- Beta > 1 标注"高于大盘波动"

#### 5.5.3 累计收益对比图 (`AnalysisRelativeStrengthChart`)

**图表 1 — 双线对比**：
- 两条折线：个股累计收益率 (%) + 基准指数累计收益率 (%)
- Legend 显示股票名称和指数名称
- X 轴：交易日
- Y 轴：累计涨跌幅 (%)

**图表 2 — 超额收益趋势**：
- 单条折线 + area 填充
- 正值红色半透明填充，负值绿色半透明填充
- 零轴参考线

---

## 六、图表库使用约定

### 6.1 统一使用项目已有的 ApexCharts 封装

项目已有 `src/components/chart` 封装了 ApexCharts，行情 Tab 已在使用。**统一使用 `Chart` + `useChart`**：

```typescript
import { Chart, useChart } from 'src/components/chart';

const chartOptions = useChart({
  chart: { type: 'line' },
  // ... options
});

<Chart type="line" series={series} options={chartOptions} height={300} />
```

### 6.2 图表主题配色

遵循行情 Tab 已有风格：
- 上涨/正值/买入：`#EF5350`（红色，A 股红涨）
- 下跌/负值/卖出：`#26A69A`（绿色）
- 主线：`#1877F2`（蓝色）
- 辅助线：`#FF9800`（橙色）、`#AB47BC`（紫色）、`#66BB6A`（浅绿）
- 参考线：`#999999`，虚线

### 6.3 响应式

- 图表高度固定（推荐 300px），宽度自适应
- 卡片内左右布局在移动端改为上下
- 使用 MUI responsive `sx` 属性

---

## 七、Loading / Error / Empty 状态

### 7.1 加载骨架

每个子 Tab 使用与其他 Tab 一致的 Skeleton 风格：

```typescript
<Stack spacing={2}>
  <Skeleton variant="rectangular" height={60} sx={{ borderRadius: 1.5 }} />
  {[...Array(3)].map((_, i) => (
    <Skeleton key={i} variant="rectangular" height={300} sx={{ borderRadius: 1.5 }} />
  ))}
</Stack>
```

### 7.2 错误状态

```typescript
<Alert severity="error">{error}</Alert>
```

### 7.3 数据不可用

- 融资融券 `available: false` → 全 Tab 提示
- 筹码分布 `isEstimated: true` → 顶部提示条
- 其他子 Tab 如果 `history.length === 0` → "暂无数据"

---

## 八、实现顺序建议

| 步骤 | 内容 | 依赖 |
|------|------|------|
| 1 | 在 `src/api/stock.ts` 中新增类型定义和 API 方法 | 无 |
| 2 | 改造 `stock-detail-analysis-tab.tsx` 为 Sub-Tab 主容器 | 步骤 1 |
| 3 | 修改 `stock-detail-view.tsx` 传递 `tsCode` | 步骤 2 |
| 4 | 实现技术指标子 Tab — 信号摘要面板 | 步骤 2 |
| 5 | 实现技术指标子 Tab — 均线系统卡片（含图表） | 步骤 2 |
| 6 | 实现技术指标子 Tab — 可切换指标图表卡片（MACD/KDJ/RSI/BOLL 优先） | 步骤 2 |
| 7 | 实现技术指标子 Tab — 扩展指标（WR/CCI/DMI/TRIX/DMA/BIAS/OBV/VR/EMV/ROC/PSY/BR-AR/CR/SAR） | 步骤 6 |
| 8 | 实现技术指标子 Tab — 量价分析卡片 | 步骤 2 |
| 9 | 实现择时信号子 Tab（评分仪表盘 + 明细表 + 时间轴） | 步骤 2 |
| 10 | 实现筹码分布子 Tab（横向柱状图 + 摘要） | 步骤 2 |
| 11 | 实现融资融券子 Tab（摘要 + 趋势图） | 步骤 2 |
| 12 | 实现相对强弱子 Tab（基准选择 + 对比图） | 步骤 2 |
| 13 | 联调 + 响应式优化 + 空数据处理 | 后端接口就绪 |

---

## 九、注意事项

1. **所有卡片都包裹在 MUI `<Card><CardContent>` 中**，保持和其他 Tab 一致的视觉风格。
2. **数字格式化**：复用 `src/utils/format-number.ts` 中已有的 `fNumber`、`fPercent`、`fPctChg`、`fWanYuan` 等。金额统一万元/亿元自动切换。
3. **日期格式化**：复用 `src/utils/format-time.ts`。tradeDate 为 YYYYMMDD 格式，需转为 YYYY-MM-DD 显示。
4. **颜色语义**：涨/正/买入→红色(error)，跌/负/卖出→绿色(success)，符合 A 股用户习惯。
5. **使用项目已有的 ApexCharts 封装** (`Chart` + `useChart`)，不要引入 echarts 或其他图表库。
6. **组件导出**：使用命名导出（`export function AnalysisXxxCard`），不用默认导出。
7. **技术指标图表需要支持缩放**：使用 ApexCharts 的 `dataZoom` 或 `selection` 功能，用户可以拖拽查看不同时间段。
8. **指标切换应该是即时的**：所有指标数据在一次 API 请求中返回（`/technical` 接口），前端只做渲染切换，不需要重新请求。
