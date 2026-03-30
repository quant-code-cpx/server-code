# 因子市场 — 后端实现规划

> **目标读者**：AI 代码生成器。本文档是一份结构化的实现规范，按照本文档的指令可以逐步完成因子市场后端的全部功能。
> **项目技术栈**：NestJS + Prisma + PostgreSQL + Redis + BullMQ + Socket.IO
> **现有代码约定**：Controller 只返回原始数据，`TransformInterceptor` 自动包裹 `ResponseModel.success({data})`；HTTP 模块放在 `src/apps/*`，Tushare 同步放在 `src/tushare/`；所有 Tushare 同步逻辑使用 plan-driven 架构注册到 `SyncRegistryService`。

---

## 一、功能概览

因子市场是一个**量化因子研究平台**，核心目标是让用户能够：

1. 浏览因子库，查看每个因子的定义、分类、描述
2. 查看任意因子在任意日期的全市场截面值（哪只股票因子值是多少）
3. 对单因子进行 IC/IR 分析，评估因子的预测能力
4. 对单因子进行分层回测，看各分位组合的收益表现
5. 分析因子衰减特性，选择最佳持有周期
6. 查看因子分布特征和缺失率
7. 查看多因子之间的相关性矩阵
8. 按因子条件组合选股

---

## 二、现有数据评估 & 新增数据需求

### 2.1 现有数据（已满足因子计算需求）

| 数据类型 | Prisma 模型 | 可派生的因子 |
|---------|------------|------------|
| 日线行情 OHLCV | `Daily` / `Weekly` / `Monthly` | 动量因子（N日收益率）、波动率因子（收益标准差）、技术因子（MA/MACD/RSI） |
| 复权因子 | `AdjFactor` | 前/后复权价格，修正动量与技术因子 |
| 每日估值指标 | `DailyBasic` | 估值因子（PE_TTM/PB/PS_TTM/股息率）、规模因子（总市值/流通市值）、流动性因子（换手率/量比） |
| 财务指标 | `FinaIndicator` | 质量因子（ROE/ROA/净利率/资产负债率/流动比率）、成长因子（营收同比/净利润同比） |
| 利润表 | `Income` | 盈利因子（营业利润/净利润/毛利率等派生） |
| 资产负债表 | `BalanceSheet` | 杠杆因子（总负债/总资产等派生） |
| 现金流量表 | `Cashflow` | 现金流因子（经营现金流/自由现金流等派生） |
| 个股资金流 | `Moneyflow` | 资金流因子（净流入金额/主力净流入占比） |
| 股票基础信息 | `StockBasic` | 行业分类（用于行业中性化） |
| 交易日历 | `TradeCal` | 交易日判断与日期偏移 |

### 2.2 需要新增的 Tushare 数据（3 张表）

#### 表 1：涨跌停价格 `stk_limit`

- **用途**：因子分析中必须剔除涨跌停股票（因为涨跌停日买卖受限，纳入组合会产生偏差）
- **Tushare API**：`stk_limit`
- **同步策略**：按交易日增量同步，类似 `Daily`
- **关键字段**：`ts_code`, `trade_date`, `up_limit`（涨停价）, `down_limit`（跌停价）

#### 表 2：停牌信息 `suspend_d`

- **用途**：因子分析中必须剔除停牌股票（停牌期间无法交易，纳入组合会产生偏差）
- **Tushare API**：`suspend_d`
- **同步策略**：按公告日期增量同步
- **关键字段**：`ts_code`, `trade_date`, `suspend_timing`（停牌时点）, `suspend_type`（停牌类型）

#### 表 3：指数成分与权重 `index_weight`

- **用途**：选择分析的股票池（universe）。例如：只分析沪深 300 成分股、中证 500 成分股等。因子分析结果受股票池影响很大。
- **Tushare API**：`index_weight`
- **同步策略**：按月增量同步，仅同步核心指数（沪深300/中证500/中证1000/上证50）
- **关键字段**：`index_code`, `con_code`（成分股代码）, `trade_date`, `weight`（权重百分比）

---

## 三、Prisma Schema 新增定义

### 3.1 新增 Tushare 数据表

在 `prisma/` 下新建对应的 `.prisma` 文件：

#### `prisma/tushare_stk_limit.prisma`

