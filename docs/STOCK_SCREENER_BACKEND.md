# 选股器（Stock Screener）— 后端实现规划

> **目标读者**：AI 代码生成助手。请严格按照本文定义的接口签名、字段名称、SQL 逻辑实现。

---

## 一、功能总览

选股器提供**多维度条件组合筛选**，支持估值、成长、盈利、财务健康、现金流质量、资金流向等维度的灵活过滤。

> 与现有 `POST /stock/list` 的关系：
>
> - `/stock/list` 是通用股票列表，已有基础估值+行情筛选（PE/PB/市值/涨跌幅/成交额/换手率）。
> - 选股器**新建独立接口 `/stock/screener`**，在估值和行情基础上扩展财务指标、成长性、现金流、资金流向等维度。
> - 两者共存互不影响，选股器结果可执行条件保存/加载。

| 模块             | 接口路径                       | 数据源表                                                                          | 是否需新建 | 状态      |
| ---------------- | ------------------------------ | --------------------------------------------------------------------------------- | ---------- | --------- |
| **多维度选股**   | `POST /stock/screener`         | `stock_basic_profiles` + `daily_basic` + `daily` + `fina_indicator` + `moneyflow` | 否         | 🆕 新建   |
| **筛选条件预设** | `POST /stock/screener/presets` | 无需数据表，纯配置                                                                | 否         | 🆕 新建   |
| **行业列表**     | `GET /stock/industries`        | `stock_basic_profiles`                                                            | 否         | 🆕 新建   |
| **地域列表**     | `GET /stock/areas`             | `stock_basic_profiles`                                                            | 否         | 🆕 新建   |
| 股票搜索         | `POST /stock/search`           | `stock_basic_profiles`                                                            | 否         | ✅ 已实现 |
| 股票列表         | `POST /stock/list`             | `stock_basic_profiles` + `daily_basic` + `daily`                                  | 否         | ✅ 已实现 |

### 数据源评估

- **不需要新增 Tushare 数据同步**。所有筛选维度均可基于已有数据表实现：
  - `stock_daily_valuation_metrics`（daily_basic）：PE/PB/股息率/市值/换手率 — 1750万条
  - `financial_indicator_snapshots`（fina_indicator）：ROE/ROA/毛利率/净利率/营收增速/净利增速 — 24.6万条
  - `income_statement_reports`：营收/净利润/EPS — 31万条
  - `balance_sheet_reports`：资产负债率/流动比率 — 33.8万条
  - `cashflow_reports`：经营现金流/自由现金流 — 31.6万条
  - `stock_capital_flows`（moneyflow）：各级别资金净流入 — 31万条（近60个交易日窗口）
- 如果未来需要更丰富的筛选维度，可考虑引入以下接口（供参考）：

| 接口名称         | 所需积分 | 说明                           |
| ---------------- | -------- | ------------------------------ |
| `forecast`       | 2000     | 业绩预告（预计净利、变动原因） |
| `cyq_perf`       | 2000     | 筹码分布（获利比例等）         |
| `stk_factor_pro` | 5000     | 技术因子（MA/MACD/RSI/BOLL）   |

---

## 二、核心接口详细设计

### 2.1 `POST /stock/screener` — 多维度选股

**功能**：根据前端传入的多维度筛选条件组合查询股票，返回分页结果和命中数量。

#### 请求 DTO：`StockScreenerQueryDto`

