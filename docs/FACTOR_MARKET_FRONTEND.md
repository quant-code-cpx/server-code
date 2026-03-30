# 因子市场 — 前端实现规划

> **目标读者**：AI 代码生成器。本文档是一份结构化的前端实现规范，按照本文档的指令可以逐步完成因子市场前端的全部功能。
> **配套后端文档**：`docs/FACTOR_MARKET_BACKEND.md`（位于 server-code 仓库）

---

## 一、技术栈约束（必须严格遵守）

本项目的实际技术栈如下，所有实现必须遵守，**禁止引入任何新的第三方库**：

| 层级 | 技术 | 版本 |
|------|------|------|
| **框架** | React | 19.1.0 |
| **类型** | TypeScript | 5.8.2 |
| **构建** | Vite | 6.2.5 |
| **路由** | React Router DOM | v7.4.1 |
| **UI 组件** | Material-UI (MUI) | v7.0.1 |
| **样式** | Emotion (CSS-in-JS) + MUI System `sx` prop | — |
| **图表** | ApexCharts v4.5.0 (react-apexcharts v1.7.0) | — |
| **状态管理** | React Context + useReducer（内置，无 Zustand/Redux） | — |
| **HTTP 客户端** | 自定义 fetch 封装 `apiClient`（无 Axios/TanStack Query） | — |
| **图标** | @iconify/react | v5.2.1 |
| **日期工具** | dayjs | v1.11.13 |
| **实时推送** | socket.io-client | v4.8.3 |

**关键约定**：
- 不使用 Tailwind CSS、不使用 CSS Modules、不使用 Ant Design
- 所有 HTTP 请求通过 `src/api/client.ts` 的 `apiClient.post()` / `apiClient.get()` 发起
- 所有图表使用 `src/components/chart` 中的 `Chart` 组件 + `useChart` hook
- 样式只能用 MUI 的 `sx` prop 或 `styled()` from `@emotion/styled` 或 MUI 组件属性

---

## 二、项目目录规范

遵循项目现有的分层架构，新增因子市场功能必须按照以下结构创建文件：

```
src/
├── pages/                         # 页面入口（薄包装层，只负责 <title>）
│   ├── factor-library.tsx         # 因子库页面
│   ├── factor-detail.tsx          # 因子详情页面
│   ├── factor-correlation.tsx     # 因子相关性页面
│   └── factor-screening.tsx       # 因子选股页面
│
├── api/
│   └── factor.ts                  # 因子市场所有 API 调用
│
├── sections/
│   └── factor/                    # 因子市场所有 UI 组件
│       ├── view/                  # 页面级视图组件（被 pages/ 引用）
│       │   ├── factor-library-view.tsx
│       │   ├── factor-detail-view.tsx
│       │   ├── factor-correlation-view.tsx
│       │   └── factor-screening-view.tsx
│       ├── factor-library-card.tsx
│       ├── factor-library-category-tabs.tsx
│       ├── factor-detail-params-panel.tsx
│       ├── factor-detail-ic-chart.tsx
│       ├── factor-detail-quantile-chart.tsx
│       ├── factor-detail-distribution-chart.tsx
│       ├── factor-detail-decay-chart.tsx
│       ├── factor-detail-cross-section-table.tsx
│       ├── factor-correlation-heatmap.tsx
│       ├── factor-screening-condition-row.tsx
│       ├── factor-screening-conditions.tsx
│       └── factor-screening-table.tsx
│
└── routes/
    └── sections.tsx               # 在此处添加因子市场路由
```

---

## 三、路由配置（sections.tsx 更新）

在 `src/routes/sections.tsx` 的现有 dashboard 子路由中追加：

```typescript
// 懒加载页面组件（与现有风格一致）
const FactorLibraryPage = lazy(() => import('src/pages/factor-library'));
const FactorDetailPage = lazy(() => import('src/pages/factor-detail'));
const FactorCorrelationPage = lazy(() => import('src/pages/factor-correlation'));
const FactorScreeningPage = lazy(() => import('src/pages/factor-screening'));

// 在 dashboard 子路由数组中追加：
{ path: 'factor/library', element: <FactorLibraryPage /> },
{ path: 'factor/detail/:name', element: <FactorDetailPage /> },
{ path: 'factor/correlation', element: <FactorCorrelationPage /> },
{ path: 'factor/screening', element: <FactorScreeningPage /> },
```