```prisma
model StkLimit {
  tsCode    String   @map("ts_code")
  tradeDate String   @map("trade_date")
  upLimit   Decimal? @map("up_limit")   @db.Decimal(20, 4)
  downLimit Decimal? @map("down_limit") @db.Decimal(20, 4)
  syncedAt  DateTime @default(now()) @map("synced_at")

  @@id([tsCode, tradeDate])
  @@index([tradeDate])
  @@map("stock_limit_prices")
}
```

#### `prisma/tushare_suspend.prisma`

```prisma
model SuspendD {
  tsCode        String  @map("ts_code")
  tradeDate     String  @map("trade_date")
  suspendTiming String? @map("suspend_timing")
  suspendType   String? @map("suspend_type")
  syncedAt      DateTime @default(now()) @map("synced_at")

  @@id([tsCode, tradeDate])
  @@index([tradeDate])
  @@map("stock_suspend_events")
}
```

#### `prisma/tushare_index_weight.prisma`

```prisma
model IndexWeight {
  indexCode  String   @map("index_code")
  conCode   String   @map("con_code")
  tradeDate String   @map("trade_date")
  weight    Decimal? @map("weight") @db.Decimal(10, 6)
  syncedAt  DateTime @default(now()) @map("synced_at")

  @@id([indexCode, conCode, tradeDate])
  @@index([indexCode, tradeDate])
  @@index([conCode])
  @@map("index_constituent_weights")
}
```

### 3.2 因子定义表

在 `prisma/` 下新建 `prisma/factor.prisma`：

```prisma
/// 因子分类枚举
enum FactorCategory {
  VALUATION    @map("valuation")     // 估值
  SIZE         @map("size")          // 规模
  MOMENTUM     @map("momentum")      // 动量
  VOLATILITY   @map("volatility")    // 波动率
  LIQUIDITY    @map("liquidity")     // 流动性
  QUALITY      @map("quality")       // 质量
  GROWTH       @map("growth")        // 成长
  CAPITAL_FLOW @map("capital_flow")  // 资金流
  TECHNICAL    @map("technical")     // 技术
  LEVERAGE     @map("leverage")      // 杠杆
  DIVIDEND     @map("dividend")      // 红利
  CUSTOM       @map("custom")        // 自定义

  @@map("factor_category")
}

/// 因子来源类型
enum FactorSourceType {
  FIELD_REF    @map("field_ref")     // 直接引用现有表字段
  DERIVED      @map("derived")       // 从现有数据派生计算（SQL/代码）
  CUSTOM_SQL   @map("custom_sql")    // 用户自定义SQL表达式

  @@map("factor_source_type")
}

/// 因子定义（内置 + 自定义）
model FactorDefinition {
  id          String            @id @default(cuid())
  name        String            @unique                 // 因子英文标识，如 "pe_ttm"
  label       String                                    // 因子中文名，如 "市盈率TTM"
  description String?                                   // 因子描述/计算说明
  category    FactorCategory                            // 分类
  sourceType  FactorSourceType  @map("source_type")     // 数据来源类型
  expression  String?                                   // 计算表达式或SQL（仅 DERIVED/CUSTOM_SQL 使用）
  sourceTable String?           @map("source_table")    // 引用的Prisma表名（仅 FIELD_REF 使用）
  sourceField String?           @map("source_field")    // 引用的字段名（仅 FIELD_REF 使用）
  params      Json?                                     // 计算参数（如窗口长度、衰减系数等）
  isBuiltin   Boolean           @default(true) @map("is_builtin")   // 是否内置因子
  isEnabled   Boolean           @default(true) @map("is_enabled")   // 是否启用
  sortOrder   Int               @default(0)   @map("sort_order")    // 展示排序
  createdAt   DateTime          @default(now()) @map("created_at")
  updatedAt   DateTime          @updatedAt      @map("updated_at")

  @@index([category])
  @@index([isBuiltin, isEnabled])
  @@map("factor_definitions")
}
```

### 3.3 TushareSyncTask 枚举更新

在 `prisma/tushare_enums.prisma` 中的 `TushareSyncTask` 枚举添加：

```prisma
enum TushareSyncTask {
  // ... 现有项 ...
  STK_LIMIT
  SUSPEND_D
  INDEX_WEIGHT
}
```

---

## 四、Tushare 数据同步实现

### 4.1 常量定义

在 `src/constant/tushare.constant.ts` 中添加：

