# 市场概览（Market Overview）— 后端实现规划

> **目标读者**：AI 代码生成助手。请严格按照本文定义的接口签名、字段名称、SQL 逻辑实现。

---

## 一、功能总览

市场概览页提供 **单日快照 + 历史趋势** 两种视角，让用户一屏了解大盘格局。

| 模块                 | 接口路径                           | 数据源表                                    | 是否需新建 | 状态      |
| -------------------- | ---------------------------------- | ------------------------------------------- | ---------- | --------- |
| 核心指数行情         | `POST /market/index-quote`         | `index_daily_prices`                        | 否         | ✅ 已实现 |
| 市场情绪（涨跌家数） | `POST /market/sentiment`           | `stock_daily_prices`                        | 否         | ✅ 已实现 |
| 市场整体估值         | `POST /market/valuation`           | `stock_daily_valuation_metrics`             | 否         | ✅ 已实现 |
| **核心指数走势**     | `POST /market/index-trend`         | `index_daily_prices`                        | 否         | 🆕 新建   |
| **市场涨跌分布**     | `POST /market/change-distribution` | `stock_daily_prices`                        | 否         | 🆕 新建   |
| **行业涨跌排行**     | `POST /market/sector-ranking`      | `sector_capital_flows`                      | 否         | 🆕 新建   |
| **市场成交概况**     | `POST /market/volume-overview`     | `stock_daily_prices` + `index_daily_prices` | 否         | 🆕 新建   |
| **市场情绪趋势**     | `POST /market/sentiment-trend`     | `stock_daily_prices`                        | 否         | 🆕 新建   |
| **估值趋势**         | `POST /market/valuation-trend`     | `stock_daily_valuation_metrics`             | 否         | 🆕 新建   |

### 数据源评估

- 所有功能均可基于已有数据表实现，**不强制要求新增 Tushare 同步**。
- 涨跌停家数统计当前通过 `stock_daily_prices.pct_chg >= 9.5` 近似实现。
- 如需更精确的涨跌停数据，可考虑引入以下接口（供参考）：

| 接口名称       | 所需积分 | 说明                                         |
| -------------- | -------- | -------------------------------------------- |
| `limit_list_d` | 5000     | 每日涨跌停明细列表，含涨跌停原因、封板时间等 |

---

## 二、现有接口评估与改进

### 2.1 `POST /market/index-quote` — ✅ 保持不变

当前实现已满足：返回 6 支核心指数（上证/深证/创业板/沪深300/中证500/中证1000）当日行情。

### 2.2 `POST /market/sentiment` — ✅ 保持不变

当前实现已满足：返回当日涨跌家数 5 档分桶统计。

### 2.3 `POST /market/valuation` — ✅ 保持不变

当前实现已满足：返回当日全 A 市场 PE_TTM / PB 中位数及 1/3/5 年历史分位。

---

## 三、新建接口详细设计

### 3.1 `POST /market/index-trend` — 核心指数走势

**功能**：返回指定指数在一段时间内的每日收盘价/涨跌幅序列，用于绘制走势折线图。

#### 请求 DTO：`IndexTrendQueryDto`

```typescript
class IndexTrendQueryDto {
  /** 指数代码，默认 '000001.SH'（上证指数） */
  @IsOptional()
  @IsString()
  ts_code?: string = '000001.SH'

  /** 时间周期，默认 '3m' */
  @IsOptional()
  @IsEnum(['1m', '3m', '6m', '1y', '3y'])
  period?: '1m' | '3m' | '6m' | '1y' | '3y' = '3m'
}
```

#### 响应结构

```typescript
interface IndexTrendResponse {
  tsCode: string
  name: string // 指数中文名，由 service 内部映射
  period: string
  data: Array<{
    tradeDate: string // YYYY-MM-DD
    close: number
    pctChg: number
    vol: number
    amount: number
  }>
}
```

#### 实现要点

1. 根据 `period` 计算起始日期 `startDate`（从当前最新交易日向前推）。
2. 查询 `index_daily_prices` 表：`WHERE ts_code = ? AND trade_date >= startDate ORDER BY trade_date ASC`。
3. 指数名称映射硬编码为常量 Map：
   ```typescript
   const INDEX_NAME_MAP: Record<string, string> = {
     '000001.SH': '上证指数',
     '399001.SZ': '深证成指',
     '399006.SZ': '创业板指',
     '000300.SH': '沪深300',
     '000905.SH': '中证500',
     '000852.SH': '中证1000',
   }
   ```

---

### 3.2 `POST /market/change-distribution` — 市场涨跌分布

**功能**：返回当日全 A 股涨跌幅的直方图分布，用于柱状图展示。

#### 请求 DTO：`MoneyFlowQueryDto`（复用已有）

#### 响应结构