---

## 四、API 层（`src/api/factor.ts`）

完整创建以下文件，严格遵守项目现有 API 写法（参考 `src/api/stock.ts`）：

```typescript
// src/api/factor.ts

import { apiClient } from './client';

// ─── 枚举类型 ────────────────────────────────────────────────────

export type FactorCategory =
  | 'VALUATION'
  | 'SIZE'
  | 'MOMENTUM'
  | 'VOLATILITY'
  | 'LIQUIDITY'
  | 'QUALITY'
  | 'GROWTH'
  | 'CAPITAL_FLOW'
  | 'LEVERAGE'
  | 'DIVIDEND'
  | 'TECHNICAL'
  | 'CUSTOM';

export type FactorSourceType = 'FIELD_REF' | 'DERIVED' | 'CUSTOM_SQL';

// ─── 因子库类型 ────────────────────────────────────────────────

export type FactorDef = {
  id: string;
  name: string;           // 英文标识，如 "pe_ttm"
  label: string;          // 中文名，如 "市盈率TTM"
  description?: string;
  category: FactorCategory;
  sourceType: FactorSourceType;
  isBuiltin: boolean;
};

export type FactorCategoryGroup = {
  category: FactorCategory;
  label: string;
  factors: FactorDef[];
};

export type FactorLibraryResult = {
  categories: FactorCategoryGroup[];
};

// ─── 因子截面值类型 ────────────────────────────────────────────

export type FactorValueItem = {
  tsCode: string;
  name: string;
  industry: string;
  value: number | null;
  percentile: number | null;
};

export type FactorValuesSummary = {
  count: number;
  missing: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  q25: number;
  q75: number;
};

export type FactorValuesResult = {
  factorName: string;
  tradeDate: string;
  universe?: string;
  total: number;
  page: number;
  pageSize: number;
  items: FactorValueItem[];
  summary: FactorValuesSummary;
};

// ─── IC 分析类型 ────────────────────────────────────────────────

export type IcSeriesItem = {
  tradeDate: string;
  ic: number;
  stockCount: number;
};

export type IcSummary = {
  icMean: number;
  icStd: number;
  icIr: number;
  icPositiveRate: number;
  icAboveThreshold: number;
  tStat: number;
};

export type FactorIcResult = {
  factorName: string;
  forwardDays: number;
  icMethod: 'rank' | 'normal';
  startDate: string;
  endDate: string;
  summary: IcSummary;
  series: IcSeriesItem[];
};

// ─── 分层回测类型 ────────────────────────────────────────────────

export type QuantileGroupItem = {
  tradeDate: string;
  cumReturn: number;
};

export type QuantileGroup = {
  group: string;
  label: string;
  totalReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  series: QuantileGroupItem[];
};

export type FactorQuantileResult = {
  factorName: string;
  quantiles: number;
  rebalanceDays: number;
  startDate: string;
  endDate: string;
  groups: QuantileGroup[];
  longShort: Omit<QuantileGroup, 'group' | 'label'> & { series: QuantileGroupItem[] };
  benchmark: { totalReturn: number; series: QuantileGroupItem[] };
};

// ─── 因子衰减类型 ────────────────────────────────────────────────

export type DecayPeriodResult = {
  period: number;
  icMean: number;
  icIr: number;
  icPositiveRate: number;
};

export type FactorDecayResult = {
  factorName: string;
  results: DecayPeriodResult[];
};

// ─── 因子分布类型 ────────────────────────────────────────────────

export type DistributionStats = {
  count: number;
  missing: number;
  missingRate: number;
  mean: number;
  median: number;
  stdDev: number;
  skewness: number;
  kurtosis: number;
  min: number;
  max: number;
  q5: number;
  q25: number;
  q75: number;
  q95: number;
};

export type HistogramBin = {
  binStart: number;
  binEnd: number;
  count: number;
};

export type FactorDistributionResult = {
  factorName: string;
  tradeDate: string;
  stats: DistributionStats;
  histogram: HistogramBin[];
};

// ─── 因子相关性类型 ────────────────────────────────────────────────

export type FactorCorrelationResult = {
  tradeDate: string;
  method: 'spearman' | 'pearson';
  factors: string[];
  factorLabels: string[];
  matrix: number[][];
};

// ─── 选股类型 ────────────────────────────────────────────────────

export type FactorConditionOperator =
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'top_pct' | 'bottom_pct';

export type FactorCondition = {
  factorName: string;
  operator: FactorConditionOperator;
  value?: number;
  min?: number;
  max?: number;
  percent?: number;
};

export type ScreeningItem = {
  tsCode: string;
  name: string;
  industry: string;
  factors: Record<string, number | null>;
};

export type FactorScreeningResult = {
  tradeDate: string;
  universe?: string;
  total: number;
  page: number;
  pageSize: number;
  items: ScreeningItem[];
};

// ─── API 方法定义 ────────────────────────────────────────────────

export const factorApi = {
  /** 获取因子库（按分类分组） */
  library: (params: { enabledOnly?: boolean } = {}): Promise<FactorLibraryResult> =>
    apiClient.post('/api/factor/library', params),

  /** 获取单个因子详情 */
  detail: (factorName: string): Promise<FactorDef & { stats?: FactorValuesSummary & { latestDate: string; coverage: number } }> =>
    apiClient.post('/api/factor/detail', { factorName }),

  /** 获取因子截面值（带分页） */
  values: (params: {
    factorName: string;
    tradeDate: string;
    universe?: string;
    page?: number;
    pageSize?: number;
    sortOrder?: 'asc' | 'desc';
  }): Promise<FactorValuesResult> =>
    apiClient.post('/api/factor/values', params),

  /** IC 分析 */
  ic: (params: {
    factorName: string;
    startDate: string;
    endDate: string;
    universe?: string;
    forwardDays?: number;
    icMethod?: 'rank' | 'normal';
  }): Promise<FactorIcResult> =>
    apiClient.post('/api/factor/analysis/ic', params),

  /** 分层回测 */
  quantile: (params: {
    factorName: string;
    startDate: string;
    endDate: string;
    universe?: string;
    quantiles?: number;
    rebalanceDays?: number;
  }): Promise<FactorQuantileResult> =>
    apiClient.post('/api/factor/analysis/quantile', params),

  /** 因子衰减分析 */
  decay: (params: {
    factorName: string;
    startDate: string;
    endDate: string;
    universe?: string;
    periods?: number[];
  }): Promise<FactorDecayResult> =>
    apiClient.post('/api/factor/analysis/decay', params),

  /** 因子分布统计 */
  distribution: (params: {
    factorName: string;
    tradeDate: string;
    universe?: string;
    bins?: number;
  }): Promise<FactorDistributionResult> =>
    apiClient.post('/api/factor/analysis/distribution', params),

  /** 多因子相关性矩阵 */
  correlation: (params: {
    factorNames: string[];
    tradeDate: string;
    universe?: string;
    method?: 'spearman' | 'pearson';
  }): Promise<FactorCorrelationResult> =>
    apiClient.post('/api/factor/analysis/correlation', params),

  /** 多因子选股 */
  screening: (params: {
    conditions: FactorCondition[];
    tradeDate: string;
    universe?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
  }): Promise<FactorScreeningResult> =>
    apiClient.post('/api/factor/screening', params),
};
```

