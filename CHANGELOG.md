# Changelog

本文件记录项目所有对外 API 的重要变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 规范。

版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)：**MAJOR.MINOR.PATCH**

- **MAJOR**：不兼容的 API 变更（字段删除、路由重命名、响应结构重构）
- **MINOR**：新增功能（新接口、新字段）且不破坏现有调用方
- **PATCH**：Bug 修复、性能优化、文档补充，不影响接口契约

---

## [Unreleased]

> 尚未发版的变更请记录于此处，发版时移至对应版本块。

---

## [0.1.0] - 待发版

### Added

#### 认证模块 `POST /auth/*`

- `POST /auth/login` — 用户名密码登录，返回 JWT AccessToken
- `POST /auth/register` — 注册新用户（username / password）
- `POST /auth/captcha` — 获取图片验证码（base64 格式）
- `POST /auth/refresh` — 用 RefreshToken 换取新 AccessToken
- `POST /auth/logout` — 注销登录，使 RefreshToken 失效

#### 用户模块 `POST /user/*`

- `POST /user/profile` — 获取当前用户资料
- `POST /user/update-profile` — 更新 username / email / avatar
- `POST /user/change-password` — 修改密码（需原密码验证）

#### 股票模块 `POST /stock/*`

- `POST /stock/list` — 股票筛选列表（分页、指标排序、多维过滤）
- `POST /stock/search` — 股票搜索（代码/名称模糊匹配）
- `POST /stock/detail/overview` — 股票概览（基本面 + 最新行情 + 估值 + 快报）
- `POST /stock/detail/chart` — K 线 / 行情走势图（支持前后复权）
- `POST /stock/detail/money-flow` — 个股资金流向明细
- `POST /stock/detail/financials` — 财务数据（利润表/资产负债表/现金流）
- `POST /stock/detail/holders` — 十大股东
- `POST /stock/detail/dividends` — 分红送股历史
- `POST /stock/detail/research-notes` — 关联研究报告
- `POST /stock/detail/forecasts` — 业绩预告
- `POST /stock/heatmap/snapshot` — 个股热力图快照
- `POST /stock/screener/run` — 运行选股策略
- `POST /stock/screener/strategies` — 获取选股策略列表
- `POST /stock/screener/strategies/subscribe` — 订阅选股策略
- `POST /stock/screener/strategies/unsubscribe` — 取消订阅选股策略

#### 市场模块 `POST /market/*`

- `POST /market/money-flow` — 大盘主力资金流向趋势
- `POST /market/sector-flow` — 行业/概念/地域板块资金流
- `POST /market/sentiment` — 市场涨跌情绪分布（涨停/大涨/大跌等）
- `POST /market/valuation` — 全市场估值概览（PE/PB/股息率）
- `POST /market/hsgt-flow` — 沪深港通资金流向
- `POST /market/index-quote` — 指数行情（上证/深证/创业板等）
- `POST /market/index-trend` — 指数涨跌趋势
- `POST /market/main-flow-ranking` — 主力资金排行榜
- `POST /market/concept-list` — 概念板块列表
- `POST /market/concept-members` — 概念板块成员

#### 组合管理 `POST /portfolio/*`

- `POST /portfolio/create` — 创建虚拟组合
- `POST /portfolio/list` — 获取我的组合列表
- `POST /portfolio/detail` — 组合详情（含持仓实时估值）
- `POST /portfolio/update` — 更新组合基本信息
- `POST /portfolio/delete` — 删除组合
- `POST /portfolio/holding/add` — 添加/加仓持仓
- `POST /portfolio/holding/update` — 修改持仓数量和成本
- `POST /portfolio/holding/remove` — 删除持仓
- `POST /portfolio/pnl/today` — 当日浮动盈亏
- `POST /portfolio/pnl/history` — 历史净值曲线
- `POST /portfolio/risk/industry` — 行业分布分析
- `POST /portfolio/risk/position` — 仓位集中度分析
- `POST /portfolio/risk/market-cap` — 市值分布分析
- `POST /portfolio/risk/beta` — Beta 系数分析
- `POST /portfolio/rule/list` — 获取风控规则列表
- `POST /portfolio/rule/upsert` — 创建或更新风控规则
- `POST /portfolio/rule/update` — 修改风控规则阈值/启用状态
- `POST /portfolio/rule/delete` — 删除风控规则
- `POST /portfolio/risk/check` — 执行风控规则检测
- `POST /portfolio/risk/violations` — 查询历史违规记录