```typescript
class StockScreenerQueryDto {
  // ─── 分页 ───
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20

  // ─── 基本面筛选 ───
  /** 交易所 */
  @IsOptional()
  @IsIn(['SSE', 'SZSE', 'BSE'])
  exchange?: string

  /** 市场板块 */
  @IsOptional()
  @IsString()
  market?: string

  /** 行业（精确匹配，从 /stock/industries 返回的列表中选择） */
  @IsOptional()
  @IsString()
  industry?: string

  /** 地域 */
  @IsOptional()
  @IsString()
  area?: string

  /** 是否沪深港通 */
  @IsOptional()
  @IsIn(['N', 'H', 'S'])
  isHs?: string

  // ─── 估值维度 ───
  @IsOptional() @IsNumber() minPeTtm?: number
  @IsOptional() @IsNumber() maxPeTtm?: number
  @IsOptional() @IsNumber() minPb?: number
  @IsOptional() @IsNumber() maxPb?: number
  @IsOptional() @IsNumber() @Min(0) minDvTtm?: number // 最小股息率 TTM%
  @IsOptional() @IsNumber() @Min(0) minTotalMv?: number // 最小总市值（万元）
  @IsOptional() @IsNumber() @Min(0) maxTotalMv?: number // 最大总市值（万元）
  @IsOptional() @IsNumber() @Min(0) minCircMv?: number // 最小流通市值（万元）
  @IsOptional() @IsNumber() @Min(0) maxCircMv?: number // 最大流通市值（万元）

  // ─── 行情维度 ───
  @IsOptional() @IsNumber() minPctChg?: number // 最新涨跌幅%
  @IsOptional() @IsNumber() maxPctChg?: number
  @IsOptional() @IsNumber() @Min(0) minTurnoverRate?: number
  @IsOptional() @IsNumber() @Min(0) maxTurnoverRate?: number
  @IsOptional() @IsNumber() @Min(0) minAmount?: number // 成交额（千元）
  @IsOptional() @IsNumber() @Min(0) maxAmount?: number

  // ─── 成长维度（基于最新 fina_indicator） ───
  @IsOptional() @IsNumber() minRevenueYoy?: number // 营收同比增长%
  @IsOptional() @IsNumber() maxRevenueYoy?: number
  @IsOptional() @IsNumber() minNetprofitYoy?: number // 净利润同比增长%
  @IsOptional() @IsNumber() maxNetprofitYoy?: number

  // ─── 盈利维度 ───
  @IsOptional() @IsNumber() minRoe?: number // ROE%
  @IsOptional() @IsNumber() maxRoe?: number
  @IsOptional() @IsNumber() minGrossMargin?: number // 毛利率%
  @IsOptional() @IsNumber() maxGrossMargin?: number
  @IsOptional() @IsNumber() minNetMargin?: number // 净利率%
  @IsOptional() @IsNumber() maxNetMargin?: number

  // ─── 财务健康 ───
  @IsOptional() @IsNumber() @Min(0) maxDebtToAssets?: number // 最大资产负债率%
  @IsOptional() @IsNumber() @Min(0) minCurrentRatio?: number // 最小流动比率
  @IsOptional() @IsNumber() @Min(0) minQuickRatio?: number // 最小速动比率

  // ─── 现金流 ───
  /** 经营现金流/净利润 > N（如 0.8 表示 80%） */
  @IsOptional() @IsNumber() minOcfToNetprofit?: number

  // ─── 资金流向（近N日主力净流入，万元） ───
  /** 近5日主力净流入最小值（万元） */
  @IsOptional() @IsNumber() minMainNetInflow5d?: number
  /** 近20日主力净流入最小值（万元） */
  @IsOptional() @IsNumber() minMainNetInflow20d?: number

  // ─── 排序 ───
  @IsOptional()
  @IsEnum(ScreenerSortBy)
  sortBy?: ScreenerSortBy = ScreenerSortBy.TOTAL_MV

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc'
}
```

#### 排序枚举

```typescript
enum ScreenerSortBy {
  TOTAL_MV = 'totalMv',
  CIRC_MV = 'circMv',
  PE_TTM = 'peTtm',
  PB = 'pb',
  DV_TTM = 'dvTtm',
  PCT_CHG = 'pctChg',
  TURNOVER_RATE = 'turnoverRate',
  AMOUNT = 'amount',
  ROE = 'roe',
  REVENUE_YOY = 'revenueYoy',
  NETPROFIT_YOY = 'netprofitYoy',
  GROSS_MARGIN = 'grossMargin',
  NET_MARGIN = 'netMargin',
  DEBT_TO_ASSETS = 'debtToAssets',
  MAIN_NET_INFLOW_5D = 'mainNetInflow5d',
  LIST_DATE = 'listDate',
}
```

#### 排序安全映射

```typescript
const SCREENER_SORT_MAP: Record<ScreenerSortBy, string> = {
  totalMv: 'db.total_mv',
  circMv: 'db.circ_mv',
  peTtm: 'db.pe_ttm',
  pb: 'db.pb',
  dvTtm: 'db.dv_ttm',
  pctChg: 'd.pct_chg',
  turnoverRate: 'db.turnover_rate',
  amount: 'd.amount',
  roe: 'fi.roe',
  revenueYoy: 'fi.revenue_yoy',
  netprofitYoy: 'fi.netprofit_yoy',
  grossMargin: 'fi.grossprofit_margin',
  netMargin: 'fi.netprofit_margin',
  debtToAssets: 'fi.debt_to_assets',
  mainNetInflow5d: 'mf_agg.main_net_5d',
  listDate: 'sb.list_date',
}
```

#### 响应结构