---

## 五、页面入口文件（src/pages/）

每个页面文件遵循与现有页面相同的薄包装模式：

```typescript
// src/pages/factor-library.tsx
import { CONFIG } from 'src/config-global';
import { FactorLibraryView } from 'src/sections/factor/view';

export default function Page() {
  return (
    <>
      <title>{`因子库 - ${CONFIG.appName}`}</title>
      <FactorLibraryView />
    </>
  );
}
```

其他三个页面（`factor-detail.tsx` / `factor-correlation.tsx` / `factor-screening.tsx`）结构完全相同，替换对应的 View 组件和 title 即可。

---

## 六、页面 1：因子库视图（FactorLibraryView）

### 6.1 文件：`src/sections/factor/view/factor-library-view.tsx`

**功能**：加载因子库数据，渲染分类标签栏 + 因子卡片网格。

**实现要点**：
- 组件挂载时调用 `factorApi.library()` 获取数据，存入 `useState`
- 搜索和分类筛选都在前端本地过滤（因子总数约 30~50，无需后端搜索）
- `isLoading` 时显示 MUI `Skeleton` 骨架屏（参考现有页面风格）

```typescript
// 关键 state
const [library, setLibrary] = useState<FactorLibraryResult | null>(null);
const [loading, setLoading] = useState(true);
const [activeCategory, setActiveCategory] = useState<FactorCategory | 'ALL'>('ALL');
const [searchText, setSearchText] = useState('');

// 派生：过滤后的因子列表
const filteredFactors = useMemo(() => {
  let factors = library?.categories.flatMap(c => c.factors) ?? [];
  if (activeCategory !== 'ALL') factors = factors.filter(f => f.category === activeCategory);
  if (searchText) factors = factors.filter(f =>
    f.name.includes(searchText.toLowerCase()) || f.label.includes(searchText)
  );
  return factors;
}, [library, activeCategory, searchText]);
```