```typescript
// API 名称
export enum TushareApiName {
  // ... 现有 ...
  STK_LIMIT = 'stk_limit',
  SUSPEND_D = 'suspend_d',
  INDEX_WEIGHT = 'index_weight',
}

// 同步任务名
export enum TushareSyncTaskName {
  // ... 现有 ...
  STK_LIMIT = 'STK_LIMIT',
  SUSPEND_D = 'SUSPEND_D',
  INDEX_WEIGHT = 'INDEX_WEIGHT',
}

// 字段定义
export const TUSHARE_STK_LIMIT_FIELDS = [
  'ts_code', 'trade_date', 'up_limit', 'down_limit',
];

export const TUSHARE_SUSPEND_D_FIELDS = [
  'ts_code', 'trade_date', 'suspend_timing', 'suspend_type',
];

export const TUSHARE_INDEX_WEIGHT_FIELDS = [
  'index_code', 'con_code', 'trade_date', 'weight',
];

// 需要跟踪成分权重的核心指数
export const FACTOR_UNIVERSE_INDEX_CODES = [
  '000300.SH',  // 沪深300
  '000905.SH',  // 中证500
  '000852.SH',  // 中证1000
  '000016.SH',  // 上证50
];
```

### 4.2 Mapper 扩展

在 `src/tushare/mapper/tushare.mapper.ts` 中添加映射函数：

```typescript
// 对每个新API添加 mapStkLimitRow, mapSuspendDRow, mapIndexWeightRow
// 遵循现有 mapper 的 snakeCase → camelCase 转换模式
```

### 4.3 新增同步 Service

在 `src/tushare/sync/` 下新建 `factor-data-sync.service.ts`，注册 3 个同步计划：

| 任务 | order | 调度时间 | 策略 |
|------|-------|---------|------|
| `STK_LIMIT` | 510 | 每个交易日 19:30 | 按交易日增量同步，与 Daily 类似 |
| `SUSPEND_D` | 520 | 每个交易日 19:35 | 按交易日增量同步 |
| `INDEX_WEIGHT` | 530 | 每月1日 20:00 | 按月同步，仅同步 `FACTOR_UNIVERSE_INDEX_CODES` 中的指数 |

实现要求：
- 继承现有 sync service 的模式（实现 `getPlans(): TushareSyncPlan[]`）
- 在 `SyncRegistryService` 中注册该新 service
- 支持 bootstrap 首次全量同步 + 增量日常同步
- STK_LIMIT 首次同步从 `TUSHARE_DEFAULT_SYNC_START_DATE` 开始
- INDEX_WEIGHT 首次同步从 `20150101` 开始（沪深300权重数据约从此时开始稳定）

---

## 五、因子计算引擎设计

### 5.1 内置因子注册表

系统启动时，通过 seed 脚本或 bootstrap 逻辑将内置因子写入 `factor_definitions` 表。共定义以下 **30+ 内置因子**：

#### 估值因子（VALUATION）

| name | label | sourceType | 计算方式 |
|------|-------|------------|---------|
| `pe_ttm` | 市盈率TTM | FIELD_REF | `DailyBasic.peTtm` |
| `pb` | 市净率 | FIELD_REF | `DailyBasic.pb` |
| `ps_ttm` | 市销率TTM | FIELD_REF | `DailyBasic.psTtm` |
| `dv_ttm` | 股息率TTM | FIELD_REF | `DailyBasic.dvTtm` |
| `ep` | 盈利收益率 | DERIVED | `1 / PE_TTM`，PE_TTM ≤ 0 时设为 null |
| `bp` | 账面市值比 | DERIVED | `1 / PB`，PB ≤ 0 时设为 null |

#### 规模因子（SIZE）

| name | label | sourceType | 计算方式 |
|------|-------|------------|---------|
| `ln_market_cap` | 对数总市值 | DERIVED | `LN(DailyBasic.totalMv * 10000)`，单位转为元后取对数 |
| `ln_circ_mv` | 对数流通市值 | DERIVED | `LN(DailyBasic.circMv * 10000)` |

#### 动量因子（MOMENTUM）

| name | label | sourceType | 计算方式 |
|------|-------|------------|---------|
| `ret_5d` | 5日收益率 | DERIVED | `(close_adj_today / close_adj_5d_ago) - 1` |
| `ret_20d` | 20日收益率 | DERIVED | `(close_adj_today / close_adj_20d_ago) - 1` |
| `ret_60d` | 60日收益率 | DERIVED | `(close_adj_today / close_adj_60d_ago) - 1` |
| `ret_120d` | 半年动量 | DERIVED | `(close_adj_today / close_adj_120d_ago) - 1` |
| `ret_250d` | 年动量 | DERIVED | `(close_adj_today / close_adj_250d_ago) - 1` |

