# 市场总览（Market Overview）功能规划

> 状态说明：❌ 未接入 | 🔧 部分完成 | ✅ 已完成

---

## 模块一览

| # | 模块 | Tushare 接口 | 积分要求 | 状态 |
|---|------|------------|---------|------|
| 1 | 核心指数行情 | `index_daily` | 2000 | ❌ |
| 2 | 大盘资金流向 | `moneyflow_mkt_dc` | 2000 | ✅ 已同步 |
| 3 | 行业/概念/地域板块流向 | `moneyflow_ind_dc` | 2000 | ✅ 已同步 |
| 4 | 市场情绪（涨跌家数统计） | 聚合 `daily` + `daily_basic` | 无需新接口 | ❌ 缺查询接口 |
| 5 | 市场整体估值（PE/PB 分位） | 聚合 `daily_basic` | 无需新接口 | ❌ 缺查询接口 |
| 6 | 涨跌停板数据 | `limit_list_d` | 2000 | ❌ |
| 7 | 北向/南向资金（沪深港通） | `moneyflow_hsgt` | 2000 | ❌ |

---

## 模块详细说明

### 模块 1：核心指数行情

**展示内容**
- 上证指数、深证成指、创业板指、沪深 300、中证 500 的当日收盘点位、涨跌幅、成交额

**涉及接口**
- `index_daily`：指数日线行情，参数 `ts_code` 或 `trade_date`

**关键字段**
```
ts_code, trade_date, close, pre_close, change, pct_chg, vol, amount
```

**开发任务**
- [ ] 新建 Prisma 模型 `IndexDaily`（参考 `tushare_daily.prisma`）
- [ ] 在 `TushareApiName` 枚举中加入 `INDEX_DAILY = 'index_daily'`
- [ ] 在 `MarketApiService` 中新增 `getIndexDailyByTradeDate()`
- [ ] 在 `market-sync.service.ts` 中新增核心指数同步逻辑（只同步固定的 5～10 个指数）
- [ ] 在 `MarketService` 中新增 `getIndexQuote()` 查询方法
- [ ] 在 `MarketController` 中新增 `POST /market/index-quote` 接口

**说明**：只需同步少量核心指数（不是全市场），避免积分浪费。

---

### 模块 2：大盘资金流向

**展示内容**
- 当日市场整体超大单/大单/中单/小单净流入（万元）
- 净流入率（%）
- 近 N 日净流入趋势折线图数据

**涉及接口**
- `moneyflow_mkt_dc`：东财大盘资金流向（已接入）

**开发任务**
- [x] Prisma 模型 `MoneyflowMktDc` 已建
- [x] 同步逻辑已在 `MoneyflowSyncService` 中实现
- [x] 查询接口 `POST /market/money-flow` 已实现
- [ ] （可选）补充"近 N 日趋势"接口：`POST /market/money-flow/history`

---

### 模块 3：行业 / 概念 / 地域板块流向

**展示内容**
- 行业板块涨跌幅排行（Top 10 上涨 / Top 10 下跌）
- 行业板块净流入排行（Top 10）
- 概念板块涨跌幅 / 净流入排行
- 地域板块涨跌幅排行

**涉及接口**
- `moneyflow_ind_dc`：东财行业/概念/地域资金流向（已接入）

**开发任务**
- [x] Prisma 模型 `MoneyflowIndDc` 已建
- [x] 同步逻辑已在 `MoneyflowSyncService` 中实现
- [x] 查询接口 `POST /market/sector-flow` 已实现（返回三分类全量数据）
- [ ] （可选）加入 `limit` 参数，支持 Top N 截断返回

---

### 模块 4：市场情绪（涨跌家数统计）

**展示内容**
- 全市场上涨 / 平盘 / 下跌家数
- 涨幅 ≥5%（涨停附近）、跌幅 ≥5%（跌停附近）的股票数量
- 近 N 日涨跌家数对比柱状图数据

**涉及接口**
- 直接聚合已有的 `daily`（`pct_chg` 字段）+ `stock_basic`（过滤正常上市股票）

**开发任务**
- [ ] 在 `MarketService` 中新增 `getMarketSentiment(tradeDate?)` 方法
  - 按 `pct_chg` 范围分桶统计：`< -5%`、`-5%~0%`、`0%`、`0%~5%`、`>= 5%`
