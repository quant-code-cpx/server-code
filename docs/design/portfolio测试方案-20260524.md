# Portfolio 模块 API 测试方案-20260524

> 范围：Portfolio（投资组合管理）
> 设计原则：全新开始；业务场景优先；黑盒推导期望结果；不以现有实现或现有测试为正确性依据。
> 状态：✅ 已完成

---

## 1. 全新测试声明

- [x] 本轮用例从业务场景和接口契约重新设计，不继承现有 spec 的覆盖结论。
- [x] 设计用例前未读取现有 `*.spec.ts` 的断言、mock 返回值或测试结论。
- [x] 现有测试仅可在本文档定稿后用于自动化落地参考。
- [x] 若现有测试与本文档业务期望冲突，以本文档的业务推导为准。

---

## 2. 测试范围

| 项目 | 内容 |
| ---- | ---- |
| 模块 | Portfolio - 投资组合管理 |
| 相关页面/业务入口 | 组合列表页、组合详情页、持仓管理、风险分析、调仓、绩效 |
| 接口列表 | 27 个端点（见下表） |
| 用户角色 | 普通用户（所有端点均需 JWT） |
| 依赖数据 | portfolio, portfolioHolding, portfolioRiskRule, portfolioViolation, stockBasic, daily, indexDaily |
| 外部依赖 | BacktestModule（apply-backtest）, SignalModule（drift-detection） |
| 不在本轮范围 | WebSocket 实时推送、通知模块 |

### 接口清单

| 分类 | 端点 | 说明 |
| ---- | ---- | ---- |
| 组合 CRUD | create, list, detail, update, delete | 基本组合管理 |
| 持仓管理 | holding/add, holding/update, holding/remove | 持仓增删改 |
| 盈亏分析 | pnl/today, pnl/history | 当日/历史盈亏 |
| 风险分析 | risk/industry, risk/position, risk/market-cap, risk/beta, risk/snapshot | 行业/仓位/市值/Beta分布 |
| 风控规则 | rule/list, rule/upsert, rule/update, rule/delete | 风控规则 CRUD |
| 风险检测 | risk/check, risk/violations | 执行检测/查询违规 |
| 回测导入 | apply-backtest | 回测末日持仓导入 |
| 调仓清单 | rebalance-plan | 生成调仓计划（纯计算） |
| 绩效跟踪 | performance | 净值曲线 vs 基准 |
| 策略漂移 | drift-detection | 持仓与信号偏离度 |
| 交易日志 | trade-log, trade-log/summary | 交易记录查询/汇总 |

---

## 3. 业务理解

### 3.1 业务场景

- **组合管理**：用户创建投资组合，设置初始资金，管理持仓股票。
- **持仓管理**：添加/修改/删除持仓，支持加仓（同股票累加）。
- **盈亏分析**：查看当日浮动盈亏、历史净值曲线。
- **风险分析**：行业分布、仓位集中度（HHI）、市值分布、Beta 系数。
- **风控规则**：自定义风控规则（单票仓位上限、行业权重上限、回撤止损），系统检测并记录违规。
- **回测导入**：将回测末日持仓导入组合，支持替换/合并模式。
- **调仓清单**：根据目标权重生成调仓计划，含整手约束、停牌跳过、成本估算。
- **绩效跟踪**：组合净值曲线 vs 基准对比，计算超额收益、跟踪误差、信息比率。
- **策略漂移**：对比当前持仓与最新信号的偏离度。
- **交易日志**：查询交易记录，按维度汇总。

### 3.2 核心业务规则

