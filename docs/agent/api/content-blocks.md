# 消息内容块协议

模型输出先转换并校验为白名单内容块，再持久化/渲染。模型不能返回任意 React 组件、ApexCharts options、HTML、SQL 或脚本。

## 公共字段

```ts
type SourceType =
  | 'DATABASE'
  | 'PROGRAM_CALCULATION'
  | 'OFFICIAL'
  | 'MEDIA'
  | 'INSTITUTION'
  | 'MODEL_INFERENCE'

type DataProvenance = {
  sourceType: SourceType
  citationIds: string[]
  asOf: {
    tradeDate?: string
    reportPeriod?: string
    announcementDate?: string
    availableAt?: string
    retrievedAt: string
  }
  timezone: string
  currency?: string
  unit?: string
  scale?: 'PERCENT' | 'DECIMAL'
  adjustment?: 'NONE' | 'FORWARD' | 'BACKWARD'
  dataVersion?: string
  algorithmVersion?: string
  qualityFlags?: string[]
}

type BlockBase = {
  blockId: string
  schemaVersion: 1
  title?: string
  provenance?: DataProvenance
}
```

`MARKDOWN` 可不带 provenance；包含事实数字或外部结论时必须有引用。其余数据块必须带 provenance。

## Union

```ts
type MessageBlock =
  | MarkdownBlock
  | TableBlock
  | ChartBlock
  | KlineBlock
  | FinancialMetricsBlock
  | RiskNoticeBlock

type MarkdownBlock = BlockBase & {
  type: 'MARKDOWN'
  text: string
}
```

Markdown 禁止 raw HTML；URL 必须与已验证 citation/source 对应，前端以安全 Markdown renderer 展示。

## 表格

```ts
type TableColumn = {
  key: string
  label: string
  valueType: 'STRING' | 'NUMBER' | 'DATE' | 'DATETIME' | 'BOOLEAN'
  unit?: string
  scale?: 'PERCENT' | 'DECIMAL'
  align?: 'LEFT' | 'RIGHT' | 'CENTER'
}

type TableCell = string | number | boolean | null

type TableBlock = BlockBase & {
  type: 'TABLE'
  columns: TableColumn[]
  rows: Array<Record<string, TableCell>>
  rowKey: string
  truncated: boolean
  totalRows?: number
}
```

最多 30 列、500 行、单元格字符串 2,000 字符。`rowKey` 必须对应每行稳定字段；列 key 不得用 `__proto__` 等危险名称。

## 图表

```ts
type ChartPoint = {
  x: string | number
  y: number | null
}

type ChartSeries = {
  key: string
  name: string
  points: ChartPoint[]
  unit?: string
  scale?: 'PERCENT' | 'DECIMAL'
}

type ChartBlock = BlockBase & {
  type: 'CHART'
  chart: 'LINE' | 'BAR' | 'AREA' | 'HEATMAP'
  xAxisType: 'CATEGORY' | 'DATETIME' | 'NUMBER'
  series: ChartSeries[]
}
```

最多 20 series、每 series 2,000 点。颜色、tooltip、formatter、axis 和 ApexCharts options 由前端按 theme/类型决定，服务端不能传可执行配置。

## K 线

```ts
type KlineBar = {
  tradeDate: string
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
  amount: number | null
}

type KlineBlock = BlockBase & {
  type: 'KLINE'
  tsCode: string
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  adjustment: 'NONE' | 'FORWARD' | 'BACKWARD'
  priceUnit: string
  volumeUnit: string
  amountUnit: string
  bars: KlineBar[]
}
```

Bars 按 `tradeDate` 升序且最多 5,000 条；OHLC 非 null 时必须满足 high/low 关系。周/月涨跌幅不放入 KlineBar，收益由已验证计算 Tool 生成。

## 财务指标

```ts
type FinancialMetricValue = {
  key: string
  label: string
  value: number | null
  unit?: string
  scale?: 'PERCENT' | 'DECIMAL'
}

type FinancialMetricPeriod = {
  reportPeriod: string
  announcementDate?: string
  availableAt?: string
  reportType?: string
  metrics: FinancialMetricValue[]
}

type FinancialMetricsBlock = BlockBase & {
  type: 'FINANCIAL_METRICS'
  tsCode: string
  periods: FinancialMetricPeriod[]
}
```

最多 20 期、每期 30 指标。报告期、公告日和可用时点不能折叠为一个“日期”；`null` 不转 0。

## 风险提示

```ts
type RiskNoticeBlock = BlockBase & {
  type: 'RISK_NOTICE'
  level: 'INFO' | 'WARNING' | 'CRITICAL'
  code: string
  text: string
  relatedBlockIds?: string[]
}
```

数据陈旧、单位未验证、回测不可复现、引用冲突和非投资建议均用稳定 `code`；模型不能降低服务端产生的风险等级。

## 引用

```ts
type Citation = {
  citationId: string
  sourceId: string
  sourceType: SourceType
  title: string
  canonicalUrl?: string
  publisher?: string
  publishedAt?: string
  retrievedAt: string
  locator: {
    factId?: string
    section?: string
    paragraph?: number
    startOffset?: number
    endOffset?: number
  }
  contentHash: string
}
```

`citationId` 必须已持久化并归属同一用户/Run；网页引用绑定抓取内容 hash，数据库引用绑定 Tool call/fact snapshot。前端点击引用只打开已验证 URL 或内部来源详情。

## 版本和容错

- `schemaVersion` 仅整数；破坏性变化升版本并保留旧 parser/renderer。
- 单个未知/非法 block 显示可恢复错误卡，不让整条消息崩溃。
- 前端按 `blockId` 幂等更新；模型流只增量更新当前 Markdown block，结构化块在完整校验后一次提交。
- 所有限制在后端 runtime schema 和前端 parser 双重校验，不能只写文档。