```typescript
interface ChangeDistributionResponse {
  tradeDate: string
  /** 涨停家数（pct_chg >= 9.5 或触及涨停价） */
  limitUp: number
  /** 跌停家数 */
  limitDown: number
  /** 涨跌幅分布直方图 bins */
  distribution: Array<{
    /** 分组标签，如 "-10~-9", "-9~-8", ..., "9~10" */
    label: string
    /** 该区间内的股票数 */
    count: number
  }>
}
```

#### 实现要点

1. 取目标交易日的所有 `daily` 记录。
2. 按 1% 步长将 `pct_chg` 分桶：`[-11,-10), [-10,-9), ..., [9,10), [10,11]`，共 21 档。
3. 涨停/跌停家数：取 `pct_chg >= 9.5` 或 `pct_chg <= -9.5` 作为近似统计。
4. 使用 PostgreSQL 宽度分桶实现，参考 SQL：
   ```sql
   SELECT
     width_bucket(pct_chg, -11, 11, 22) AS bucket,
     count(*) AS cnt
   FROM stock_daily_prices
   WHERE trade_date = $1
   GROUP BY bucket
   ORDER BY bucket
   ```

---

### 3.3 `POST /market/sector-ranking` — 行业涨跌排行

**功能**：返回当日行业板块按涨跌幅或资金净流入排序的排行榜。

#### 请求 DTO：`SectorRankingQueryDto`

```typescript
class SectorRankingQueryDto {
  /** 查询日期（YYYYMMDD），默认最新交易日 */
  @IsOptional()
  @Matches(/^\d{8}$/)
  trade_date?: string

  /** 排序方式 */
  @IsOptional()
  @IsEnum(['pct_change', 'net_amount'])
  sort_by?: 'pct_change' | 'net_amount' = 'pct_change'

  /** Top N，默认全量 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
```

#### 响应结构

```typescript
interface SectorRankingResponse {
  tradeDate: string
  sectors: Array<{
    tsCode: string
    name: string
    pctChange: number // 板块涨跌幅 %
    netAmount: number // 净流入金额（万元）
    netAmountRate: number // 净流入率 %
    /** 领涨股/领跌股名称（可选） */
    leadStock?: string
  }>
}
```

#### 实现要点

1. 查询 `sector_capital_flows` 表，`content_type = 'INDUSTRY'`。
2. 按 `sort_by` 指定字段排序，支持 `pct_change DESC` 或 `net_amount DESC`。
3. 若指定 `limit`，则 `TAKE limit`。

---

### 3.4 `POST /market/volume-overview` — 市场成交概况

**功能**：返回近 N 日全 A 市场汇总成交额及上证/深证成交额，用于成交额柱状图。

#### 请求 DTO：`VolOverviewQueryDto`

```typescript
class VolOverviewQueryDto {
  /** 查询日期（YYYYMMDD），默认最新交易日 */
  @IsOptional()
  @Matches(/^\d{8}$/)
  trade_date?: string

  /** 历史天数，默认 20 */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  days?: number = 20
}
```

#### 响应结构

```typescript
interface VolumeOverviewResponse {
  data: Array<{
    tradeDate: string // YYYY-MM-DD
    /** 全 A 股合计成交额（亿元） */
    totalAmount: number
    /** 上证指数成交额（亿元） */
    shAmount: number
    /** 深证成指成交额（亿元） */
    szAmount: number
  }>
}
```

#### 实现要点

1. 取目标日期往前 `days` 个交易日。
2. **全 A 成交额**：聚合 `stock_daily_prices`：
   ```sql
   SELECT trade_date, SUM(amount) / 1000 AS total_amount
   FROM stock_daily_prices
   WHERE trade_date <= $targetDate
   GROUP BY trade_date
   ORDER BY trade_date DESC
   LIMIT $days
   ```
   注：`amount` 字段单位为千元，转亿需除以 100000。实际请根据 Tushare daily 接口文档确认单位后调整除数。
3. **指数成交额**：查 `index_daily_prices` 取上证（`000001.SH`）和深证（`399001.SZ`）的 `amount` 字段。
4. 以 `tradeDate` 为 key 合并两组数据。

---

### 3.5 `POST /market/sentiment-trend` — 市场情绪趋势

**功能**：返回近 N 日的涨跌家数序列，用于绘制 "涨跌家数走势" 面积图。

#### 请求 DTO：`SentimentTrendQueryDto`

```typescript
class SentimentTrendQueryDto {
  /** 查询日期（YYYYMMDD），默认最新交易日 */
  @IsOptional()
  @Matches(/^\d{8}$/)
  trade_date?: string

  /** 历史天数，默认 20 */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  days?: number = 20
}
```

#### 响应结构

```typescript
interface SentimentTrendResponse {
  data: Array<{
    tradeDate: string
    rise: number // 上涨家数
    flat: number // 平盘家数
    fall: number // 下跌家数
    limitUp: number // 涨停家数（pct_chg >= 9.5）
    limitDown: number // 跌停家数（pct_chg <= -9.5）
  }>
}
```

#### 实现要点