```typescript
interface StockScreenerResponse {
  page: number
  pageSize: number
  total: number
  items: StockScreenerItem[]
}

interface StockScreenerItem {
  // 基本信息
  tsCode: string
  name: string | null
  industry: string | null
  market: string | null
  listDate: string | null

  // 行情
  close: number | null
  pctChg: number | null
  amount: number | null // 千元
  turnoverRate: number | null

  // 估值
  peTtm: number | null
  pb: number | null
  dvTtm: number | null // 股息率 TTM%
  totalMv: number | null // 总市值（万元）
  circMv: number | null // 流通市值（万元）

  // 成长性（来自最新 fina_indicator）
  revenueYoy: number | null // 营收同比%
  netprofitYoy: number | null // 净利润同比%

  // 盈利能力
  roe: number | null // ROE%
  grossMargin: number | null // 毛利率%
  netMargin: number | null // 净利率%

  // 财务健康
  debtToAssets: number | null // 资产负债率%
  currentRatio: number | null // 流动比率
  quickRatio: number | null // 速动比率

  // 现金流
  ocfToNetprofit: number | null // 经营现金流/净利润

  // 资金流向
  mainNetInflow5d: number | null // 近5日主力净流入（万元）
  mainNetInflow20d: number | null // 近20日主力净流入（万元）

  // 补充
  latestFinDate: string | null // 最新财报期（如 2025-09-30）
}
```

#### SQL 实现要点

核心查询采用 **多 LATERAL JOIN** 策略，与现有 `/stock/list` 同源模式：

```sql
SELECT
  sb.ts_code            AS "tsCode",
  sb.name,
  sb.industry,
  sb.market,
  sb.list_date          AS "listDate",
  -- 行情
  d.close,  d.pct_chg   AS "pctChg",  d.amount,
  -- 估值
  db.pe_ttm AS "peTtm", db.pb, db.dv_ttm AS "dvTtm",
  db.total_mv AS "totalMv", db.circ_mv AS "circMv",
  db.turnover_rate AS "turnoverRate",
  -- 成长 & 盈利 & 财务健康 & 现金流
  fi.revenue_yoy        AS "revenueYoy",
  fi.netprofit_yoy      AS "netprofitYoy",
  fi.roe,
  fi.grossprofit_margin AS "grossMargin",
  fi.netprofit_margin   AS "netMargin",
  fi.debt_to_assets     AS "debtToAssets",
  fi.current_ratio      AS "currentRatio",
  fi.quick_ratio        AS "quickRatio",
  fi.ocf_to_netprofit   AS "ocfToNetprofit",
  fi.end_date           AS "latestFinDate",
  -- 资金流向
  mf_agg.main_net_5d    AS "mainNetInflow5d",
  mf_agg.main_net_20d   AS "mainNetInflow20d"
FROM stock_basic_profiles sb

-- 最新估值数据（LATERAL JOIN: 取最新1条）
LEFT JOIN LATERAL (
  SELECT pe_ttm, pb, dv_ttm, total_mv, circ_mv, turnover_rate
  FROM stock_daily_valuation_metrics
  WHERE ts_code = sb.ts_code
  ORDER BY trade_date DESC LIMIT 1
) db ON true

-- 最新行情数据
LEFT JOIN LATERAL (
  SELECT trade_date, close, pct_chg, amount, vol
  FROM stock_daily_prices
  WHERE ts_code = sb.ts_code
  ORDER BY trade_date DESC LIMIT 1
) d ON true

-- 最新财务指标（取最近一期报告）
LEFT JOIN LATERAL (
  SELECT end_date, roe, grossprofit_margin, netprofit_margin,
         revenue_yoy, netprofit_yoy, debt_to_assets,
         current_ratio, quick_ratio, ocf_to_netprofit
  FROM financial_indicator_snapshots
  WHERE ts_code = sb.ts_code
  ORDER BY end_date DESC LIMIT 1
) fi ON true

-- 近N日主力净流入聚合（基于 stock_capital_flows，最近60交易日窗口）
LEFT JOIN LATERAL (
  SELECT
    SUM(CASE WHEN rn <= 5 THEN
      (COALESCE(buy_elg_amount, 0) - COALESCE(sell_elg_amount, 0)
       + COALESCE(buy_lg_amount, 0) - COALESCE(sell_lg_amount, 0))
    ELSE 0 END) AS main_net_5d,
    SUM(CASE WHEN rn <= 20 THEN
      (COALESCE(buy_elg_amount, 0) - COALESCE(sell_elg_amount, 0)
       + COALESCE(buy_lg_amount, 0) - COALESCE(sell_lg_amount, 0))
    ELSE 0 END) AS main_net_20d
  FROM (
    SELECT *, ROW_NUMBER() OVER (ORDER BY trade_date DESC) AS rn
    FROM stock_capital_flows
    WHERE ts_code = sb.ts_code
  ) sub
  WHERE rn <= 20
) mf_agg ON true

WHERE sb.list_status = 'L'
  -- 动态条件由 service 拼接 ...
ORDER BY ... DESC NULLS LAST
LIMIT $pageSize OFFSET $offset
```

