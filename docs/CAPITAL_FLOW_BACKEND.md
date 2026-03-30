# 资金动态（Capital Flow）— 后端实现规划

> **目标读者**：AI 代码生成助手。请严格按照本文定义的接口签名、字段名称、SQL 逻辑实现。

---

## 一、功能总览

资金动态页聚焦 **资金流入流出**，覆盖大盘整体、行业板块、个股主力、北向南向四个维度。

| 模块                           | 接口路径                           | 数据源表                                     | 是否需新建 | 状态      |
| ------------------------------ | ---------------------------------- | -------------------------------------------- | ---------- | --------- |
| 大盘资金流向（当日快照）       | `POST /market/money-flow`          | `market_capital_flows`                       | 否         | ✅ 已实现 |
| 行业板块资金流向               | `POST /market/sector-flow`         | `sector_capital_flows`                       | 否         | ✅ 已实现 |
| 沪深港通资金                   | `POST /market/hsgt-flow`           | `moneyflow_hsgt`                             | 否         | ✅ 已实现 |
| **大盘资金流向趋势**           | `POST /market/money-flow-trend`    | `market_capital_flows`                       | 否         | 🆕 新建   |
| **板块资金流向排行（多类型）** | `POST /market/sector-flow-ranking` | `sector_capital_flows`                       | 否         | 🆕 新建   |
| **板块资金流向趋势**           | `POST /market/sector-flow-trend`   | `sector_capital_flows`                       | 否         | 🆕 新建   |
| **沪深港通趋势（扩展）**       | `POST /market/hsgt-trend`          | `moneyflow_hsgt`                             | 否         | 🆕 新建   |
| **主力资金净流入 Top N**       | `POST /market/main-flow-ranking`   | `stock_capital_flows`                        | 否         | 🆕 新建   |
| **个股资金流动明细**           | `POST /market/stock-flow-detail`   | `stock_capital_flows` + `stock_daily_prices` | 否         | 🆕 新建   |

### 数据源评估

- **不需要新增 Tushare 数据同步**。所有功能均可基于已有的 4 张资金流向表实现：
  - `market_capital_flows`（大盘，60 日窗口）
  - `sector_capital_flows`（行业/概念/地域，60 日窗口）
  - `stock_capital_flows`（个股，60 日窗口）
  - `moneyflow_hsgt`（沪深港通，完整历史）
- 数据时间范围：大盘/板块/个股资金流保留近 60 个交易日（2025-12-25 至今）；HSGT 有完整历史。

---

## 二、现有接口评估与改进

### 2.1 `POST /market/money-flow` — 需小幅增强

**当前问题**：仅返回单日记录，前端看不到分级别（超大单/大单/中单/小单）净流入金额的详细拆分。

**改进方案**：当前 `MoneyflowMktDc` 模型的字段已经包含 `buyElgAmount`, `buyLgAmount`, `buyMdAmount`, `buySmAmount` 以及各自的 `rate` 字段，直接在响应 DTO 中补全即可。无需修改 service 查询逻辑，只需完善 response DTO 映射。

**更新后的响应 DTO**：

```typescript
class MarketMoneyFlowDetailDto {
  tradeDate: string
  /** 大盘净流入金额（万元） */
  netAmount: number
  /** 大盘净流入率 % */
  netAmountRate: number
  /** 超大单净流入金额 */
  buyElgAmount: number
  buyElgAmountRate: number
  /** 大单净流入金额 */
  buyLgAmount: number
  buyLgAmountRate: number
  /** 中单净流入金额 */
  buyMdAmount: number
  buyMdAmountRate: number
  /** 小单净流入金额 */
  buySmAmount: number
  buySmAmountRate: number
  /** 沪市收盘点位 */
  closeSh: number
  /** 沪市涨跌幅 */
  pctChangeSh: number
  /** 深市收盘点位 */
  closeSz: number
  /** 深市涨跌幅 */
  pctChangeSz: number
}
```

### 2.2 `POST /market/sector-flow` — 需小幅增强

**当前问题**：返回全量数据（~700-800 条/日），前端可能只需要 Top 排行。

**改进方案**：在 DTO 中增加可选的 `limit` 和 `content_type` 参数，实现按类型筛选 + Top N 截断。

**更新后的请求 DTO**：

```typescript
class SectorFlowQueryDto extends MoneyFlowQueryDto {
  /** 板块类型筛选，不传则返回全部三类 */
  @IsOptional()
  @IsEnum(['INDUSTRY', 'CONCEPT', 'REGION'])
  content_type?: 'INDUSTRY' | 'CONCEPT' | 'REGION'

  /** Top N 截断，默认不限制 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
```