1. 取最近 N 个交易日日期列表（从 `stock_daily_prices` 中取 distinct `trade_date`）。
2. 对每个交易日用 SQL 条件聚合一次性统计：
   ```sql
   SELECT
     trade_date,
     COUNT(*) FILTER (WHERE pct_chg > 0.001)  AS rise,
     COUNT(*) FILTER (WHERE pct_chg >= -0.001 AND pct_chg <= 0.001) AS flat,
     COUNT(*) FILTER (WHERE pct_chg < -0.001) AS fall,
     COUNT(*) FILTER (WHERE pct_chg >= 9.5)    AS limit_up,
     COUNT(*) FILTER (WHERE pct_chg <= -9.5)   AS limit_down
   FROM stock_daily_prices
   WHERE trade_date = ANY($tradeDates)
   GROUP BY trade_date
   ORDER BY trade_date ASC
   ```
3. **性能注意**：`stock_daily_prices` 有 1700 万行以上，务必确保 `trade_date` 列有索引（已有）；如果 N 较大，优先用 `WHERE trade_date = ANY(...)` 而非 range scan。

---

### 3.6 `POST /market/valuation-trend` — 估值趋势

**功能**：返回近 N 个交易日的全市场 PE/PB 中位数序列，用于估值走势折线图。

#### 请求 DTO：`ValuationTrendQueryDto`

```typescript
class ValuationTrendQueryDto {
  /** 时间周期，默认 '1y' */
  @IsOptional()
  @IsEnum(['3m', '6m', '1y', '3y', '5y'])
  period?: '3m' | '6m' | '1y' | '3y' | '5y' = '1y'
}
```

#### 响应结构

```typescript
interface ValuationTrendResponse {
  period: string
  data: Array<{
    tradeDate: string
    peTtmMedian: number // 当日全A PE_TTM 中位数
    pbMedian: number // 当日全A PB 中位数
  }>
}
```

#### 实现要点

1. 根据 `period` 推算起始日期。
2. 使用 PostgreSQL 窗口函数计算每日中位数：
   ```sql
   SELECT
     trade_date,
     PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pe_ttm) AS pe_ttm_median,
     PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY pb)     AS pb_median
   FROM stock_daily_valuation_metrics
   WHERE trade_date >= $startDate
     AND pe_ttm > 0 AND pe_ttm < 1000 AND pb > 0
   GROUP BY trade_date
   ORDER BY trade_date ASC
   ```
3. **性能注意**：该查询涉及大范围聚合。对于 5 年周期可能涉及百万级行，建议：
   - 加 Redis 缓存，按日缓存（key 格式 `market:valuation-trend:{period}`，过期时间设为当日收盘后 + 次日开盘前刷新）。
   - 或对超过 1 年的周期做周频采样（每周取最后一个交易日）以减少数据点。

---

## 四、文件结构

所有改动集中在 `src/apps/market/` 目录下：

```
src/apps/market/
├── market.module.ts            # 无需修改（Service 已注入）
├── market.controller.ts        # 新增 6 个路由方法
├── market.service.ts           # 新增 6 个业务方法
├── dto/
│   ├── money-flow-query.dto.ts # 复用（sentiment-trend, change-distribution）
│   ├── index-trend-query.dto.ts       # 🆕 新建
│   ├── sector-ranking-query.dto.ts    # 🆕 新建
│   ├── vol-overview-query.dto.ts      # 🆕 新建
│   ├── sentiment-trend-query.dto.ts   # 🆕 新建
│   ├── valuation-trend-query.dto.ts   # 🆕 新建
│   └── market-response.dto.ts        # 追加新响应类型
```

---

## 五、Redis 缓存策略

| 接口                | Cache Key 模板                               | TTL | 说明               |
| ------------------- | -------------------------------------------- | --- | ------------------ |
| index-trend         | `market:index-trend:{tsCode}:{period}`       | 4h  | 盘后数据不变       |
| change-distribution | `market:change-dist:{tradeDate}`             | 4h  | 单日快照           |
| sector-ranking      | `market:sector-ranking:{tradeDate}:{sortBy}` | 4h  | 单日快照           |
| volume-overview     | `market:vol-overview:{tradeDate}:{days}`     | 4h  | 历史聚合           |
| sentiment-trend     | `market:sentiment-trend:{tradeDate}:{days}`  | 4h  | 历史聚合           |
| valuation-trend     | `market:valuation-trend:{period}`            | 8h  | 计算量大，更长缓存 |

---

## 六、实施顺序建议

```
Step 1: 新建 DTO 文件（index-trend / sector-ranking / vol-overview / sentiment-trend / valuation-trend）
Step 2: 在 market.service.ts 中实现 6 个新方法
Step 3: 在 market.controller.ts 中新增 6 个路由
Step 4: 在 market-response.dto.ts 中追加 Swagger 响应 DTO
Step 5: 编译验证 → Docker 重启 → 日志确认无报错
Step 6: 用 curl / Swagger UI 测试每个接口返回数据
```