#### 性能优化策略

1. **按需 JOIN**：只有当请求中包含该维度的筛选条件或排序时，才拼接对应的 LATERAL JOIN，减少不必要的子查询：

   ```typescript
   const needsFinaJoin =
     hasAnyOf(query, [
       'minRevenueYoy',
       'maxRevenueYoy',
       'minNetprofitYoy',
       'maxNetprofitYoy',
       'minRoe',
       'maxRoe',
       'minGrossMargin',
       'maxGrossMargin',
       'minNetMargin',
       'maxNetMargin',
       'maxDebtToAssets',
       'minCurrentRatio',
       'minQuickRatio',
       'minOcfToNetprofit',
     ]) || isFinaSort(query.sortBy)

   const needsMoneyflowJoin =
     hasAnyOf(query, ['minMainNetInflow5d', 'minMainNetInflow20d']) || query.sortBy === 'mainNetInflow5d'
   ```

2. **COUNT 查询同步优化**：count 查询用相同 JOIN 但只 `SELECT COUNT(*)`，不取完整字段。

3. **索引依赖**：
   - `stock_daily_valuation_metrics` (ts_code, trade_date DESC) — 已有
   - `stock_daily_prices` (ts_code, trade_date DESC) — 已有
   - `financial_indicator_snapshots` (ts_code, end_date DESC) — 已有
   - `stock_capital_flows` (ts_code, trade_date DESC) — 已有
   - 无需新建索引。

4. **Redis 缓存**：选股器结果变化频繁，不缓存结果本身，但可缓存行业/地域列表（极少变化）。

---

### 2.2 `POST /stock/screener/presets` — 筛选条件预设列表

**功能**：返回系统内置的常用选股策略预设列表，前端可一键加载。

#### 请求：无参数

#### 响应结构

```typescript
interface ScreenerPresetResponse {
  presets: Array<{
    id: string
    name: string
    description: string
    filters: Partial<StockScreenerQueryDto> // 预设的筛选条件
  }>
}
```

#### 内置预设

在 service 中硬编码以下常用策略（后续可扩展为数据库存储）：

```typescript
const BUILT_IN_PRESETS: ScreenerPreset[] = [
  {
    id: 'value',
    name: '低估值蓝筹',
    description: 'PE<15, PB<2, 股息率>2%, 市值>100亿',
    filters: {
      maxPeTtm: 15,
      maxPb: 2,
      minDvTtm: 2,
      minTotalMv: 1000000, // 100亿 = 1000000万
      sortBy: ScreenerSortBy.DV_TTM,
      sortOrder: 'desc',
    },
  },
  {
    id: 'growth',
    name: '高成长',
    description: '营收增速>20%, 净利增速>20%, ROE>10%',
    filters: {
      minRevenueYoy: 20,
      minNetprofitYoy: 20,
      minRoe: 10,
      sortBy: ScreenerSortBy.NETPROFIT_YOY,
      sortOrder: 'desc',
    },
  },
  {
    id: 'quality',
    name: '优质白马',
    description: 'ROE>15%, 毛利率>30%, 资产负债率<60%, 经营现金流/净利>0.8',
    filters: {
      minRoe: 15,
      minGrossMargin: 30,
      maxDebtToAssets: 60,
      minOcfToNetprofit: 0.8,
      sortBy: ScreenerSortBy.ROE,
      sortOrder: 'desc',
    },
  },
  {
    id: 'dividend',
    name: '高股息',
    description: '股息率>3%, PE<20, 市值>50亿',
    filters: {
      minDvTtm: 3,
      maxPeTtm: 20,
      minTotalMv: 500000, // 50亿
      sortBy: ScreenerSortBy.DV_TTM,
      sortOrder: 'desc',
    },
  },
  {
    id: 'small_growth',
    name: '小盘成长',
    description: '市值<100亿, 营收增速>30%, 净利增速>30%',
    filters: {
      maxTotalMv: 1000000,
      minRevenueYoy: 30,
      minNetprofitYoy: 30,
      sortBy: ScreenerSortBy.NETPROFIT_YOY,
      sortOrder: 'desc',
    },
  },
  {
    id: 'main_inflow',
    name: '主力资金流入',
    description: '近5日主力净流入>0, 换手率>1%',
    filters: {
      minMainNetInflow5d: 0,
      minTurnoverRate: 1,
      sortBy: ScreenerSortBy.MAIN_NET_INFLOW_5D,
      sortOrder: 'desc',
    },
  },
]
```

