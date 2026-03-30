# 因子市场 — 前端实现规划

> **目标读者**：AI 代码生成器。本文档是一份结构化的前端实现规范，详细描述页面结构、组件、交互和数据流。
> **配套后端文档**：`docs/FACTOR_MARKET_BACKEND.md`
> **前端技术栈推荐**：React 18 + TypeScript + Ant Design 5 + ECharts 5 + TanStack Query + Zustand（或按项目实际选型调整）
> **路由前缀**：`/factor`

---

## 一、页面总览

因子市场前端共包含 **4 个主页面**，通过侧边栏导航切换：

| 路由 | 页面名称 | 核心功能 |
|------|---------|---------|
| `/factor/library` | 因子库 | 浏览所有因子，按分类查看，进入因子详情 |
| `/factor/:name` | 因子详情 | 单因子全方位分析（IC、分层回测、分布、衰减） |
| `/factor/correlation` | 因子相关性 | 多因子相关性矩阵热力图 |
| `/factor/screening` | 因子选股 | 多因子组合条件筛选股票 |

---

## 二、页面 1：因子库 (`/factor/library`)

### 2.1 页面布局

```
┌─────────────────────────────────────────────────────┐
│ 因子库                                      [搜索框] │
├─────────────────────────────────────────────────────┤
│ [全部] [估值] [规模] [动量] [波动率] [流动性]        │
│ [质量] [成长] [资金流] [杠杆] [红利] [技术]          │
├─────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│ │ PE_TTM  │ │  PB     │ │ PS_TTM  │ │ 股息率   │   │
│ │ 市盈率   │ │ 市净率   │ │ 市销率   │ │ TTM     │   │
│ │ 估值     │ │ 估值     │ │ 估值     │ │ 红利     │   │
│ │ IC:-0.03│ │ IC:-0.02│ │ IC:-0.01│ │ IC:0.02 │   │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│ │ ...     │ │ ...     │ │ ...     │ │ ...     │   │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
└─────────────────────────────────────────────────────┘
```

### 2.2 组件说明

#### 搜索框

- 位置：页面右上角
- 功能：输入因子名称（中/英文）实时过滤当前显示的因子卡片
- 实现：前端本地过滤（因子总数约 30~50 个），不需要后端搜索接口

#### 分类标签栏 (CategoryTabs)

- 水平排列所有因子分类标签
- 点击标签切换显示对应分类的因子
- "全部" 标签显示所有因子
- 当前选中标签高亮
- 每个标签旁显示该分类下的因子数量，例如 `估值 (6)`

#### 因子卡片 (FactorCard)

- 采用卡片网格布局（Grid），每行 4 张卡片，响应式（大屏 4 列 → 中屏 3 列 → 小屏 2 列）
- 每张卡片展示：
  - **因子英文名**：如 `pe_ttm`，字体较小灰色
  - **因子中文名**：如 `市盈率TTM`，主标题
  - **分类标签**：小标签显示所属分类
  - **IC 指标**（可选）：显示最近一段时间的平均 IC 值，用颜色标记（绿色=有效正向，红色=有效反向，灰色=无效）
- 点击卡片 → 跳转到因子详情页 `/factor/:name`
- 鼠标悬停 → 卡片轻微上浮 + 阴影加深

### 2.3 数据获取

```
页面加载 → POST /api/factor/library { enabledOnly: true }
```

- 使用 TanStack Query 缓存，`staleTime: 1h`
- 按 `categories` 数组渲染分类和卡片

---

## 三、页面 2：因子详情 (`/factor/:name`)

这是因子市场最核心的页面，提供单因子的全方位分析。

### 3.1 页面布局