#### 回测模块 `POST /backtest/*`

- `POST /backtest/validate` — 验证回测参数合法性
- `POST /backtest/run` — 提交回测任务（异步，返回 runId）
- `POST /backtest/list` — 获取回测任务列表（分页）
- `POST /backtest/detail` — 获取回测详情（含绩效指标 + 净值曲线）
- `POST /backtest/cancel` — 取消进行中的回测任务
- `POST /backtest/delete` — 删除回测记录

#### 因子模块 `POST /factor/*`

- `POST /factor/list` — 因子列表（分组 + 分页）
- `POST /factor/detail` — 因子详情
- `POST /factor/snapshot` — 因子截面快照（横截面因子得分）
- `POST /factor/correlation` — 因子相关矩阵
- `POST /factor/ic/series` — IC / ICIR 时序
- `POST /factor/ic/summary` — IC 汇总统计

#### 研究报告 `POST /research-note/*`

- `POST /research-note/create` — 新建研究笔记
- `POST /research-note/list` — 研究笔记列表
- `POST /research-note/detail` — 研究笔记详情
- `POST /research-note/update` — 更新研究笔记
- `POST /research-note/delete` — 删除研究笔记

#### 行业轮动 `POST /industry-rotation/*`

- `POST /industry-rotation/snapshot` — 行业轮动快照（行业动量 + 资金流 + 估值）
- `POST /industry-rotation/trend` — 行业轮动趋势（时序）

#### 关注列表 `POST /watchlist/*`

- `POST /watchlist/add` — 添加关注
- `POST /watchlist/remove` — 移除关注
- `POST /watchlist/list` — 获取关注列表

#### 数据同步管理 `POST /tushare-admin/*`（仅管理员）

- `POST /tushare-admin/sync/run` — 手动触发同步任务
- `POST /tushare-admin/sync/status` — 查询同步状态总览
- `POST /tushare-admin/sync/logs` — 查询同步日志

---

## [变更记录规范]

每次 API 发生以下变更时，须在此文件 `[Unreleased]` 区块记录：

| 变更类型     | 示例                                  |
| ------------ | ------------------------------------- |
| `Added`      | 新增接口或新字段                      |
| `Changed`    | 已有接口行为/响应结构调整（非破坏性） |
| `Deprecated` | 标记废弃（下一个 MAJOR 版本删除）     |
| `Removed`    | 删除接口或字段（MAJOR 版本变更）      |
| `Fixed`      | 接口 Bug 修复                         |
| `Security`   | 与鉴权/权限相关的修复                 |

### 记录格式示例

```markdown
## [Unreleased]

### Added

- `POST /stock/detail/news` — 新增股票新闻列表接口，返回字段：title, source, publishTime, url

### Changed

- `POST /stock/list` — `items[].pctChg` 由百分比小数（0.05）改为百分比整数（5.00），需调用方适配

### Deprecated

- `POST /market/hsgt-flow` 中 `buyAmount` 字段废弃，推荐使用 `netBuyAmount`（将在 v2.0.0 移除）

### Removed

- `POST /auth/login` 响应中移除废弃字段 `token`，使用 `accessToken` 替代
```

[Unreleased]: https://github.com/your-org/your-repo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/your-org/your-repo/releases/tag/v0.1.0