**布局**（使用 MUI）：

```
Box (padding: 3)
├── Stack (direction="row", justifyContent="space-between", mb: 3)
│   ├── Typography variant="h4": "因子库"
│   └── TextField size="small" placeholder="搜索因子名称..." (搜索框)
├── FactorLibraryCategoryTabs (分类标签栏)
└── Grid container spacing={3}  (因子卡片网格)
    └── Grid item xs={12} sm={6} md={4} lg={3}
        └── FactorLibraryCard (每张卡片)
```

### 6.2 文件：`src/sections/factor/factor-library-category-tabs.tsx`

使用 MUI `Tabs` + `Tab` 组件：

```typescript
const CATEGORY_LABELS: Record<FactorCategory | 'ALL', string> = {
  ALL: '全部',
  VALUATION: '估值',
  SIZE: '规模',
  MOMENTUM: '动量',
  VOLATILITY: '波动率',
  LIQUIDITY: '流动性',
  QUALITY: '质量',
  GROWTH: '成长',
  CAPITAL_FLOW: '资金流',
  LEVERAGE: '杠杆',
  DIVIDEND: '红利',
  TECHNICAL: '技术',
  CUSTOM: '自定义',
};
```

每个 Tab 的 label 格式：`估值 (6)`（显示该分类因子数量）。

### 6.3 文件：`src/sections/factor/factor-library-card.tsx`

使用 MUI `Card`：

```typescript
type FactorLibraryCardProps = {
  factor: FactorDef;
  onClick: () => void;
};
```

**卡片内容**：
- `Typography variant="caption" color="text.secondary"`: 因子英文名（如 `pe_ttm`）
- `Typography variant="h6"`: 因子中文名（如 `市盈率TTM`）
- `Chip size="small" label={CATEGORY_LABELS[factor.category]}`: 分类标签
- 鼠标悬停使用 MUI `elevation` 变化实现浮起效果

**点击行为**：调用 `useNavigate()` 跳转到 `/factor/detail/pe_ttm`

---

## 七、页面 2：因子详情视图（FactorDetailView）

### 7.1 文件：`src/sections/factor/view/factor-detail-view.tsx`

**全局参数状态**：

```typescript
// 从 URL params 获取因子名
const { name: factorName } = useParams<{ name: string }>();

// 分析参数（控制所有 Tab 的数据请求）
const [params, setParams] = useState({
  startDate: dayjs().subtract(250, 'day').format('YYYYMMDD'),  // 约1自然年前
  endDate: dayjs().format('YYYYMMDD'),
  universe: undefined as string | undefined,
});

// 当前激活的 Tab
const [activeTab, setActiveTab] = useState(0);
```

**布局**：

```
Box
├── Stack (因子基础信息 + 返回按钮)
│   ├── Button startIcon={<Iconify icon="eva:arrow-back-fill" />} onClick={() => navigate(-1)}
│   ├── Typography variant="h4": factor.label
│   └── Chip label={CATEGORY_LABELS[factor.category]}
├── Typography variant="body2" color="text.secondary": factor.description
├── FactorDetailParamsPanel (全局参数面板)
└── Tabs + TabPanels
    ├── Tab 0: IC 分析 → <FactorDetailIcChart params={params} factorName={factorName} />
    ├── Tab 1: 分层回测 → <FactorDetailQuantileChart params={params} factorName={factorName} />
    ├── Tab 2: 因子分布 → <FactorDetailDistributionChart params={params} factorName={factorName} />
    ├── Tab 3: 因子衰减 → <FactorDetailDecayChart params={params} factorName={factorName} />
    └── Tab 4: 截面排名 → <FactorDetailCrossSectionTable params={params} factorName={factorName} />
```

### 7.2 文件：`src/sections/factor/factor-detail-params-panel.tsx`