### 2.3 `POST /market/hsgt-flow` — 需小幅增强

**当前问题**：固定返回最近 20 日，前端无法控制天数。

**改进方案**：增加 `days` 参数。

```typescript
class HsgtFlowQueryDto extends MoneyFlowQueryDto {
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(365)
  days?: number = 20
}
```

---

## 三、新建接口详细设计

### 3.1 `POST /market/money-flow-trend` — 大盘资金流向趋势

**功能**：返回近 N 日大盘各级别资金净流入序列 + 累计净流入，用于趋势折线/面积图。

#### 请求 DTO：`MoneyFlowTrendQueryDto`

```typescript
class MoneyFlowTrendQueryDto {
  /** 查询日期（YYYYMMDD），默认最新交易日 */
  @IsOptional()
  @Matches(/^\d{8}$/)
  trade_date?: string

  /** 历史天数，默认 20，最大 60（受数据窗口限制） */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60)
  days?: number = 20
}
```

#### 响应结构

```typescript
interface MoneyFlowTrendResponse {
  data: Array<{
    tradeDate: string // YYYY-MM-DD
    netAmount: number // 当日净流入（万元）
    cumulativeNet: number // 累计净流入（从序列第 1 天开始累加）
    buyElgAmount: number // 超大单净流入
    buyLgAmount: number // 大单净流入
    buyMdAmount: number // 中单净流入
    buySmAmount: number // 小单净流入
  }>
}
```

#### 实现要点

1. 查 `market_capital_flows` 表，按 `trade_date DESC` 取 N 条，再倒序。
2. 在 service 侧计算 `cumulativeNet`：遍历数组做 running sum。
3. 数据窗口最多 60 天（受同步策略限制），超出则返回实际可用天数。

---

### 3.2 `POST /market/sector-flow-ranking` — 板块资金流向排行

**功能**：返回行业 / 概念 / 地域板块的资金净流入排行榜（可切换分类与排序维度）。

#### 请求 DTO：`SectorFlowRankingQueryDto`

```typescript
class SectorFlowRankingQueryDto {
  /** 查询日期（YYYYMMDD），默认最新交易日 */
  @IsOptional()
  @Matches(/^\d{8}$/)
  trade_date?: string

  /** 板块类型：INDUSTRY / CONCEPT / REGION */
  @IsOptional()
  @IsEnum(['INDUSTRY', 'CONCEPT', 'REGION'])
  content_type?: 'INDUSTRY' | 'CONCEPT' | 'REGION' = 'INDUSTRY'

  /** 排序维度 */
  @IsOptional()
  @IsEnum(['net_amount', 'pct_change', 'buy_elg_amount'])
  sort_by?: 'net_amount' | 'pct_change' | 'buy_elg_amount' = 'net_amount'

  /** 排序方向 */
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc'

  /** Top N，默认 20 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20
}
```

#### 响应结构

```typescript
interface SectorFlowRankingResponse {
  tradeDate: string
  contentType: string
  sectors: Array<{
    tsCode: string
    name: string
    pctChange: number // 板块涨跌幅 %
    close: number
    netAmount: number // 净流入（万元）
    netAmountRate: number // 净流入率 %
    buyElgAmount: number // 超大单净流入
    buyLgAmount: number // 大单净流入
    buyMdAmount: number // 中单净流入
    buySmAmount: number // 小单净流入
  }>
}
```

#### 实现要点

1. 查 `sector_capital_flows`，筛选 `content_type` 和 `trade_date`。
2. 按 `sort_by` + `order` 排序，`TAKE limit`。
3. 返回完整的四级别资金拆分。

---

### 3.3 `POST /market/sector-flow-trend` — 板块资金流向趋势

**功能**：返回指定板块在近 N 日的资金净流入趋势，用于板块详情折线图。

#### 请求 DTO：`SectorFlowTrendQueryDto`

```typescript
class SectorFlowTrendQueryDto {
  /** 板块代码（如 'BK0475'） */
  @IsString()
  @IsNotEmpty()
  ts_code: string

  /** 板块类型 */
  @IsOptional()
  @IsEnum(['INDUSTRY', 'CONCEPT', 'REGION'])
  content_type?: 'INDUSTRY' | 'CONCEPT' | 'REGION' = 'INDUSTRY'

  /** 历史天数，默认 20，最大 60 */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60)
  days?: number = 20
}
```