> 注意：动量因子必须使用**后复权价格**（`close * adjFactor`）计算。

#### 波动率因子（VOLATILITY）

| name | label | sourceType | 计算方式 |
|------|-------|------------|---------|
| `volatility_20d` | 20日波动率 | DERIVED | 最近20个交易日日收益率的标准差 |
| `volatility_60d` | 60日波动率 | DERIVED | 最近60个交易日日收益率的标准差 |
| `amplitude_20d` | 20日平均振幅 | DERIVED | 最近20日 `(high - low) / preClose` 的均值 |

#### 流动性因子（LIQUIDITY）

| name | label | sourceType | 计算方式 |
|------|-------|------------|---------|
| `turnover_rate_f` | 自由流通换手率 | FIELD_REF | `DailyBasic.turnoverRateF` |
| `volume_ratio` | 量比 | FIELD_REF | `DailyBasic.volumeRatio` |
| `avg_amount_20d` | 20日平均成交额 | DERIVED | 最近20个交易日 `Daily.amount` 的均值 |
| `ln_avg_amount_20d` | 对数20日平均成交额 | DERIVED | `LN(avg_amount_20d)` |

#### 质量因子（QUALITY）

| name | label | sourceType | 计算方式 |
|------|-------|------------|---------|
| `roe` | 净资产收益率 | FIELD_REF | `FinaIndicator.roe`（取最新报告期） |
| `roe_dt` | 扣非ROE | FIELD_REF | `FinaIndicator.dtRoe` |
| `roa` | 总资产收益率 | FIELD_REF | `FinaIndicator.roa` |
| `net_profit_margin` | 净利率 | DERIVED | `FinaIndicator.nIncome / FinaIndicator.revenue`（取最新报告期） |
| `gross_profit_margin` | 毛利率 | DERIVED | `FinaIndicator.grossMargin`（取最新报告期） |

#### 成长因子（GROWTH）

| name | label | sourceType | 计算方式 |
|------|-------|------------|---------|
| `revenue_yoy` | 营收同比增长 | FIELD_REF | `FinaIndicator.revenueYoy` |
| `net_profit_yoy` | 净利润同比增长 | FIELD_REF | `FinaIndicator.netprofitYoy` |
| `roe_yoy` | ROE同比变化 | DERIVED | 当期ROE - 去年同期ROE |

#### 资金流因子（CAPITAL_FLOW）

| name | label | sourceType | 计算方式 |
|------|-------|------------|---------|
| `net_mf_amount` | 净流入金额 | FIELD_REF | `Moneyflow.netMfAmount` |
| `main_net_inflow` | 主力净流入 | DERIVED | `(buyLgAmount + buyElgAmount) - (sellLgAmount + sellElgAmount)` |
| `main_net_inflow_pct` | 主力净流入占比 | DERIVED | `main_net_inflow / (buySmAmount + buyMdAmount + buyLgAmount + buyElgAmount)` |

#### 杠杆因子（LEVERAGE）

| name | label | sourceType | 计算方式 |
|------|-------|------------|---------|
| `debt_to_assets` | 资产负债率 | FIELD_REF | `FinaIndicator.debtToAssets` |
| `current_ratio` | 流动比率 | FIELD_REF | `FinaIndicator.currentRatio` |
| `quick_ratio` | 速动比率 | FIELD_REF | `FinaIndicator.quickRatio` |

### 5.2 因子值计算逻辑

**核心原则**：因子值按需计算，不预存。通过 SQL 查询在请求时实时计算。

**计算流程**（以获取某因子在某日的截面值为例）：

```
输入: factorName, tradeDate, universe (可选的股票池)
1. 从 factor_definitions 获取因子定义
2. 根据 sourceType 分支:
   a. FIELD_REF → 直接查询 sourceTable WHERE tradeDate = ? (或最新报告期)
   b. DERIVED → 执行预定义的计算逻辑
3. 过滤:
   - 剔除当日停牌股票 (JOIN suspend_d)
   - 剔除当日涨跌停股票 (JOIN stk_limit WHERE close = up_limit OR close = down_limit)
   - 剔除 ST 股票 (stock_basic.name LIKE '%ST%')
   - 剔除上市不满 60 日的新股
4. 如果指定 universe → JOIN index_weight 过滤成分股
5. 返回: [{ tsCode, stockName, factorValue }]
```