```
┌───────────────────────────────────────────────────────────────┐
│ ← 返回因子库    市盈率TTM (pe_ttm)         因子分类: 估值     │
│ 描述: 过去12个月滚动市盈率，基于最近4个季度归母净利润计算       │
├───────────────────────────────────────────────────────────────┤
│ 全局参数面板                                                   │
│ 分析区间: [20250101] ~ [20260327]    股票池: [沪深300 ▾]      │
│                                             [开始分析]         │
├───────────────────────────────────────────────────────────────┤
│ [IC分析] [分层回测] [因子分布] [因子衰减] [截面排名]           │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│                    当前选中Tab的内容区域                        │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 3.2 全局参数面板 (AnalysisParamPanel)

位于页面顶部，控制下方所有分析 Tab 的公共参数：

| 参数 | 控件 | 默认值 | 说明 |
|------|------|--------|------|
| 分析起始日期 | DatePicker（YYYYMMDD） | 1年前 | 分析区间开始 |
| 分析结束日期 | DatePicker（YYYYMMDD） | 今天 | 分析区间结束 |
| 股票池 | Select 下拉框 | 全市场 | 选项：全市场 / 沪深300 / 中证500 / 中证1000 / 上证50 |
| 开始分析 | 按钮 | — | 点击后触发当前 Tab 的数据请求 |

修改参数后，需要点击"开始分析"按钮才触发请求（因为分析计算耗时较长，避免参数修改时频繁触发）。

### 3.3 Tab 1：IC 分析 (IcAnalysisTab)

#### 子参数

| 参数 | 控件 | 默认值 | 说明 |
|------|------|--------|------|
| 未来收益天数 | Select 或 InputNumber | 5 | 1/3/5/10/20 可选 |
| IC 计算方法 | Radio | Rank IC | Rank IC (Spearman) / Normal IC (Pearson) |

#### 展示内容

**区域 A：IC 统计卡片（顶部一行）**

4 张统计卡片横排：

| 卡片 | 数值 | 样式 |
|------|------|------|
| IC 均值 | `-0.032` | 绿色（负值对估值因子是好的）或红色 |
| ICIR | `-0.552` | 绿色/红色/灰色 |
| IC > 0 占比 | `38.0%` | 百分比 |
| t 统计量 | `-3.42` | 绝对值 > 2 为显著，加粗 |

**区域 B：IC 时序图（主图）**

- 图表类型：**柱状图 + 折线图**组合
- X 轴：交易日期
- Y 轴：IC 值
- 柱状图：每日 IC 值（正值蓝色/负值橙色）
- 折线图：IC 的 20 日移动平均线（平滑趋势）
- 水平参考线：IC = 0（虚线）
- 支持 ECharts `dataZoom` 缩放

**区域 C：IC 累计曲线**

- 图表类型：面积图
- X 轴：交易日期
- Y 轴：IC 累计值（各日 IC 逐日求和）
- 用于直观展示因子的长期稳定性（稳定上升 = 因子有效且稳定）

#### 数据获取

```
POST /api/factor/analysis/ic {
  factorName, startDate, endDate, universe,
  forwardDays, icMethod
}
```

### 3.4 Tab 2：分层回测 (QuantileAnalysisTab)

#### 子参数

| 参数 | 控件 | 默认值 | 说明 |
|------|------|--------|------|
| 分组数 | Select | 5 | 3/5/10 可选 |
| 调仓周期 | Select | 5天 | 1/5/10/20 可选 |

#### 展示内容

**区域 A：各组收益统计表格（顶部）**

Table 组件，列如下：

| 列名 | 说明 |
|------|------|
| 分组 | Q1 ~ Q5（或 Q1 ~ Q10） |
| 标签 | "低PE组" ~ "高PE组" |
| 累计收益 | 百分比格式 |
| 年化收益 | 百分比格式 |
| 最大回撤 | 百分比格式，红色 |
| 夏普比率 | 数值 |

最后一行为**多空组合**（Long-Short）。

**区域 B：分组累计收益曲线（主图）**

- 图表类型：多条**折线图**
- X 轴：交易日期
- Y 轴：累计收益率
- 每组一条线，用不同颜色区分（Q1 绿色渐变到 Q5 红色）
- 额外显示一条基准线（灰色虚线）
- 多空组合线（黑色加粗）

**区域 C：各组收益柱状图**

- 图表类型：柱状图
- X 轴：分组 Q1~Q5
- Y 轴：年化收益率
- 展示因子的单调性（理想情况下 Q1 到 Q5 应单调递增或递减）

#### 数据获取

```
POST /api/factor/analysis/quantile {
  factorName, startDate, endDate, universe,
  quantiles, rebalanceDays
}
```

### 3.5 Tab 3：因子分布 (DistributionTab)

#### 子参数

| 参数 | 控件 | 默认值 | 说明 |
|------|------|--------|------|
| 查看日期 | DatePicker | 最新交易日 | 可选择历史日期 |
| 直方图柱数 | Slider | 50 | 范围 10~100 |

#### 展示内容

**区域 A：分布统计卡片（顶部一行）**

6 张统计卡片横排：

| 卡片 | 值 |
|------|-----|
| 有效数量 | 4856 |
| 缺失率 | 2.9% |
| 均值 / 中位数 | 32.5 / 24.8 |
| 标准差 | 48.3 |
| 偏度 / 峰度 | 4.2 / 28.5 |
| 5%~95% 范围 | [8.2, 85.4] |

**区域 B：直方图（主图）**

- 图表类型：**柱状图**（直方图）
- X 轴：因子值区间
- Y 轴：股票数量
- 在直方图上叠加一条正态分布拟合曲线（用于对比）
- 用颜色渐变（蓝色→绿色→黄色→红色）表示从低到高的因子值

**区域 C：箱线图（辅助图）**

- 图表类型：水平箱线图（Box Plot）
- 展示 min, Q25, median, Q75, max 和异常值
- 用于快速看出因子值的集中度和离群值情况

#### 数据获取

```
POST /api/factor/analysis/distribution {
  factorName, tradeDate, universe, bins
}
```

### 3.6 Tab 4：因子衰减 (DecayAnalysisTab)

#### 展示内容

**唯一图表：衰减柱状图**

- 图表类型：分组柱状图
- X 轴：持有期（1日, 3日, 5日, 10日, 20日）
- Y 轴（左）：IC 均值（柱状图）
- Y 轴（右）：ICIR（折线图叠加）
- 柱状图颜色按 IC 绝对值深浅变化
- 在柱状图上方标注 IC > 0 的占比

用途：帮助用户选择最佳持有/调仓周期。IC 均值绝对值最大的持有期就是最佳调仓频率。

#### 数据获取

```
POST /api/factor/analysis/decay {
  factorName, startDate, endDate, universe,
  periods: [1, 3, 5, 10, 20]
}
```

### 3.7 Tab 5：截面排名 (CrossSectionTab)

#### 子参数

| 参数 | 控件 | 默认值 |
|------|------|--------|
| 查看日期 | DatePicker | 最新交易日 |
| 排序方向 | Radio | 降序 |

#### 展示内容

**表格（主体）**

分页表格，列如下：

| 列名 | 说明 |
|------|------|
| 排名 | 序号 |
| 股票代码 | `600519.SH` |
| 股票名称 | `贵州茅台` |
| 所属行业 | `白酒` |
| 因子值 | 原始值 |
| 百分位排名 | `72%` 表示优于72%的股票 |
| 迷你柱状图 | 百分位的可视化横条 |

- 支持分页（每页 50 条）
- 支持点击股票代码跳转到股票详情页 `/stock/detail/:tsCode`

#### 数据获取

```
POST /api/factor/values {
  factorName, tradeDate, universe, page, pageSize, sortOrder
}
```

---

## 四、页面 3：因子相关性 (`/factor/correlation`)

### 4.1 页面布局

```
┌──────────────────────────────────────────────────────────────┐
│ 因子相关性分析                                                │
├──────────────────────────────────────────────────────────────┤
│ 参数面板                                                      │
│ 选择因子: [pe_ttm ×] [pb ×] [roe ×] [ret_20d ×] [+ 添加]   │
│ 分析日期: [20260327]   股票池: [全市场 ▾]   方法: [Spearman] │
│                                            [计算相关性]       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│              ┌─────────────────────────────┐                 │
│              │                             │                 │
│              │    相关性矩阵热力图          │                 │
│              │    (ECharts Heatmap)        │                 │
│              │                             │                 │
│              └─────────────────────────────┘                 │
│                                                              │
│    ┌───────────────────────────────────┐                     │
│    │      相关性系数数值表格             │                     │
│    └───────────────────────────────────┘                     │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 组件说明