**参数面板组件**，使用 MUI `Card` + `Stack`:

```typescript
type ParamsPanelProps = {
  value: { startDate: string; endDate: string; universe?: string };
  onChange: (value: ParamsPanelProps['value']) => void;
  onAnalyze: () => void;  // 点击"开始分析"按钮触发
};
```

**控件**：
- 起始/结束日期：MUI `TextField` type="date"，用 `inputProps.max` / `min` 限制范围，dayjs 转换格式
- 股票池：MUI `Select` 组件，选项如下：

```typescript
const UNIVERSE_OPTIONS = [
  { label: '全市场', value: '' },
  { label: '沪深300', value: '000300.SH' },
  { label: '中证500', value: '000905.SH' },
  { label: '中证1000', value: '000852.SH' },
  { label: '上证50', value: '000016.SH' },
];
```

- 按钮：MUI `Button variant="contained"` "开始分析"

---

## 八、图表组件实现规范

### 8.1 通用图表写法

所有图表组件必须使用项目现有的 `Chart` 组件 + `useChart` hook：

```typescript
import type { ChartOptions } from 'src/components/chart';
import { Chart, useChart } from 'src/components/chart';
import { useTheme } from '@mui/material/styles';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
```

### 8.2 IC 分析图（`factor-detail-ic-chart.tsx`）

**图表 A：IC 时序柱状图（带 MA 折线）**

```typescript
// ApexCharts series 结构
const series = [
  {
    name: 'IC值',
    type: 'bar',
    data: result.series.map(d => ({ x: d.tradeDate, y: d.ic })),
  },
  {
    name: '20日均线',
    type: 'line',
    data: icMa20Series,  // 计算 20 日移动平均
  },
];

// useChart 配置
const chartOptions = useChart({
  chart: { type: 'line', stacked: false },
  stroke: { width: [0, 2], curve: 'smooth', colors: [undefined, theme.palette.warning.main] },
  plotOptions: { bar: { colors: { ranges: [
    { from: -1, to: 0, color: theme.palette.warning.light },
    { from: 0, to: 1, color: theme.palette.primary.light },
  ]}}},
  xaxis: { type: 'category', categories: result.series.map(d => d.tradeDate) },
  yaxis: { labels: { formatter: (v: number) => v.toFixed(3) } },
  annotations: { yaxis: [{ y: 0, borderColor: theme.palette.text.disabled, strokeDashArray: 4 }] },
  dataLabels: { enabled: false },
  legend: { show: true },
  tooltip: {
    shared: true,
    y: { formatter: (v: number) => v.toFixed(4) },
  },
});
```

**统计卡片（顶部一行）**：使用 4 个 MUI `Card` 或 `Paper`，`Grid container spacing={2}` 排列：

| 卡片 | 字段 | 颜色判断 |
|------|------|---------|
| IC 均值 | `summary.icMean` | `icMean < -0.02 \|\| icMean > 0.02` 用 success.main，否则 text.secondary |
| ICIR | `summary.icIr` | `\|icIr\| > 0.5` 用 success.main |
| IC > 0 占比 | `summary.icPositiveRate` | 百分比格式 |
| t 统计量 | `summary.tStat` | `\|tStat\| > 2` 加粗 |

**图表 B：IC 累计曲线**：

```typescript
const cumulativeIc = result.series.reduce<number[]>((acc, d, i) => {
  acc.push((acc[i - 1] ?? 0) + d.ic);
  return acc;
}, []);

// ApexCharts area chart
const areaOptions = useChart({
  chart: { type: 'area' },
  fill: { type: 'gradient', gradient: { opacityFrom: 0.5, opacityTo: 0 } },
  stroke: { width: 2, curve: 'smooth' },
  xaxis: { categories: result.series.map(d => d.tradeDate) },
  dataLabels: { enabled: false },
});
```

### 8.3 分层回测图（`factor-detail-quantile-chart.tsx`）

**统计表格（顶部）**：使用 MUI `Table` 组件展示各组的年化收益/最大回撤/夏普比率。

**累计收益曲线**：

