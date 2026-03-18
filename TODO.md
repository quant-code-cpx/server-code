# 量化研究后端 — 功能 ToDo List

> **使用说明**：每个模块下列出了核心任务，你可以把任意一条任务粘贴给 AI，它即可根据这份列表的上下文完成精准的开发。
> 格式：`- [ ]` 待开发，`- [x]` 已完成。

---

## 一、基础设施（已完成）

- [x] NestJS 骨架（ConfigModule / ThrottlerModule / Helmet / CORS）
- [x] Prisma + PostgreSQL 接入
- [x] Redis 接入
- [x] JWT 鉴权体系（AccessToken + RefreshToken）
- [x] 全局日志（Winston + 日志轮转）
- [x] 全局异常过滤器 & 响应拦截器
- [x] BullMQ 回测任务队列
- [x] WebSocket 实时推送

---

## 二、Tushare 数据模块 (`src/tushare/`)

- [x] `TushareService` — 封装 Tushare Pro HTTP 接口基础调用
- [x] `TushareSyncService` — 应用启动时检测数据新鲜度（入口已创建）
- [ ] 补充 `checkDataFreshness()` 各子检测方法：
  - [ ] `checkStockBasicFreshness()` — 检查股票基础信息是否最新（对比上市日期 / 数量变化）
  - [ ] `checkTradingCalendarFreshness()` — 检查交易日历是否覆盖到今天
  - [ ] `checkDailyFreshness()` — 检查日线行情最新日期是否等于最近交易日
  - [ ] `checkMoneyFlowFreshness()` — 检查资金流向数据是否最新
- [ ] 实现各 Tushare 接口封装方法（建议按接口分文件，放在 `src/tushare/apis/` 下）：
  - [ ] `stock_basic` — 股票基础信息列表
  - [ ] `trade_cal` — 交易日历
  - [ ] `daily` — 日线行情（OHLCV）
  - [ ] `daily_basic` — 每日基本面指标（PE / PB / 换手率 / 市值等）
  - [ ] `moneyflow` — 个股资金流向
  - [ ] `moneyflow_hsgt` — 沪深港通资金流向
  - [ ] `index_daily` — 指数日线行情
  - [ ] `stk_factor` — 技术因子（MACD / RSI / KDJ 等）
  - [ ] `concept` — 概念板块列表
  - [ ] `concept_detail` — 概念板块成分股

---

## 三、用户管理 (`src/apps/user/`) — 已完成

- [x] 用户注册
- [x] 用户列表查询
- [x] 用户详情查询
- [x] 用户软删除
- [ ] 修改昵称 / 密码
- [ ] 管理员角色与权限控制（RBAC）

---

## 四、股票管理 (`src/apps/stock/`) — 骨架已创建

- [x] 股票列表接口（按交易所 / 状态 / 行业筛选，骨架）
- [x] 股票详情接口（骨架）
- [ ] Prisma Schema 添加 `Stock` 模型（ts_code / name / industry / area / list_date 等）
- [ ] `StockService.findAll()` — 分页 + 多条件筛选，从数据库查询
- [ ] `StockService.findOne()` — 返回基础信息 + 最新日线行情
- [ ] 股票搜索接口（按代码 / 名称模糊匹配）
- [ ] 股票行情历史接口（日线 OHLCV + 成交额，支持日期范围）
- [ ] 股票基本面指标接口（PE / PB / 换手率 / 市值）
- [ ] 技术指标接口（MACD / RSI / KDJ / 布林带，数据来自 `stk_factor`）

---

## 五、市场与行业资金流向 (`src/apps/market/`) — 骨架已创建