#### 因子选择器 (FactorMultiSelect)

- 类型：多选标签输入框（类似 Ant Design 的 `Select mode="tags"`）
- 数据源：从因子库 API 获取所有因子列表
- 已选因子以标签形式展示，点击 × 移除
- 搜索支持中英文模糊匹配
- 限制最多选择 20 个因子
- 提供快捷选项："全部估值因子"、"全部动量因子" 等按分类批量选择

#### 热力图 (CorrelationHeatmap)

- 图表类型：ECharts Heatmap
- X 轴 / Y 轴：因子中文名
- 色块：相关系数值
- 色标：蓝色（-1 = 强负相关）→ 白色（0 = 不相关）→ 红色（+1 = 强正相关）
- 每个色块中心显示相关系数数值（保留 2 位小数）
- 对角线（自相关 = 1.0）用灰色标记
- 支持鼠标悬停 tooltip 显示详细信息

#### 数值表格 (CorrelationTable)

- 在热力图下方，以 Table 形式展示同样的相关性矩阵数据
- 方便用户复制数据
- 高亮高相关性（|r| > 0.7）的单元格

### 4.3 数据获取

```
POST /api/factor/analysis/correlation {
  factorNames, tradeDate, universe, method
}
```

---

## 五、页面 4：因子选股 (`/factor/screening`)