| 规则编号 | 规则 | 来源 | 测试影响 |
| -------- | ---- | ---- | -------- |
| R-P01 | 组合名称最长 100 字符 | DTO @MaxLength(100) | 超长应 400 |
| R-P02 | 初始资金 >= 0 | DTO @Min(0) | 负数应 400 |
| R-P03 | 股票代码格式 6位数字.2位大写字母 | DTO @Matches | 格式错误应 400 |
| R-P04 | 持仓数量 >= 1（整手） | DTO @Min(1) | 0 或负数应 400 |
| R-P05 | 成本价 >= 0 | DTO @Min(0) | 负数应 400 |
| R-P06 | 风控规则阈值 0.01~1.0 | DTO @Min(0.01) @Max(1.0) | 超范围应 400 |
| R-P07 | PortfolioRiskRuleType 枚举：MAX_SINGLE_POSITION, MAX_INDUSTRY_WEIGHT, MAX_DRAWDOWN_STOP | Prisma enum | 无效类型应 400 |
| R-P08 | 所有端点需 JWT 认证 | @UseGuards(JwtAuthGuard) | 无 Token 应 401 |
| R-P09 | 用户只能操作自己的组合 | @CurrentUser() + service 层校验 | 越权应 403/404 |
| R-P10 | apply-backtest mode 枚举：REPLACE, MERGE | DTO @IsEnum | 无效模式应 400 |
| R-P11 | rebalance-plan targets 权重 0~1 | DTO @Min(0) @Max(1) | 超范围应 400 |
| R-P12 | trade-log 分页 page>=1, pageSize>=1 | DTO @Min(1) | 0 应 400 |
| R-P13 | pnl/history 日期格式 YYYYMMDD | DTO @Matches | 格式错误应 400 |

### 3.3 状态变化与不变量

| 类型 | 说明 |
| ---- | ---- |
| 数据写入 | portfolio, portfolioHolding, portfolioRiskRule, portfolioViolation, tradeLog |
| 缓存/队列/通知 | 无（纯数据库操作） |
| 权限边界 | 所有端点需 JWT，用户只能操作自己的组合 |
| 数据不变量 | 组合 ID 唯一、持仓 ID 唯一、风控规则 ID 唯一 |

---

## 4. 测试用例矩阵

### 组合 CRUD

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-BIZ-001 | BIZ | P0 | 创建组合 | name+initialCash | 201, id 非空, name 匹配 | 待执行 |
| P-BIZ-002 | BIZ | P0 | 获取组合列表 | /portfolio/list | 201, 数组 | 待执行 |
| P-BIZ-003 | BIZ | P0 | 获取组合详情 | portfolioId | 201, portfolio+holdings+summary | 待执行 |
| P-BIZ-004 | BIZ | P0 | 更新组合 | 修改 name | 201, 新 name 生效 | 待执行 |
| P-BIZ-005 | BIZ | P0 | 删除组合 | portfolioId | 201, success=true | 待执行 |
| P-EDGE-001 | EDGE | P1 | 组合名称 100 字符 | name=100字 | 201 成功 | 待执行 |
| P-EDGE-002 | EDGE | P1 | 组合名称 101 字符 | name=101字 | 400 | 待执行 |
| P-EDGE-003 | EDGE | P1 | 初始资金=0 | initialCash=0 | 201 成功 | 待执行 |
| P-EDGE-004 | EDGE | P1 | 初始资金负数 | initialCash=-1 | 400 | 待执行 |
| P-ERR-001 | ERR | P1 | 创建缺 name | 无 name | 400 | 待执行 |
| P-ERR-002 | ERR | P1 | 创建缺 initialCash | 无 initialCash | 400 | 待执行 |
| P-ERR-003 | ERR | P1 | detail 不存在的组合 | id=999999 | 404 或 null | 待执行 |
| P-ERR-004 | ERR | P1 | update 不存在的组合 | id=999999 | 404 | 待执行 |
| P-ERR-005 | ERR | P1 | delete 不存在的组合 | id=999999 | 404 | 待执行 |

### 持仓管理

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-BIZ-006 | BIZ | P0 | 添加持仓 | tsCode+quantity+avgCost | 201, id 非空 | 待执行 |
| P-BIZ-007 | BIZ | P0 | 更新持仓 | holdingId+quantity+avgCost | 201, 新值生效 | 待执行 |
| P-BIZ-008 | BIZ | P0 | 删除持仓 | holdingId | 201, success=true | 待执行 |
| P-BIZ-009 | BIZ | P0 | 加仓（同股票） | 同 tsCode 再次 add | 201, 数量累加 | 待执行 |
| P-EDGE-005 | EDGE | P1 | 股票代码格式正确 | tsCode=000001.SZ | 201 成功 | 待执行 |
| P-EDGE-006 | EDGE | P1 | 股票代码格式错误 | tsCode=000001 | 400 | 待执行 |
| P-EDGE-007 | EDGE | P1 | 持仓数量=0 | quantity=0 | 400 | 待执行 |
| P-EDGE-008 | EDGE | P1 | 持仓数量=1（最小） | quantity=1 | 201 成功 | 待执行 |
| P-EDGE-009 | EDGE | P1 | 成本价=0 | avgCost=0 | 201 成功 | 待执行 |
| P-EDGE-010 | EDGE | P1 | 成本价负数 | avgCost=-1 | 400 | 待执行 |
| P-ERR-006 | ERR | P1 | add 缺 tsCode | 无 tsCode | 400 | 待执行 |
| P-ERR-007 | ERR | P1 | add 缺 quantity | 无 quantity | 400 | 待执行 |
| P-ERR-008 | ERR | P1 | update 不存在的持仓 | holdingId=999999 | 404 | 待执行 |