```typescript
const quantileColors = [
  theme.palette.success.dark,
  theme.palette.success.light,
  theme.palette.warning.main,
  theme.palette.error.light,
  theme.palette.error.dark,
];

const series = [
  ...result.groups.map((g, i) => ({
    name: g.label,
    data: g.series.map(d => ({ x: d.tradeDate, y: Number((d.cumReturn * 100).toFixed(2)) })),
  })),
  {
    name: '多空组合',
    data: result.longShort.series.map(d => ({ x: d.tradeDate, y: Number((d.cumReturn * 100).toFixed(2)) })),
  },
  {
    name: '基准',
    data: result.benchmark.series.map(d => ({ x: d.tradeDate, y: Number((d.cumReturn * 100).toFixed(2)) })),
  },
];

const chartOptions = useChart({
  chart: { type: 'line', zoom: { enabled: true } },
  stroke: { width: [...result.groups.map(() => 2), 3, 2], dashArray: [...result.groups.map(() => 0), 0, 4] },
  colors: [...quantileColors.slice(0, result.groups.length), '#111827', theme.palette.text.disabled],
  xaxis: { type: 'category' },
  yaxis: { labels: { formatter: (v: number) => `${v.toFixed(1)}%` } },
  dataLabels: { enabled: false },
  legend: { show: true },
  tooltip: { shared: false, y: { formatter: (v: number) => `${v.toFixed(2)}%` } },
});
```

**各组年化收益柱状图**：

```typescript
const barOptions = useChart({
  chart: { type: 'bar' },
  plotOptions: { bar: {
    colors: { ranges: [
      { from: -100, to: 0, color: theme.palette.error.main },
      { from: 0, to: 100, color: theme.palette.success.main },
    ]},
  }},
  xaxis: { categories: result.groups.map(g => g.group) },
  yaxis: { labels: { formatter: (v: number) => `${v}%` } },
  dataLabels: { enabled: true, formatter: (v: number) => `${v.toFixed(1)}%` },
});
```

### 8.4 因子分布图（`factor-detail-distribution-chart.tsx`）

**直方图**：

```typescript
const series = [{ name: '股票数量', data: result.histogram.map(b => b.count) }];
const categories = result.histogram.map(b => b.binStart.toFixed(1));

const chartOptions = useChart({
  chart: { type: 'bar' },
  plotOptions: { bar: { borderRadius: 0, columnWidth: '99%' } },
  xaxis: { categories, tickAmount: 10, labels: { rotate: -45 } },
  dataLabels: { enabled: false },
  tooltip: {
    custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
      const bin = result.histogram[dataPointIndex];
      return `<div style="padding:8px">${bin.binStart.toFixed(2)} ~ ${bin.binEnd.toFixed(2)}<br>数量: ${bin.count}</div>`;
    },
  },
});
```

**统计卡片**（6 个 MUI `Paper`，`Grid container spacing={2}` 排列）：有效数量、缺失率、均值/中位数、标准差、偏度/峰度、5%~95% 区间。

### 8.5 因子衰减图（`factor-detail-decay-chart.tsx`）

```typescript
// 混合图：柱状图（IC均值）+ 折线图（ICIR）
const series = [
  {
    name: 'IC均值',
    type: 'bar',
    data: result.results.map(r => Number(r.icMean.toFixed(4))),
  },
  {
    name: 'ICIR',
    type: 'line',
    data: result.results.map(r => Number(r.icIr.toFixed(4))),
  },
];

const chartOptions = useChart({
  chart: { type: 'line', stacked: false },
  stroke: { width: [0, 3], curve: 'smooth' },
  plotOptions: { bar: {
    colors: { ranges: [
      { from: -1, to: 0, color: theme.palette.warning.main },
      { from: 0, to: 1, color: theme.palette.primary.main },
    ]},
  }},
  xaxis: { categories: result.results.map(r => `${r.period}日`) },
  yaxis: [
    { title: { text: 'IC均值' }, labels: { formatter: (v: number) => v.toFixed(3) } },
    { opposite: true, title: { text: 'ICIR' }, labels: { formatter: (v: number) => v.toFixed(3) } },
  ],
  dataLabels: {
    enabled: true,
    enabledOnSeries: [0],
    formatter: (v: number) => v.toFixed(3),
  },
  legend: { show: true },
});
```

### 8.6 相关性热力图（`factor-correlation-heatmap.tsx`）