**财务因子的日期对齐规则**：
- 财务指标（FinaIndicator/Income/BalanceSheet/Cashflow）是按报告期发布的，不是每日更新
- 对于某个交易日，使用该日期之前已公告的最新一期财报数据（Point-in-Time）
- 具体实现：`WHERE annDate <= tradeDate ORDER BY annDate DESC LIMIT 1`

### 5.3 FactorComputeService 结构

```
src/apps/factor/
├── factor.module.ts                  // NestJS 模块
├── factor.controller.ts              // REST 控制器
├── factor.service.ts                 // 业务编排层
├── services/
│   ├── factor-library.service.ts     // 因子库 CRUD
│   ├── factor-compute.service.ts     // 因子值计算引擎
│   ├── factor-analysis.service.ts    // IC/IR/分层回测等分析逻辑
│   └── factor-screening.service.ts   // 多因子选股
├── dto/
│   ├── factor-library.dto.ts         // 因子库相关 DTO
│   ├── factor-values.dto.ts          // 因子值查询 DTO
│   ├── factor-analysis.dto.ts        // 分析相关 DTO
│   └── factor-screening.dto.ts       // 选股相关 DTO
├── constants/
│   └── builtin-factors.constant.ts   // 内置因子定义数据
└── types/
    └── factor.types.ts               // 类型定义
```

---

## 六、API 接口设计

所有接口挂在 `/api/factor` 路径下。遵循项目现有约定（POST 方法、DTO 校验、`@UseGuards(JwtAuthGuard)`）。

### 6.1 因子库

#### `POST /api/factor/library`

获取因子库列表（支持按分类筛选）。

**Request Body:**

```typescript
class FactorLibraryQueryDto {
  @IsOptional()
  @IsEnum(FactorCategory)
  category?: FactorCategory;            // 按分类筛选

  @IsOptional()
  @IsBoolean()
  enabledOnly?: boolean = true;          // 仅返回已启用的因子
}
```

**Response:**

```typescript
{
  code: 200,
  data: {
    categories: [
      {
        category: "VALUATION",
        label: "估值因子",
        factors: [
          {
            id: "clxxx...",
            name: "pe_ttm",
            label: "市盈率TTM",
            description: "过去12个月滚动市盈率",
            category: "VALUATION",
            sourceType: "FIELD_REF",
            isBuiltin: true,
          },
          // ...
        ]
      },
      // ...更多分类
    ]
  }
}
```

#### `POST /api/factor/detail`

获取单个因子的详细信息。

**Request Body:**

```typescript
class FactorDetailDto {
  @IsString()
  factorName: string;                    // 因子名称标识
}
```

**Response:**

```typescript
{
  code: 200,
  data: {
    id: "clxxx...",
    name: "pe_ttm",
    label: "市盈率TTM",
    description: "过去12个月滚动市盈率，基于最近4个季度净利润计算...",
    category: "VALUATION",
    sourceType: "FIELD_REF",
    sourceTable: "DailyBasic",
    sourceField: "peTtm",
    isBuiltin: true,
    // 附加统计信息（可选）
    stats: {
      latestDate: "20260327",
      coverage: 0.95,           // 最新截面覆盖率
      mean: 25.3,
      median: 18.7,
      stdDev: 45.2,
    }
  }
}
```

### 6.2 因子值查询

#### `POST /api/factor/values`

获取指定因子在指定日期的全市场截面值。

**Request Body:**

```typescript
class FactorValuesQueryDto {
  @IsString()
  factorName: string;                    // 因子名称

  @IsString()
  @Matches(/^\d{8}$/)
  tradeDate: string;                     // 交易日 YYYYMMDD

  @IsOptional()
  @IsString()
  universe?: string;                     // 股票池，如 "000300.SH" (沪深300)，不传则全市场

  @IsOptional()
  @IsInt() @Min(1) @Max(100)
  page?: number = 1;

  @IsOptional()
  @IsInt() @Min(10) @Max(500)
  pageSize?: number = 50;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';  // 按因子值排序方向
}
```

**Response:**