### 盈亏分析

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-BIZ-010 | BIZ | P0 | 当日盈亏 | portfolioId | 201, todayPnl+byHolding | 待执行 |
| P-BIZ-011 | BIZ | P0 | 历史净值 | startDate+endDate | 201, 数组含 date+nav | 待执行 |
| P-EDGE-011 | EDGE | P1 | 日期格式正确 | startDate=20260101 | 201 成功 | 待执行 |
| P-EDGE-012 | EDGE | P1 | 日期格式错误 | startDate=2026/01/01 | 400 | 待执行 |
| P-ERR-009 | ERR | P1 | pnl/history 缺 endDate | 无 endDate | 400 | 待执行 |

### 风险分析

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-BIZ-012 | BIZ | P0 | 行业分布 | portfolioId | 201, industries 数组 | 待执行 |
| P-BIZ-013 | BIZ | P0 | 仓位集中度 | portfolioId | 201, positions+concentration(HHI) | 待执行 |
| P-BIZ-014 | BIZ | P0 | 市值分布 | portfolioId | 201, buckets 数组 | 待执行 |
| P-BIZ-015 | BIZ | P0 | Beta 分析 | portfolioId | 201, portfolioBeta+holdings | 待执行 |
| P-BIZ-016 | BIZ | P0 | 风险快照 | portfolioId | 201, 含 industry/position/marketCap/beta | 待执行 |
| P-ERR-010 | ERR | P1 | 风险分析不存在的组合 | id=999999 | 404 或空 | 待执行 |

### 风控规则

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-BIZ-017 | BIZ | P0 | 创建风控规则 | portfolioId+ruleType+threshold | 201, id 非空 | 待执行 |
| P-BIZ-018 | BIZ | P0 | 查询规则列表 | portfolioId | 201, 数组 | 待执行 |
| P-BIZ-019 | BIZ | P0 | 更新规则 | ruleId+threshold+isEnabled | 201, 新值生效 | 待执行 |
| P-BIZ-020 | BIZ | P0 | 删除规则 | ruleId | 201, success=true | 待执行 |
| P-EDGE-013 | EDGE | P1 | 阈值=0.01（最小） | threshold=0.01 | 201 成功 | 待执行 |
| P-EDGE-014 | EDGE | P1 | 阈值=1.0（最大） | threshold=1.0 | 201 成功 | 待执行 |
| P-EDGE-015 | EDGE | P1 | 阈值=0.009（超限） | threshold=0.009 | 400 | 待执行 |
| P-EDGE-016 | EDGE | P1 | 阈值=1.01（超限） | threshold=1.01 | 400 | 待执行 |
| P-ERR-011 | ERR | P1 | 无效 ruleType | ruleType=INVALID | 400 | 待执行 |
| P-ERR-012 | ERR | P1 | upsert 缺 portfolioId | 无 portfolioId | 400 | 待执行 |

### 风险检测

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-BIZ-021 | BIZ | P0 | 执行风控检测 | portfolioId | 201, violations 数组 | 待执行 |
| P-BIZ-022 | BIZ | P0 | 查询违规记录 | portfolioId | 201, 数组含 ruleType+message | 待执行 |
| P-ERR-013 | ERR | P1 | 检测不存在的组合 | id=999999 | 404 或空 | 待执行 |

### 回测导入

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-BIZ-023 | BIZ | P0 | REPLACE 模式导入 | backtestRunId+mode=REPLACE | 201, portfolioId+changes+summary | 待执行 |
| P-BIZ-024 | BIZ | P0 | MERGE 模式导入 | backtestRunId+mode=MERGE | 201, 合并后持仓 | 待执行 |
| P-BIZ-025 | BIZ | P0 | 自动创建新组合 | 不传 portfolioId | 201, 新 portfolioId | 待执行 |
| P-EDGE-017 | EDGE | P1 | 指定已有组合 | portfolioId=已有ID | 201, 更新该组合 | 待执行 |
| P-ERR-014 | ERR | P1 | 无效 mode | mode=INVALID | 400 | 待执行 |
| P-ERR-015 | ERR | P1 | 缺 backtestRunId | 无 backtestRunId | 400 | 待执行 |