#### 响应结构

```typescript
interface SectorFlowTrendResponse {
  tsCode: string
  name: string
  data: Array<{
    tradeDate: string
    pctChange: number
    netAmount: number
    cumulativeNet: number // 累计净流入
  }>
}
```

#### 实现要点

1. 查 `sector_capital_flows`，`WHERE ts_code = ? AND content_type = ? ORDER BY trade_date DESC LIMIT days`。
2. 倒序后计算 `cumulativeNet`。
3. `name` 取第一条记录的 name 字段。

---

### 3.4 `POST /market/hsgt-trend` — 沪深港通趋势（扩展）

**功能**：返回较长周期的北向/南向资金走势和累计净流入。

#### 请求 DTO：`HsgtTrendQueryDto`

```typescript
class HsgtTrendQueryDto {
  /** 时间周期 */
  @IsOptional()
  @IsEnum(['1m', '3m', '6m', '1y'])
  period?: '1m' | '3m' | '6m' | '1y' = '3m'
}
```

#### 响应结构

```typescript
interface HsgtTrendResponse {
  period: string
  data: Array<{
    tradeDate: string
    northMoney: number // 北向当日净买入（亿元）
    southMoney: number // 南向当日净买入（亿元）
    hgt: number // 沪股通
    sgt: number // 深股通
    ggtSs: number // 港股通（上海）
    ggtSz: number // 港股通（深圳）
    cumulativeNorth: number // 累计北向
    cumulativeSouth: number // 累计南向
  }>
}
```

#### 实现要点

1. 根据 `period` 计算起始日期。
2. 查 `moneyflow_hsgt`，`WHERE trade_date >= startDate ORDER BY trade_date ASC`。
3. 计算 `cumulativeNorth` / `cumulativeSouth`（running sum）。
4. HSGT 有完整历史（从 2024-12 起），所以 1 年内的查询无问题。

---

### 3.5 `POST /market/main-flow-ranking` — 主力资金净流入 Top N

**功能**：返回今日主力（超大单 + 大单）净流入最多 / 最少的个股排行，供 "主力资金动向" 模块使用。

#### 请求 DTO：`MainFlowRankingQueryDto`

```typescript
class MainFlowRankingQueryDto {
  /** 查询日期（YYYYMMDD），默认最新交易日 */
  @IsOptional()
  @Matches(/^\d{8}$/)
  trade_date?: string

  /** 排序方向：desc=主力净流入最多, asc=主力净流出最多 */
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc'

  /** Top N，默认 20 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20
}
```

#### 响应结构

```typescript
interface MainFlowRankingResponse {
  tradeDate: string
  data: Array<{
    tsCode: string
    name: string // 股票名称（JOIN stock_basic_profiles）
    industry: string // 所属行业
    /** 主力净流入 = (buyElgAmount - sellElgAmount) + (buyLgAmount - sellLgAmount) */
    mainNetInflow: number
    /** 超大单净流入 */
    elgNetInflow: number
    /** 大单净流入 */
    lgNetInflow: number
    /** 当日涨跌幅（JOIN daily） */
    pctChg: number
    /** 当日成交额 */
    amount: number
  }>
}
```

#### 实现要点

1. 使用 SQL 计算主力净流入：
   ```sql
   SELECT
     mf.ts_code,
     sb.name,
     sb.industry,
     (COALESCE(mf.buy_elg_amount, 0) - COALESCE(mf.sell_elg_amount, 0)
      + COALESCE(mf.buy_lg_amount, 0) - COALESCE(mf.sell_lg_amount, 0)) AS main_net_inflow,
     (COALESCE(mf.buy_elg_amount, 0) - COALESCE(mf.sell_elg_amount, 0)) AS elg_net_inflow,
     (COALESCE(mf.buy_lg_amount, 0) - COALESCE(mf.sell_lg_amount, 0))   AS lg_net_inflow,
     d.pct_chg,
     d.amount
   FROM stock_capital_flows mf
   JOIN stock_basic_profiles sb ON sb.ts_code = mf.ts_code
   LEFT JOIN stock_daily_prices d ON d.ts_code = mf.ts_code AND d.trade_date = mf.trade_date
   WHERE mf.trade_date = $targetDate
   ORDER BY main_net_inflow DESC  -- 或 ASC
   LIMIT $limit
   ```
2. 注意 `stock_basic_profiles` 的 `name` 和 `industry` 字段。