```typescript
{
  code: 200,
  data: {
    factorName: "pe_ttm",
    tradeDate: "20260327",
    universe: "000300.SH",
    total: 300,
    page: 1,
    pageSize: 50,
    items: [
      {
        tsCode: "600519.SH",
        name: "贵州茅台",
        industry: "白酒",
        value: 28.53,                    // 因子原始值
        percentile: 0.72,               // 在截面中的百分位排名 (0~1)
      },
      // ...
    ],
    summary: {
      count: 287,                        // 有效值数量
      missing: 13,                       // 缺失数量
      mean: 32.5,
      median: 24.8,
      stdDev: 48.3,
      min: -120.5,
      max: 1580.0,
      q25: 15.2,
      q75: 38.6,
    }
  }
}
```

### 6.3 因子分析

#### `POST /api/factor/analysis/ic`

计算单因子 IC（Information Coefficient）时间序列。

**Request Body:**

```typescript
class FactorIcAnalysisDto {
  @IsString()
  factorName: string;                    // 因子名称

  @IsString() @Matches(/^\d{8}$/)
  startDate: string;                     // 分析起始日期

  @IsString() @Matches(/^\d{8}$/)
  endDate: string;                       // 分析结束日期

  @IsOptional()
  @IsString()
  universe?: string;                     // 股票池

  @IsOptional()
  @IsInt() @Min(1) @Max(60)
  forwardDays?: number = 5;             // 未来N日收益率（默认5日）

  @IsOptional()
  @IsEnum(['rank', 'normal'])
  icMethod?: 'rank' | 'normal' = 'rank'; // Rank IC (Spearman) 或 Normal IC (Pearson)
}
```

**计算逻辑**：
1. 对于分析期内的每个交易日 `t`：
   - 获取因子在日期 `t` 的截面值（剔除停牌/涨跌停/ST）
   - 计算每只股票未来 `forwardDays` 个交易日的收益率（使用后复权价格）
   - 计算因子值与未来收益率之间的 Spearman rank 相关系数 = 该日的 IC 值
2. 汇总 IC 时间序列统计

**Response:**

```typescript
{
  code: 200,
  data: {
    factorName: "pe_ttm",
    forwardDays: 5,
    icMethod: "rank",
    startDate: "20250101",
    endDate: "20260327",
    summary: {
      icMean: -0.032,                    // IC均值（负值说明低PE预测正收益）
      icStd: 0.058,                      // IC标准差
      icIr: -0.552,                      // ICIR = icMean / icStd
      icPositiveRate: 0.38,              // IC > 0 的比例
      icAboveThreshold: 0.25,            // |IC| > 0.03 的比例
      tStat: -3.42,                      // t统计量
    },
    series: [
      { tradeDate: "20250102", ic: -0.045, stockCount: 2850 },
      { tradeDate: "20250103", ic: -0.028, stockCount: 2842 },
      // ... 每个交易日一条
    ]
  }
}
```

#### `POST /api/factor/analysis/quantile`

因子分层回测：按因子值分组，计算各组的累计收益。

**Request Body:**

```typescript
class FactorQuantileAnalysisDto {
  @IsString()
  factorName: string;

  @IsString() @Matches(/^\d{8}$/)
  startDate: string;

  @IsString() @Matches(/^\d{8}$/)
  endDate: string;

  @IsOptional()
  @IsString()
  universe?: string;

  @IsOptional()
  @IsInt() @Min(3) @Max(10)
  quantiles?: number = 5;               // 分几组（默认5组=五分位）

  @IsOptional()
  @IsInt() @Min(1) @Max(20)
  rebalanceDays?: number = 5;           // 调仓周期（交易日）
}
```

**计算逻辑**：
1. 在每个调仓日 `t`：
   - 获取因子截面值，按值排序
   - 等分为 N 组（Q1=因子值最小组 ... QN=因子值最大组）
   - 每组内等权持有至下一个调仓日
   - 记录每组在此持仓期间的收益率
2. 计算各组的累计收益曲线
3. 计算多空组合收益 = QN - Q1（或按因子方向调整）

**Response:**

```typescript
{
  code: 200,
  data: {
    factorName: "pe_ttm",
    quantiles: 5,
    rebalanceDays: 5,
    startDate: "20250101",
    endDate: "20260327",
    // 各组累计收益曲线
    groups: [
      {
        group: "Q1",                     // 因子值最小组
        label: "低PE组",
        totalReturn: 0.185,              // 总收益率
        annualizedReturn: 0.152,         // 年化收益率
        maxDrawdown: -0.082,             // 最大回撤
        sharpeRatio: 1.23,               // 夏普比率
        series: [
          { tradeDate: "20250102", cumReturn: 0.002 },
          { tradeDate: "20250106", cumReturn: 0.008 },
          // ...
        ]
      },
      // Q2, Q3, Q4, Q5 ...
    ],
    // 多空组合 (QN - Q1)
    longShort: {
      totalReturn: 0.125,
      annualizedReturn: 0.102,
      maxDrawdown: -0.045,
      sharpeRatio: 1.85,
      series: [...]
    },
    // 基准收益（等权全市场或指定指数）
    benchmark: {
      totalReturn: 0.065,
      series: [...]
    }
  }
}
```