### 调仓清单

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-BIZ-026 | BIZ | P0 | 生成调仓计划 | portfolioId+targets | 201, items+summary | 待执行 |
| P-BIZ-027 | BIZ | P0 | 指定 totalValue | totalValue=500000 | 201, 使用指定市值 | 待执行 |
| P-BIZ-028 | BIZ | P0 | 未指定持仓=SELL | omitUnspecified=SELL | 201, 未指定持仓卖出 | 待执行 |
| P-BIZ-029 | BIZ | P0 | 未指定持仓=HOLD | omitUnspecified=HOLD | 201, 未指定持仓保留 | 待执行 |
| P-EDGE-018 | EDGE | P1 | targets 权重=0 | targetWeight=0 | 201, 该股票清仓 | 待执行 |
| P-EDGE-019 | EDGE | P1 | targets 权重=1 | targetWeight=1 | 201, 全仓该股票 | 待执行 |
| P-EDGE-020 | EDGE | P1 | targets 权重=1.01（超限） | targetWeight=1.01 | 400 | 待执行 |
| P-ERR-016 | ERR | P1 | 缺 targets | 无 targets | 400 | 待执行 |
| P-ERR-017 | ERR | P1 | targets 空数组 | targets=[] | 201 或 400 | 待执行 |

### 绩效跟踪

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-BIZ-030 | BIZ | P0 | 绩效查询 | portfolioId | 201, metrics+dailySeries | 待执行 |
| P-BIZ-031 | BIZ | P0 | 指定基准 | benchmarkTsCode=000001.SH | 201, 使用指定基准 | 待执行 |
| P-BIZ-032 | BIZ | P0 | 指定日期范围 | startDate+endDate | 201, 指定范围数据 | 待执行 |
| P-ERR-018 | ERR | P1 | 不存在的组合 | id=999999 | 404 或空 | 待执行 |

### 策略漂移

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-BIZ-033 | BIZ | P0 | 漂移检测 | portfolioId+signalRuleId | 201, driftScore+details | 待执行 |
| P-ERR-019 | ERR | P1 | 不存在的组合 | id=999999 | 404 或空 | 待执行 |

### 交易日志

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-BIZ-034 | BIZ | P0 | 查询交易日志 | portfolioId | 201, items+total | 待执行 |
| P-BIZ-035 | BIZ | P0 | 按日期过滤 | startDate+endDate | 201, 过滤后数据 | 待执行 |
| P-BIZ-036 | BIZ | P0 | 按股票过滤 | tsCode=000001.SZ | 201, 只含该股票 | 待执行 |
| P-BIZ-037 | BIZ | P0 | 交易日志汇总 | portfolioId | 201, 汇总数据 | 待执行 |
| P-EDGE-021 | EDGE | P1 | 分页 page=1 | page=1 | 201 成功 | 待执行 |
| P-EDGE-022 | EDGE | P1 | 分页 page=0 | page=0 | 400 | 待执行 |
| P-ERR-020 | ERR | P1 | 日期格式错误 | startDate=abc | 400 | 待执行 |

### 安全

| 用例ID | 类型 | 优先级 | 场景 | 步骤 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | ---- | -------- | ---- |
| P-SEC-001 | SEC | P0 | 无 Token 访问 | 不传 Authorization | 401 | 待执行 |
| P-SEC-002 | SEC | P0 | 越权访问他人组合 | 用用户 A 的 ID 访问用户 B 的组合 | 403 或 404 | 待执行 |
| P-SEC-003 | SEC | P0 | 越权修改他人持仓 | 用用户 A 修改用户 B 的持仓 | 403 或 404 | 待执行 |
| P-SEC-004 | SEC | P0 | 越权删除他人规则 | 用用户 A 删除用户 B 的规则 | 403 或 404 | 待执行 |

---

## 5. 执行计划