### 5.1 页面布局

```
┌──────────────────────────────────────────────────────────────┐
│ 因子选股                                                      │
├──────────────────────────────────────────────────────────────┤
│ 筛选条件                                              [选股] │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 条件1: [pe_ttm ▾]  [< ▾]  [20    ]               [×]   │ │
│ │ 条件2: [roe ▾]     [> ▾]  [15    ]               [×]   │ │
│ │ 条件3: [ret_20d ▾] [前N% ▾] [30  ]               [×]   │ │
│ │                                          [+ 添加条件]    │ │
│ └──────────────────────────────────────────────────────────┘ │
│ 选股日期: [20260327]   股票池: [沪深300 ▾]                   │
│ 排序因子: [roe ▾]      排序方向: [降序 ▾]                    │
├──────────────────────────────────────────────────────────────┤
│ 筛选结果: 共 42 只股票符合条件                                │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ # │ 代码      │ 名称   │ 行业 │ PE_TTM │ ROE  │ 20日动量│ │
│ │ 1 │ 600519.SH │ 贵州茅台│ 白酒 │ 18.5   │ 32.1 │ 5.2%   │ │
│ │ 2 │ 000858.SZ │ 五粮液  │ 白酒 │ 16.2   │ 28.3 │ 3.8%   │ │
│ │ ...│          │        │      │        │      │        │ │
│ └──────────────────────────────────────────────────────────┘ │
│                         [1] [2] [3] ... 分页                 │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 组件说明

#### 条件构建器 (ConditionBuilder)

- 每个条件是一行，包含：
  - **因子选择**：下拉框，数据源为因子库
  - **运算符选择**：下拉框，选项包括：
    - `>` (大于)
    - `>=` (大于等于)
    - `<` (小于)
    - `<=` (小于等于)
    - `介于` (between) → 显示两个输入框（min ~ max）
    - `前N%` (top_pct) → 输入百分比
    - `后N%` (bottom_pct) → 输入百分比
  - **值输入**：数值输入框（或两个输入框用于 between）
  - **删除按钮**：× 图标
- 底部有"+ 添加条件"按钮
- 最少 1 个条件，最多 10 个条件
- 所有条件之间为 AND 关系

#### 结果表格 (ScreeningResultTable)

- 列结构：
  - 序号（排名）
  - 股票代码（可点击跳转到 `/stock/detail/:tsCode`）
  - 股票名称
  - 所属行业
  - **用户筛选涉及的所有因子的值**（动态列，根据条件中的因子名自动生成）
- 分页：每页 50 条
- 排序：由上方"排序因子"和"排序方向"控制
- 空状态：显示"请添加筛选条件后点击选股"

#### 导出功能（可选，后续扩展）

- 将筛选结果导出为 CSV 文件
- 将筛选条件保存为"选股方案"

### 5.3 数据获取

```
POST /api/factor/screening {
  conditions: [
    { factorName: "pe_ttm", operator: "lt", value: 20 },
    { factorName: "roe", operator: "gt", value: 15 },
    { factorName: "ret_20d", operator: "top_pct", percent: 30 }
  ],
  tradeDate: "20260327",
  universe: "000300.SH",
  sortBy: "roe",
  sortOrder: "desc",
  page: 1,
  pageSize: 50
}
```

---

## 六、共享组件

以下组件在多个页面复用，建议抽离到 `src/components/factor/` 目录：

### 6.1 UniverseSelector（股票池选择器）

```typescript
interface UniverseSelectorProps {
  value?: string;               // 当前选中的指数代码，undefined = 全市场
  onChange: (val?: string) => void;
}