#### `POST /api/factor/analysis/decay`

因子衰减分析：测试因子在不同持有周期下的 IC。

**Request Body:**

```typescript
class FactorDecayAnalysisDto {
  @IsString()
  factorName: string;

  @IsString() @Matches(/^\d{8}$/)
  startDate: string;

  @IsString() @Matches(/^\d{8}$/)
  endDate: string;

  @IsOptional()
  @IsString()
  universe?: string;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  periods?: number[] = [1, 3, 5, 10, 20]; // 持有期列表（交易日）
}
```

**Response:**

```typescript
{
  code: 200,
  data: {
    factorName: "pe_ttm",
    results: [
      { period: 1,  icMean: -0.018, icIr: -0.31, icPositiveRate: 0.42 },
      { period: 3,  icMean: -0.025, icIr: -0.43, icPositiveRate: 0.40 },
      { period: 5,  icMean: -0.032, icIr: -0.55, icPositiveRate: 0.38 },
      { period: 10, icMean: -0.038, icIr: -0.62, icPositiveRate: 0.35 },
      { period: 20, icMean: -0.041, icIr: -0.58, icPositiveRate: 0.36 },
    ]
  }
}
```

#### `POST /api/factor/analysis/distribution`

获取因子在指定日期的分布统计和直方图数据。

**Request Body:**

```typescript
class FactorDistributionDto {
  @IsString()
  factorName: string;

  @IsString() @Matches(/^\d{8}$/)
  tradeDate: string;

  @IsOptional()
  @IsString()
  universe?: string;

  @IsOptional()
  @IsInt() @Min(10) @Max(100)
  bins?: number = 50;                    // 直方图的柱数
}
```

**Response:**

```typescript
{
  code: 200,
  data: {
    factorName: "pe_ttm",
    tradeDate: "20260327",
    stats: {
      count: 4856,
      missing: 144,
      missingRate: 0.029,
      mean: 32.5,
      median: 24.8,
      stdDev: 48.3,
      skewness: 4.2,
      kurtosis: 28.5,
      min: -120.5,
      max: 1580.0,
      q5: 8.2,
      q25: 15.2,
      q75: 38.6,
      q95: 85.4,
    },
    histogram: [
      { binStart: -120.5, binEnd: -86.5, count: 3 },
      { binStart: -86.5, binEnd: -52.5, count: 12 },
      // ... 50个bin
    ]
  }
}
```

#### `POST /api/factor/analysis/correlation`

计算多因子之间的相关性矩阵。

**Request Body:**

```typescript
class FactorCorrelationDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(2)
  @ArrayMaxSize(20)
  factorNames: string[];                 // 因子名称列表（2~20个）

  @IsString() @Matches(/^\d{8}$/)
  tradeDate: string;                     // 计算日期

  @IsOptional()
  @IsString()
  universe?: string;

  @IsOptional()
  @IsEnum(['spearman', 'pearson'])
  method?: 'spearman' | 'pearson' = 'spearman';
}
```

**Response:**

```typescript
{
  code: 200,
  data: {
    tradeDate: "20260327",
    method: "spearman",
    factors: ["pe_ttm", "pb", "roe", "ret_20d", "ln_market_cap"],
    matrix: [
      [1.000, 0.453, -0.215, 0.032, 0.678],
      [0.453, 1.000, -0.182, 0.018, 0.521],
      [-0.215, -0.182, 1.000, 0.045, 0.123],
      [0.032, 0.018, 0.045, 1.000, -0.089],
      [0.678, 0.521, 0.123, -0.089, 1.000],
    ]
  }
}
```

### 6.4 因子选股

#### `POST /api/factor/screening`

按因子条件组合选股。

**Request Body:**