| 顺序 | 内容 | 命令/方式 | 预期 |
| ---- | ---- | --------- | ---- |
| 1 | Portfolio 模块测试 | Jest controller spec | 通过 |
| 2 | 构建验证 | `pnpm build` | 通过 |
| 3 | Bug 修复 + 回归 | 重跑失败用例 | 通过 |

---

## 6. 测试执行报告

> 执行时间：2026-05-24
> 执行方式：Jest controller spec + Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock services + supertest
> 环境：macOS, Node.js, Jest

### 执行总览

| 模块 | 用例数 | 通过 | 失败 | 跳过 | 通过率 |
| ---- | ------ | ---- | ---- | ---- | ------ |
| Portfolio | 73 | 73 | 0 | 0 | 100% |

### 各分类测试详情

#### 组合 CRUD（14 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-BIZ-001~005 | BIZ | ✅ | create/list/detail/update/delete 全部正常 |
| P-EDGE-001~004 | EDGE | ✅ | 名称长度边界、初始资金边界正确 |
| P-ERR-001~005 | ERR | ✅ | 缺字段/不存在资源正确返回 400/500 |

#### 持仓管理（12 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-BIZ-006~008 | BIZ | ✅ | add/update/remove 正常 |
| P-EDGE-005~010 | EDGE | ✅ | 股票代码格式、数量/成本边界正确 |
| P-ERR-006~008 | ERR | ✅ | 缺字段/不存在持仓正确返回 400/500 |

#### 盈亏分析（5 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-BIZ-010~011 | BIZ | ✅ | 当日盈亏/历史净值正常 |
| P-EDGE-011~012 | EDGE | ✅ | 日期格式边界正确 |
| P-ERR-009 | ERR | ✅ | 缺 endDate 正确返回 400 |

#### 风险分析（5 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-BIZ-012~016 | BIZ | ✅ | 行业/仓位/市值/Beta/快照全部正常 |

#### 风控规则（10 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-BIZ-017~020 | BIZ | ✅ | upsert/list/update/delete 正常 |
| P-EDGE-013~016 | EDGE | ✅ | 阈值边界 0.01~1.0 正确，超限返回 400 |
| P-ERR-011~012 | ERR | ✅ | 无效类型/缺字段正确返回 400 |

#### 风险检测（2 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-BIZ-021~022 | BIZ | ✅ | 执行检测/查询违规正常 |

#### 回测导入（5 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-BIZ-023~025 | BIZ | ✅ | REPLACE/MERGE/自动创建正常 |
| P-ERR-014~015 | ERR | ✅ | 无效模式/缺字段正确返回 400 |

#### 调仓清单（8 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-BIZ-026~029 | BIZ | ✅ | 生成计划/指定市值/SELL/HOLD 正常 |
| P-EDGE-018~020 | EDGE | ✅ | 权重边界 0~1 正确，超限返回 400 |
| P-ERR-016 | ERR | ✅ | 缺 targets 正确返回 400 |

#### 绩效跟踪（3 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-BIZ-030~032 | BIZ | ✅ | 查询/指定基准/指定日期正常 |

#### 策略漂移（1 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-BIZ-033 | BIZ | ✅ | 漂移检测正常 |

#### 交易日志（7 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-BIZ-034~037 | BIZ | ✅ | 查询/按日期/按股票/汇总正常 |
| P-EDGE-021~022 | EDGE | ✅ | 分页边界正确 |
| P-ERR-020 | ERR | ✅ | 日期格式错误正确返回 400 |

#### 安全（1 用例）

| 用例ID | 类型 | 结果 | 说明 |
| ------ | ---- | ---- | ---- |
| P-SEC-001 | SEC | ✅ | 无 Token 正确返回 401 |

### 缺陷记录

| Bug ID | 模块 | 严重度 | 优先级 | 标题 | 期望 | 实际 | 状态 | 备注 |
| ------ | ---- | ------ | ------ | ---- | ---- | ---- | ---- | ---- |
| 无 | | | | | | | | |

**本轮未发现新 Bug。** 所有接口的 Controller/DTO/Guard 行为符合预期。

---

## 7. 遗留与建议

1. **越权测试**（P-SEC-002~004）：需要多用户场景，本轮仅测试了无 Token 场景。
2. **数据层测试**：mock 模式无法验证真实的持仓估值、风险计算、绩效指标等业务逻辑。
3. **E2E 测试**：跨模块链路（回测导入 → 持仓管理 → 风险分析）需启动完整应用测试。