// 选项列表：
const OPTIONS = [
  { label: '全市场', value: undefined },
  { label: '沪深300', value: '000300.SH' },
  { label: '中证500', value: '000905.SH' },
  { label: '中证1000', value: '000852.SH' },
  { label: '上证50', value: '000016.SH' },
];
```

### 6.2 TradeDatePicker（交易日选择器）

- 基于 Ant Design DatePicker 封装
- 非交易日灰显不可选（需从后端 TradeCal 数据判断）
- 日期格式统一为 `YYYYMMDD` 字符串

### 6.3 FactorSelect（单因子选择器）

```typescript
interface FactorSelectProps {
  value?: string;               // 因子 name
  onChange: (val: string) => void;
  showCategory?: boolean;       // 是否按分类分组显示
}
```

- 下拉框选项从因子库 API 获取并缓存
- 按分类分组（OptGroup）
- 支持搜索过滤

### 6.4 StatCard（统计卡片）

```typescript
interface StatCardProps {
  title: string;                // 标题，如 "IC 均值"
  value: string | number;       // 值
  precision?: number;           // 小数位
  suffix?: string;              // 后缀，如 "%"
  color?: 'green' | 'red' | 'gray' | 'auto';  // auto 表示正绿负红
  description?: string;         // 底部描述
}
```

### 6.5 LoadingOverlay（加载遮罩）

- 分析计算可能需要 5~30 秒
- 在数据加载期间，给图表区域覆盖一个半透明遮罩 + Loading 动画
- 显示"正在计算，请稍候..."提示

---

## 七、API 调用层

建议在 `src/api/factor.ts` 中统一封装所有因子相关 API：

```typescript
// src/api/factor.ts

import { request } from '@/utils/request';

/** 因子库列表 */
export function getFactorLibrary(params: FactorLibraryQuery) {
  return request.post('/factor/library', params);
}

/** 因子详情 */
export function getFactorDetail(factorName: string) {
  return request.post('/factor/detail', { factorName });
}

/** 因子截面值 */
export function getFactorValues(params: FactorValuesQuery) {
  return request.post('/factor/values', params);
}

/** IC 分析 */
export function getFactorIcAnalysis(params: FactorIcAnalysisQuery) {
  return request.post('/factor/analysis/ic', params);
}