```typescript
const series = result.factors.map((rowFactor, rowIdx) => ({
  name: result.factorLabels[rowIdx],
  data: result.factors.map((colFactor, colIdx) => ({
    x: result.factorLabels[colIdx],
    y: Number(result.matrix[rowIdx][colIdx].toFixed(3)),
  })),
}));

const chartOptions = useChart({
  chart: { type: 'heatmap' },
  dataLabels: { enabled: true, formatter: (v: number) => v.toFixed(2) },
  plotOptions: {
    heatmap: {
      shadeIntensity: 0.9,
      radius: 0,
      useFillColorAsStroke: false,
      colorScale: {
        ranges: [
          { from: -1, to: -0.5, color: '#1e40af', name: '强负相关' },
          { from: -0.5, to: -0.2, color: '#93c5fd', name: '弱负相关' },
          { from: -0.2, to: 0.2, color: '#f9fafb', name: '无相关' },
          { from: 0.2, to: 0.5, color: '#fca5a5', name: '弱正相关' },
          { from: 0.5, to: 1, color: '#dc2626', name: '强正相关' },
        ],
      },
    },
  },
  xaxis: { type: 'category' },
  legend: { show: false },
  tooltip: { y: { formatter: (v: number) => v.toFixed(3) } },
});

// 高度动态计算：factorCount * 40px
// <Chart type="heatmap" series={series} options={chartOptions} sx={{ height: result.factors.length * 40 + 60 }} />
```

---

## 九、页面 3：因子相关性视图（FactorCorrelationView）

### 文件：`src/sections/factor/view/factor-correlation-view.tsx`

**参数状态**：

```typescript
const [selectedFactors, setSelectedFactors] = useState<string[]>(['pe_ttm', 'pb', 'roe', 'ret_20d', 'ln_market_cap']);
const [tradeDate, setTradeDate] = useState(dayjs().format('YYYYMMDD'));
const [universe, setUniverse] = useState('');
const [method, setMethod] = useState<'spearman' | 'pearson'>('spearman');
const [result, setResult] = useState<FactorCorrelationResult | null>(null);
const [loading, setLoading] = useState(false);
```

**因子多选控件**：MUI `Autocomplete` 组件，`multiple` 模式：

```typescript
<Autocomplete
  multiple
  value={selectedFactors}
  onChange={(_, newValue) => setSelectedFactors(newValue as string[])}
  options={allFactorNames}
  getOptionLabel={(name) => `${name} · ${factorLabelMap[name]}`}
  renderInput={(params) => <TextField {...params} label="选择因子（2~20个）" />}
  renderTags={(value, getTagProps) =>
    value.map((name, index) => (
      <Chip label={name} {...getTagProps({ index })} key={name} size="small" />
    ))
  }
  isOptionEqualToValue={(a, b) => a === b}
  limitTags={8}
/>
```

**布局**：

```
Box
├── Card (参数面板)
│   ├── Autocomplete (因子多选)
│   ├── Stack direction="row"
│   │   ├── TextField type="date" (分析日期)
│   │   ├── Select (股票池)
│   │   ├── Select (方法: Spearman/Pearson)
│   │   └── Button "计算相关性"
│   └── loading ? LinearProgress : null
└── result ? FactorCorrelationHeatmap : EmptyState
```

---

## 十、页面 4：因子选股视图（FactorScreeningView）

### 文件：`src/sections/factor/view/factor-screening-view.tsx`

**状态**：

```typescript
const [conditions, setConditions] = useState<FactorCondition[]>([
  { factorName: '', operator: 'gt', value: undefined },
]);
const [tradeDate, setTradeDate] = useState(dayjs().format('YYYYMMDD'));
const [universe, setUniverse] = useState('');
const [sortBy, setSortBy] = useState('');
const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
const [result, setResult] = useState<FactorScreeningResult | null>(null);
const [page, setPage] = useState(1);
const [loading, setLoading] = useState(false);
```

### 文件：`src/sections/factor/factor-screening-conditions.tsx`

**条件构建器**，每行一个条件（`FactorScreeningConditionRow`）：

```typescript
// 每行条件的控件：
// 1. 因子选择（Select，数据源来自因子库）
// 2. 运算符（Select）
// 3. 值输入（根据运算符动态切换）：
//    - gt/gte/lt/lte/top_pct/bottom_pct → 单个 TextField type="number"
//    - between → 两个 TextField（min / max）
// 4. 删除按钮（IconButton with Iconify "eva:trash-2-outline")
```

**运算符选项**：