- [x] 大盘资金流向接口（骨架）
- [x] 行业板块涨跌及资金流向接口（骨架）
- [ ] Prisma Schema 添加 `MarketMoneyFlow` 模型（来自 `moneyflow_hsgt`）
- [ ] Prisma Schema 添加 `SectorFlow` 模型（行业涨跌 + 净流入）
- [ ] `MarketService.getMarketMoneyFlow()` — 大盘净流入 / 流出趋势
- [ ] `MarketService.getSectorFlow()` — 行业板块涨跌幅排名 + 净流入 Top N
- [ ] 沪深港通（北向 / 南向）资金接口
- [ ] 龙虎榜数据接口（top_list / top_inst）
- [ ] 大宗交易数据接口（block_trade）
- [ ] 融资融券余额接口（margin）

---

## 六、热力图 (`src/apps/heatmap/`) — 骨架已创建

- [x] 热力图数据接口（骨架，支持按行业 / 概念板块分组）
- [ ] Prisma Schema 添加 `HeatmapSnapshot` 模型（存储每日聚合结果，避免实时聚合开销）
- [ ] `HeatmapService.getHeatmap()` — 返回每支股票的 `{ ts_code, name, change_pct, market_cap, group }` 节点数组
- [ ] 支持按行业（industry）/ 概念板块（concept）/ 指数（index）三种分组维度
- [ ] 历史某日热力图快照接口

---

## 七、指数与宏观数据 (`src/apps/index/`)

> 量化研究需要对标指数，以下模块建议尽早建立。

- [ ] 创建 `IndexModule`（指数行情模块）
- [ ] 支持的指数列表接口（沪深 300 / 中证 500 / 上证 50 / 创业板指等）
- [ ] 指数日线行情接口（来自 `index_daily`）
- [ ] 指数成分股接口（`index_weight`）

---

## 八、量化策略管理 (`src/apps/strategy/`)

- [ ] 创建 `StrategyModule`
- [ ] 策略 CRUD（创建 / 读取 / 更新 / 删除）
- [ ] Prisma Schema 添加 `Strategy` 模型（name / description / params / userId）
- [ ] 策略参数 JSON Schema 校验

---

## 九、回测系统 (`src/queue/backtesting/`) — 基础已完成

- [x] BullMQ 回测任务提交
- [x] 回测任务状态查询
- [ ] 回测结果持久化到数据库（`BacktestResult` 模型）
- [ ] 回测报告接口（收益曲线 / 最大回撤 / 夏普比率 / 胜率）
- [ ] WebSocket 实时推送回测进度

---

## 十、选股因子与因子分析 (`src/apps/factor/`)

- [ ] 创建 `FactorModule`
- [ ] 因子定义管理（alpha101 / 自定义公式）
- [ ] 单因子 IC / IR 分析接口（Information Coefficient）
- [ ] 因子截面排序接口（分位数分析）
- [ ] 多因子合成权重管理

---

## 十一、风险控制 (`src/apps/risk/`)

- [ ] 创建 `RiskModule`
- [ ] 组合持仓风险检测接口（集中度 / 行业暴露 / Beta）
- [ ] 止损触发规则管理

---

## 十二、实时行情推送 (`src/websocket/`) — 基础已完成

- [x] Socket.IO WebSocket 模块骨架
- [ ] 接入行情数据源（Tushare 实时 / 第三方 WebSocket）
- [ ] 按 ts_code 订阅 / 退订行情
- [ ] 大盘指数实时推送
- [ ] 成交量异动预警推送

---

## 十三、数据管理 & 运维接口 (`src/apps/admin/`)

- [ ] 创建 `AdminModule`（需要管理员权限，使用 Guard 保护）
- [ ] 手动触发数据同步接口（立即同步指定数据表）
- [ ] 数据同步日志查询接口
- [ ] 系统健康检查接口（`@nestjs/terminus`）

---

## 十四、通知 & 告警 (`src/apps/notification/`)

- [ ] 创建 `NotificationModule`
- [ ] 价格预警规则管理（设置涨跌幅阈值，触发时通知用户）
- [ ] 站内消息系统（基于 WebSocket 推送）
- [ ] 邮件 / 微信 Webhook 告警（可选）