---

### 3.6 `POST /market/stock-flow-detail` — 个股资金流动明细

**功能**：返回指定个股近 N 日的资金流向分级明细趋势。

#### 请求 DTO：`StockFlowDetailQueryDto`

```typescript
class StockFlowDetailQueryDto {
  /** 股票代码 */
  @IsString()
  @IsNotEmpty()
  ts_code: string

  /** 历史天数，默认 20，最大 60 */
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(60)
  days?: number = 20
}
```

#### 响应结构

```typescript
interface StockFlowDetailResponse {
  tsCode: string
  name: string
  data: Array<{
    tradeDate: string
    /** 主力净流入 = 超大单净 + 大单净 */
    mainNetInflow: number
    /** 散户净流入 = 中单净 + 小单净 */
    retailNetInflow: number
    buyElgAmount: number
    sellElgAmount: number
    buyLgAmount: number
    sellLgAmount: number
    buyMdAmount: number
    sellMdAmount: number
    buySmAmount: number
    sellSmAmount: number
    netMfAmount: number // 总净流入
  }>
}
```

#### 实现要点

1. 查 `stock_capital_flows`，`WHERE ts_code = ? ORDER BY trade_date DESC LIMIT days`。
2. 在 service 侧计算 `mainNetInflow` 和 `retailNetInflow`。
3. `name` 从 `stock_basic_profiles` 查。

---

## 四、文件结构

新增和修改集中在 `src/apps/market/` 目录下：

```
src/apps/market/
├── market.module.ts                    # 无需修改
├── market.controller.ts                # 新增 6 个路由 + 修改 3 个已有路由的 DTO
├── market.service.ts                   # 新增 6 个业务方法 + 增强 3 个已有方法
├── dto/
│   ├── money-flow-query.dto.ts         # 保持（基础 DTO）
│   ├── money-flow-trend-query.dto.ts   # 🆕 新建
│   ├── sector-flow-ranking-query.dto.ts # 🆕 新建
│   ├── sector-flow-trend-query.dto.ts  # 🆕 新建
│   ├── hsgt-trend-query.dto.ts         # 🆕 新建
│   ├── main-flow-ranking-query.dto.ts  # 🆕 新建
│   ├── stock-flow-detail-query.dto.ts  # 🆕 新建
│   └── market-response.dto.ts          # 追加新响应类型
```

---

## 五、Redis 缓存策略

| 接口                | Cache Key 模板                                                  | TTL | 说明         |
| ------------------- | --------------------------------------------------------------- | --- | ------------ |
| money-flow-trend    | `market:mf-trend:{tradeDate}:{days}`                            | 4h  | 单日历史序列 |
| sector-flow-ranking | `market:sector-rank:{tradeDate}:{contentType}:{sortBy}:{order}` | 4h  | 排行快照     |
| sector-flow-trend   | `market:sector-trend:{tsCode}:{contentType}:{days}`             | 4h  | 板块趋势     |
| hsgt-trend          | `market:hsgt-trend:{period}`                                    | 4h  | 北向南向趋势 |
| main-flow-ranking   | `market:main-flow-rank:{tradeDate}:{order}:{limit}`             | 4h  | 主力排行     |
| stock-flow-detail   | `market:stock-flow:{tsCode}:{days}`                             | 4h  | 个股资金明细 |

---

## 六、数据窗口限制说明

| 数据表                 | 保留策略       | 可查天数 |
| ---------------------- | -------------- | -------- |
| `market_capital_flows` | 近 60 个交易日 | ≤ 60     |
| `sector_capital_flows` | 近 60 个交易日 | ≤ 60     |
| `stock_capital_flows`  | 近 60 个交易日 | ≤ 60     |
| `moneyflow_hsgt`       | 完整历史       | 无限制   |

接口 `days` 参数最大值应与数据窗口匹配，超出部分返回实际可用数据（不报错）。

---

## 七、实施顺序建议

```
Step 1: 增强已有 3 个接口的请求/响应 DTO（money-flow / sector-flow / hsgt-flow）
Step 2: 新建 6 个新接口的 DTO 文件
Step 3: 在 market.service.ts 中实现 6 个新方法
Step 4: 在 market.controller.ts 中新增 6 个路由
Step 5: 在 market-response.dto.ts 中追加 Swagger 响应 DTO
Step 6: 编译验证 → Docker 重启 → 日志确认无报错
Step 7: 用 curl / Swagger UI 测试每个接口返回数据
```