/** 分层回测 */
export function getFactorQuantileAnalysis(params: FactorQuantileQuery) {
  return request.post('/factor/analysis/quantile', params);
}

/** 因子衰减 */
export function getFactorDecayAnalysis(params: FactorDecayQuery) {
  return request.post('/factor/analysis/decay', params);
}

/** 因子分布 */
export function getFactorDistribution(params: FactorDistributionQuery) {
  return request.post('/factor/analysis/distribution', params);
}

/** 因子相关性 */
export function getFactorCorrelation(params: FactorCorrelationQuery) {
  return request.post('/factor/analysis/correlation', params);
}

/** 因子选股 */
export function getFactorScreening(params: FactorScreeningQuery) {
  return request.post('/factor/screening', params);
}
```

---

## 八、状态管理

使用 Zustand 管理跨组件共享状态：

```typescript
// src/stores/factor.store.ts

interface FactorStore {
  // 因子库缓存
  factorLibrary: FactorLibraryResponse | null;

  // 因子详情页的全局参数
  analysisParams: {
    startDate: string;
    endDate: string;
    universe?: string;
  };
  setAnalysisParams: (params: Partial<AnalysisParams>) => void;

  // 因子选股页的条件列表
  screeningConditions: FactorCondition[];
  addCondition: () => void;
  updateCondition: (index: number, condition: Partial<FactorCondition>) => void;
  removeCondition: (index: number) => void;
}
```

---

## 九、ECharts 图表配色方案

统一使用量化金融常见配色：

```typescript
const FACTOR_CHART_THEME = {
  // 分层回测各组配色（从低到高渐变）
  quantileColors: [
    '#22c55e',  // Q1 (绿色，因子值最小)
    '#84cc16',  // Q2
    '#eab308',  // Q3
    '#f97316',  // Q4
    '#ef4444',  // Q5 (红色，因子值最大)
  ],

  // IC 柱状图
  icPositive: '#3b82f6',       // IC > 0 蓝色
  icNegative: '#f97316',       // IC < 0 橙色
  icMovingAvg: '#8b5cf6',     // IC 移动平均紫色

  // 相关性热力图
  correlationMin: '#2563eb',   // -1 蓝色
  correlationZero: '#ffffff',  // 0 白色
  correlationMax: '#dc2626',   // +1 红色

  // 基准线
  benchmark: '#9ca3af',        // 灰色虚线

  // 多空组合
  longShort: '#111827',        // 黑色加粗
};
```

---

## 十、响应式适配

| 断点 | 布局调整 |
|------|---------|
| ≥ 1440px | 因子卡片 4 列；图表全宽 |
| 1024~1439px | 因子卡片 3 列；图表全宽 |
| 768~1023px | 因子卡片 2 列；参数面板垂直排列 |
| < 768px | 因子卡片 1 列；Tab 改为下拉选择；图表缩小 |

---

## 十一、实现优先级

与后端对齐，分 3 个阶段：

### Phase 1：因子库 + 截面排名

1. 因子库页面（CategoryTabs + FactorCard 网格）
2. 因子详情页骨架（全局参数面板 + Tab 容器）
3. 截面排名 Tab（表格 + 分页）
4. 共享组件（UniverseSelector / TradeDatePicker / FactorSelect / StatCard）

### Phase 2：因子分析

5. IC 分析 Tab（统计卡片 + IC 时序柱状图 + IC 累计曲线）
6. 分层回测 Tab（收益统计表 + 累计收益曲线 + 分组柱状图）
7. 因子分布 Tab（统计卡片 + 直方图 + 箱线图）
8. 因子衰减 Tab（衰减柱状图）
9. 因子相关性页面（多选器 + 热力图 + 数值表格）

### Phase 3：因子选股

10. 因子选股页面（条件构建器 + 结果表格）
11. 交互优化（加载状态、错误处理、空状态）
12. 响应式适配