---

### 2.3 `GET /stock/industries` — 行业列表

**功能**：返回当前在上市股票（`list_status = 'L'`）中实际存在的所有行业名称及股票数量，供前端下拉选择。

#### 响应结构

```typescript
interface IndustryListResponse {
  industries: Array<{
    name: string // 行业名称
    count: number // 该行业上市股票数
  }>
}
```

#### SQL

```sql
SELECT industry AS name, COUNT(*) AS count
FROM stock_basic_profiles
WHERE list_status = 'L' AND industry IS NOT NULL AND industry != ''
GROUP BY industry
ORDER BY count DESC
```

#### 缓存

- Redis key: `stock:industries`
- TTL: 24h（行业列表变化极少）

---

### 2.4 `GET /stock/areas` — 地域列表

**功能**：返回在上市股票中的去重地域列表及股票数量。

#### 响应结构

```typescript
interface AreaListResponse {
  areas: Array<{
    name: string
    count: number
  }>
}
```

#### SQL

```sql
SELECT area AS name, COUNT(*) AS count
FROM stock_basic_profiles
WHERE list_status = 'L' AND area IS NOT NULL AND area != ''
GROUP BY area
ORDER BY count DESC
```

#### 缓存

- Redis key: `stock:areas`
- TTL: 24h

---

## 三、文件结构

所有改动集中在 `src/apps/stock/` 目录下：

```
src/apps/stock/
├── stock.module.ts                        # 无需修改
├── stock.controller.ts                    # 新增 4 个路由方法
├── stock.service.ts                       # 新增 4 个业务方法
├── dto/
│   ├── stock-list-query.dto.ts            # 保持不变
│   ├── stock-screener-query.dto.ts        # 🆕 新建（ScreenerSortBy 枚举 + DTO）
│   ├── stock-screener-response.dto.ts     # 🆕 新建（Swagger 响应 DTO）
│   └── ... (其他现有 DTO 不动)
```

---

## 四、Redis 缓存策略

| 接口             | Cache Key          | TTL | 说明                     |
| ---------------- | ------------------ | --- | ------------------------ |
| industries       | `stock:industries` | 24h | 行业列表极少变化         |
| areas            | `stock:areas`      | 24h | 地域列表极少变化         |
| screener/presets | 无需缓存           | -   | 硬编码常量，直接返回     |
| screener         | 不缓存             | -   | 条件组合多，缓存命中率低 |

---

## 五、实施顺序建议

```
Step 1: 新建 stock-screener-query.dto.ts（ScreenerSortBy 枚举 + StockScreenerQueryDto）
Step 2: 新建 stock-screener-response.dto.ts（Swagger 响应 DTO）
Step 3: 在 stock.service.ts 中实现 screener() 方法（核心多 LATERAL JOIN SQL）
Step 4: 在 stock.service.ts 中实现 getIndustries() 和 getAreas()
Step 5: 在 stock.service.ts 中实现 getScreenerPresets()
Step 6: 在 stock.controller.ts 中新增 4 个路由
Step 7: 编译验证 → Docker 重启 → 日志确认无报错
Step 8: 用 curl / Swagger 测试选股器接口
```

---

## 六、注意事项

1. **LATERAL JOIN 按需拼接**：如果前端只传了估值条件，不要 JOIN `financial_indicator_snapshots` 和 `stock_capital_flows`。用 `Prisma.empty` 或条件拼装 SQL 片段。
2. **NULL 处理**：财务指标可能为 NULL（新股/ST 无季报）。WHERE 条件中 NULL 值自然被排除，但排序时使用 `NULLS LAST`。
3. **资金流窗口限制**：`stock_capital_flows` 仅保留近 60 个交易日，近 5/20 日聚合不会出界。
4. **财报期延迟**：`fina_indicator` 取最新一期，可能是 2~3 个月前的报告期。这是正常行为，前端展示 `latestFinDate` 让用户感知。
5. **排序字段安全**：`SCREENER_SORT_MAP` 使用 `Prisma.raw()` 输出，value 全部硬编码，不接受用户自由输入。
6. **市值单位**：`total_mv` 和 `circ_mv` 在 Tushare 中单位为**万元**。前端筛选和展示需注意换算。