```typescript
const OPERATOR_OPTIONS = [
  { value: 'gt',         label: '大于 >' },
  { value: 'gte',        label: '大于等于 >=' },
  { value: 'lt',         label: '小于 <' },
  { value: 'lte',        label: '小于等于 <=' },
  { value: 'between',    label: '介于' },
  { value: 'top_pct',   label: '前 N%' },
  { value: 'bottom_pct', label: '后 N%' },
];
```

**底部操作行**：
- "＋ 添加条件" 按钮（最多 10 个）
- "开始选股" 按钮（`variant="contained"`）

### 文件：`src/sections/factor/factor-screening-table.tsx`

**结果表格**（MUI `Table` + `TablePagination`）：

```typescript
// 动态列：固定列（排名/代码/名称/行业）+ 条件涉及的因子列
const factorColumns = conditions
  .map(c => c.factorName)
  .filter(Boolean)
  .filter((v, i, arr) => arr.indexOf(v) === i);

// 股票代码列：点击跳转到股票详情页
// <TableCell>
//   <Link component={RouterLink} to={`/stock/detail?code=${row.tsCode}`} underline="hover">
//     {row.tsCode}
//   </Link>
// </TableCell>
```

**空状态**：未查询时显示 MUI `Stack` 居中布局 + Iconify 图标 + "请添加筛选条件后点击选股" 提示文字。

---

## 十一、截面排名表格（FactorDetailCrossSectionTable）

### 文件：`src/sections/factor/factor-detail-cross-section-table.tsx`

**子参数控件**（位于组件内部顶部）：
- `tradeDate`: TextField type="date"
- `sortOrder`: ButtonGroup "降序" / "升序"

**表格列**：

| 列 | 内容 | 备注 |
|----|------|------|
| 排名 | 序号 | — |
| 股票代码 | Link 跳转 `/stock/detail?code=...` | MUI RouterLink |
| 股票名称 | string | — |
| 所属行业 | string | — |
| 因子值 | number (toFixed(4)) | — |
| 百分位排名 | LinearProgress + 百分比文字 | `variant="determinate" value={percentile * 100}` |

**分页**：`TablePagination`，pageSize 固定 50。

---

## 十二、实现优先级

与后端 Phase 对齐，分 3 个阶段交付：

### Phase 1：因子库 + 截面排名

1. 创建 `src/api/factor.ts`（完整 API 层）
2. 更新 `src/routes/sections.tsx` 添加路由
3. 创建 4 个页面入口文件（`src/pages/factor-*.tsx`）
4. 实现 `FactorLibraryView`（分类标签栏 + 因子卡片网格）
5. 实现 `FactorDetailView` 骨架（参数面板 + Tab 容器）
6. 实现 `FactorDetailCrossSectionTable`（截面排名表格）

### Phase 2：因子分析图表

7. 实现 `FactorDetailIcChart`（IC 时序柱状图 + 累计曲线）
8. 实现 `FactorDetailQuantileChart`（分层累计收益曲线 + 年化收益柱状图）
9. 实现 `FactorDetailDistributionChart`（直方图 + 统计卡片）
10. 实现 `FactorDetailDecayChart`（衰减混合图）
11. 实现 `FactorCorrelationView` + `FactorCorrelationHeatmap`

### Phase 3：因子选股

12. 实现 `FactorScreeningView`（条件构建器 + 选股结果表格）
13. 交互打磨（Loading 状态、错误边界、空状态、分页）

---

## 十三、注意事项

1. **导航菜单**：在 `src/layouts/` 的 dashboard 侧边栏中添加"因子市场"导航组，下挂 4 个子页面的链接（使用 Iconify 图标 `solar:chart-bold` 或类似）
2. **Loading 状态**：每个图表数据加载期间，使用 MUI `Skeleton` 作为占位（参考现有 Card + Skeleton 用法）
3. **Error 处理**：API 错误时显示 MUI `Alert severity="error"` 组件
4. **日期格式**：所有日期后端接受 `YYYYMMDD`，前端用 `dayjs().format('YYYYMMDD')` 和 `dayjs(date, 'YYYYMMDD').toDate()` 互转
5. **图表高度**：各图表 `sx={{ height: 360 }}`（参考现有页面默认高度），相关性热力图动态计算
6. **dataZoom**：IC 时序图、分层回测图等时间序列图，在 `useChart` 中可通过 `chart.toolbar.show: true` 和 `chart.zoom.enabled: true` 开启 ApexCharts 内置缩放工具栏