```typescript
class FactorScreeningDto {
  @IsArray()
  @ValidateNested({ each: true })
  conditions: FactorCondition[];         // 筛选条件列表

  @IsString() @Matches(/^\d{8}$/)
  tradeDate: string;                     // 选股日期

  @IsOptional()
  @IsString()
  universe?: string;                     // 股票池

  @IsOptional()
  @IsString()
  sortBy?: string;                       // 按哪个因子排序

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsInt() @Min(1) @Max(100)
  page?: number = 1;

  @IsOptional()
  @IsInt() @Min(10) @Max(200)
  pageSize?: number = 50;
}

class FactorCondition {
  @IsString()
  factorName: string;                    // 因子名称

  @IsEnum(['gt', 'gte', 'lt', 'lte', 'between', 'top_pct', 'bottom_pct'])
  operator: string;                      // 比较方式

  @IsOptional()
  value?: number;                        // 阈值（gt/gte/lt/lte 使用）

  @IsOptional()
  min?: number;                          // 范围下界（between 使用）

  @IsOptional()
  max?: number;                          // 范围上界（between 使用）

  @IsOptional()
  percent?: number;                      // 百分位（top_pct/bottom_pct 使用，0~100）
}
```

**示例请求**（选出沪深300中PE_TTM < 20 且 ROE > 15% 的股票，按ROE降序排列）：

```json
{
  "tradeDate": "20260327",
  "universe": "000300.SH",
  "conditions": [
    { "factorName": "pe_ttm", "operator": "lt", "value": 20 },
    { "factorName": "roe", "operator": "gt", "value": 15 }
  ],
  "sortBy": "roe",
  "sortOrder": "desc"
}
```

**Response:**

```typescript
{
  code: 200,
  data: {
    tradeDate: "20260327",
    universe: "000300.SH",
    conditionCount: 2,
    total: 42,
    page: 1,
    pageSize: 50,
    items: [
      {
        tsCode: "600519.SH",
        name: "贵州茅台",
        industry: "白酒",
        factors: {
          pe_ttm: 18.5,
          roe: 32.1,
        }
      },
      // ...
    ]
  }
}
```

---

## 七、技术实现要点

### 7.1 性能优化策略

1. **SQL 计算优先**：所有 FIELD_REF 类型因子直接通过 Prisma raw SQL 查询，避免加载大量数据到 Node.js 内存
2. **分页必须**：因子截面值查询和选股查询必须支持分页
3. **Redis 缓存**：
   - 因子库列表缓存 1 小时
   - 因子截面值按 `factorName:tradeDate:universe` 缓存，每日过期
   - IC 分析结果按参数组合缓存 24 小时
4. **索引优化**：确保 `Daily`, `DailyBasic`, `FinaIndicator`, `Moneyflow` 表在 `tradeDate` 和 `tsCode` 上有联合索引（现有 schema 已满足）
5. **DERIVED 因子计算**：使用 PostgreSQL window function 计算动量/波动率等需要时序窗口的因子

### 7.2 错误处理

- 请求的交易日非交易日 → 自动向前找最近交易日
- 因子值全部为 null 或数量不足 → 返回警告信息
- 未知因子名 → 抛出 `NotFoundException`
- 财务因子在报告期之间 → 使用 Point-in-Time 逻辑

### 7.3 计算精度

- 所有浮点计算使用 `Decimal` 类型或 PostgreSQL `NUMERIC`
- IC 相关系数保留 6 位小数
- 收益率保留 6 位小数
- 百分位保留 4 位小数

---

## 八、实现优先级建议

分 3 个阶段，每个阶段独立可交付：

### Phase 1：数据基础 + 因子库

1. 新增 3 张 Prisma 表（StkLimit / SuspendD / IndexWeight）
2. 实现 3 个 Tushare 同步计划
3. 创建 FactorDefinition 表 + seed 内置因子
4. 实现因子库查询 API（`/factor/library` + `/factor/detail`）
5. 实现因子截面值查询 API（`/factor/values`）

### Phase 2：因子分析

6. 实现 IC 分析 API（`/factor/analysis/ic`）
7. 实现分层回测 API（`/factor/analysis/quantile`）
8. 实现因子衰减分析 API（`/factor/analysis/decay`）
9. 实现因子分布 API（`/factor/analysis/distribution`）
10. 实现因子相关性 API（`/factor/analysis/correlation`）

### Phase 3：因子选股

11. 实现多因子选股 API（`/factor/screening`）
12. Redis 缓存优化
13. 添加 WebSocket 推送（长时间分析任务的进度通知）