- [ ] 在 `MarketController` 中新增 `POST /market/sentiment` 接口

---

### 模块 5：市场整体估值（PE/PB 分位）

**展示内容**
- 当日全市场 PE_TTM 中位数、PB 中位数
- 与近 1/3/5 年历史分位对比（显示目前是高估区/合理区/低估区）
- 沪深 300 / 中证 500 整体 PE/PB（需模块 1 的指数代码过滤）

**涉及接口**
- 聚合已有的 `daily_basic`（`pe_ttm`、`pb` 字段）

**开发任务**
- [ ] 在 `MarketService` 中新增 `getMarketValuation(tradeDate?)` 方法
  - 对当日全市场 `pe_ttm` / `pb` 做中位数聚合
  - 取历史区间计算历史分位（百分位数）
- [ ] 在 `MarketController` 中新增 `POST /market/valuation` 接口

---

### 模块 6：涨跌停板数据

**展示内容**
- 当日涨停家数、跌停家数
- 连板股明细（连续涨停天数 ≥ 2）
- 涨停开板率（涨停后炸板比例）

**涉及接口**
- `limit_list_d`：每日涨跌停股票列表

**关键字段**
```
trade_date, ts_code, name, close, pct_chg, amp, fc_ratio, fl_ratio, fd_amount,
first_time, last_time, open_times, strth, limit
```

**开发任务**
- [ ] 新建 Prisma 模型 `LimitListD`（参考 `tushare_daily.prisma`）
- [ ] 在 `TushareApiName` 枚举中加入 `LIMIT_LIST_D = 'limit_list_d'`
- [ ] 在 `MarketApiService` 中新增 `getLimitListByTradeDate()`
- [ ] 在 `market-sync.service.ts` 中新增同步逻辑
- [ ] 在 `MarketService` 中新增 `getLimitList()` 查询方法
- [ ] 在 `MarketController` 中新增 `POST /market/limit-list` 接口

**备注**：当前 `daily_basic.limit_status` 字段可临时用于统计涨跌停家数，但无明细和连板数据。

---

### 模块 7：北向 / 南向资金（沪深港通）

**展示内容**
- 北向资金当日净买入额（沪股通 + 深股通合计）
- 南向资金当日净买入额（港股通合计）
- 近 10 / 20 日北向资金流向趋势图

**涉及接口**
- `moneyflow_hsgt`：沪深港通资金流向

**关键字段**
```
trade_date, ggt_ss, ggt_sz, hgt, sgt, north_money, south_money
```

**开发任务**
- [ ] 新建 Prisma 模型 `MoneyflowHsgt`（参考 `tushare_moneyflow_mkt_dc.prisma`）
- [ ] 在 `TushareApiName` 枚举中加入 `MONEYFLOW_HSGT = 'moneyflow_hsgt'`
- [ ] 在 `MoneyflowApiService` 中新增 `getMoneyflowHsgtByDate()` 方法
- [ ] 在 `MoneyflowSyncService` 中新增同步逻辑
- [ ] 在 `MarketService` 中新增 `getHsgtFlow()` 查询方法
- [ ] 在 `MarketController` 中新增 `POST /market/hsgt-flow` 接口

---

## 实施优先级建议

```
阶段一（无需新接口，快速交付）：
  模块 4 - 市场情绪（涨跌家数）
  模块 5 - 市场整体估值（PE/PB 分位）

阶段二（最高价值的新接口）：
  模块 1 - 核心指数行情（index_daily）

阶段三（资金流向补全）：
  模块 7 - 北向/南向资金（moneyflow_hsgt）

阶段四（可选增强）：
  模块 6 - 涨跌停板明细（limit_list_d）
```

---

## 积分汇总

| 接口 | 积分门槛 | 是否已接入 |
|------|---------|----------|
| `moneyflow_mkt_dc` | 2000 | ✅ |
| `moneyflow_ind_dc` | 2000 | ✅ |
| `index_daily` | 2000 | ❌ |
| `moneyflow_hsgt` | 2000 | ❌ |
| `limit_list_d` | 2000 | ❌ |
| 聚合 `daily` / `daily_basic` | 无需新接口 | ✅ |

> 当前账户已达 2000 积分，所有未接入接口均满足积分条件，主要工作量在建表和同步逻辑。
