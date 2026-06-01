# Industry-rotation 模块 API 测试方案-20260524

> 范围：Industry-rotation（行业轮动分析）
> 设计原则：全新开始；业务场景优先；黑盒推导期望结果；不以现有实现或现有测试为正确性依据。
> 状态：✅ 已完成

---

## 1. 测试范围

| 项目 | 内容 |
| ---- | ---- |
| 模块 | Industry-rotation - 行业轮动分析 |
| 接口列表 | 7 个端点 |
| 用户角色 | 公共端点（无需认证） |
| 依赖数据 | sector_capital_flows, valuation_daily_medians, sw_industry_members, stock_daily_prices, stock_daily_valuation_metrics |

### 接口清单

| 分类 | 端点 | 说明 |
| ---- | ---- | ---- |
| 收益对比 | return-comparison | 行业收益对比（多窗口收益率） |
| 动量排名 | momentum-ranking | 行业动量排名（加权/简单评分） |
| 资金流分析 | flow-analysis | 行业资金流转分析（累计/日均/动量） |
| 估值分位 | valuation | 行业估值分位（PE/PB 百分位） |
| 轮动总览 | overview | 行业轮动总览（收益/动量/资金/估值快照） |
| 行业详情 | detail | 单行业详情（趋势/资金流/估值/成分股） |
| 热力图 | heatmap | 行业轮动热力图（多窗口收益矩阵） |

---

## 2. 核心业务规则

| 规则编号 | 规则 | 来源 | 测试影响 |
| -------- | ---- | ---- | -------- |
| R-IR01 | trade_date 格式必须为 YYYYMMDD | DTO @Matches(/^\d{8}$/) | 格式错误应 400 |
| R-IR02 | periods 数组最多 5 个元素 | DTO @ArrayMaxSize(5) | 超过 5 个应 400 |
| R-IR03 | periods 每个元素范围 1~60 | DTO @Min(1) @Max(60) | 超范围应 400 |
| R-IR04 | sort_period 最小值 1 | DTO @Min(1) | 低于 1 应 400 |
| R-IR05 | order 必须是 asc/desc | DTO @IsEnum | 无效应 400 |
| R-IR06 | method 必须是 weighted/simple | DTO @IsEnum | 无效应 400 |
| R-IR07 | weights 必须恰好 3 个元素 | DTO @ArrayMinSize(3) @ArrayMaxSize(3) | 不是 3 个应 400 |
| R-IR08 | weights 每个元素最小 0.01 | DTO @Min(0.01) | 低于 0.01 应 400 |
| R-IR09 | limit 范围 1~100 | DTO @Min(1) @Max(100) | 超范围应 400 |
| R-IR10 | days（flow-analysis）范围 1~60 | DTO @Min(1) @Max(60) | 超范围应 400 |
| R-IR11 | sort_by（flow-analysis）必须是枚举值 | DTO @IsEnum | 无效应 400 |
| R-IR12 | sort_by（valuation）必须是枚举值 | DTO @IsEnum | 无效应 400 |
| R-IR13 | detail 的 tsCode 和 industry 至少传一个 | Service 逻辑 | 都不传返回空数据 |
| R-IR14 | detail 的 days 范围 5~60 | DTO @Min(5) @Max(60) | 超范围应 400 |
| R-IR15 | detail 的 tsCode/industry 传空字符串应 400 | DTO @IsNotEmpty | 空字符串应 400 |
| R-IR16 | 所有端点均为公共端点，无需 JWT | 无 @UseGuards | 无 Token 也能访问 |

---

## 3. 测试用例矩阵

### 收益对比 (return-comparison)

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| IR-BIZ-001 | BIZ | P0 | 空 body 查询（全默认） | 201, tradeDate+industries | ✅ 通过 |
| IR-BIZ-002 | BIZ | P0 | 指定 trade_date | 201 | ✅ 通过 |
| IR-BIZ-003 | BIZ | P0 | 自定义 periods | 201 | ✅ 通过 |
| IR-ERR-001 | ERR | P1 | trade_date 格式错误 | 400 | ✅ 通过 |
| IR-ERR-002 | ERR | P1 | periods 超过 5 个 | 400 | ✅ 通过 |
| IR-ERR-003 | ERR | P1 | periods 元素超出范围 | 400 | ✅ 通过 |
| IR-ERR-004 | ERR | P1 | sort_period < 1 | 400 | ✅ 通过 |
| IR-ERR-005 | ERR | P1 | order 无效值 | 400 | ✅ 通过 |
| IR-EDGE-001 | EDGE | P1 | periods 单个元素 | 201 | ✅ 通过 |
| IR-EDGE-002 | EDGE | P1 | periods 恰好 5 个 | 201 | ✅ 通过 |

### 动量排名 (momentum-ranking)

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| IR-BIZ-004 | BIZ | P0 | 空 body 查询 | 201, tradeDate+method+industries | ✅ 通过 |
| IR-BIZ-005 | BIZ | P0 | 指定 method=simple | 201 | ✅ 通过 |
| IR-BIZ-006 | BIZ | P0 | 指定 limit | 201 | ✅ 通过 |
| IR-ERR-006 | ERR | P1 | method 无效值 | 400 | ✅ 通过 |
| IR-ERR-007 | ERR | P1 | limit 超出范围 | 400 | ✅ 通过 |
| IR-ERR-008 | ERR | P1 | weights 不是 3 个元素 | 400 | ✅ 通过 |
| IR-ERR-009 | ERR | P1 | weights 元素低于 0.01 | 400 | ✅ 通过 |
| IR-EDGE-003 | EDGE | P1 | limit=1（最小） | 201 | ✅ 通过 |
| IR-EDGE-004 | EDGE | P1 | limit=100（最大） | 201 | ✅ 通过 |

### 资金流分析 (flow-analysis)

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| IR-BIZ-007 | BIZ | P0 | 空 body 查询 | 201, tradeDate+days+industries+summary | ✅ 通过 |
| IR-BIZ-008 | BIZ | P0 | 指定 days+sort_by | 201 | ✅ 通过 |
| IR-ERR-010 | ERR | P1 | days 超出范围 | 400 | ✅ 通过 |
| IR-ERR-011 | ERR | P1 | sort_by 无效值 | 400 | ✅ 通过 |
| IR-EDGE-005 | EDGE | P1 | days=1（最小） | 201 | ✅ 通过 |
| IR-EDGE-006 | EDGE | P1 | days=60（最大） | 201 | ✅ 通过 |

### 估值分位 (valuation)

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| IR-BIZ-009 | BIZ | P0 | 空 body 查询 | 201, tradeDate+industries | ✅ 通过 |
| IR-BIZ-010 | BIZ | P0 | 指定 industry 筛选 | 201 | ✅ 通过 |
| IR-ERR-012 | ERR | P1 | sort_by 无效值 | 400 | ✅ 通过 |

### 轮动总览 (overview)

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| IR-BIZ-011 | BIZ | P0 | 空 body 查询 | 201, 4 个 snapshot | ✅ 通过 |
| IR-BIZ-012 | BIZ | P0 | 指定 trade_date | 201 | ✅ 通过 |

### 单行业详情 (detail)

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| IR-BIZ-013 | BIZ | P0 | 按 tsCode 查询 | 201, industry+tsCode+trends+topStocks | ✅ 通过 |
| IR-BIZ-014 | BIZ | P0 | 按 industry 查询 | 201 | ✅ 通过 |
| IR-BIZ-015 | BIZ | P0 | tsCode 和 industry 都不传 | 201, 空数据 | ✅ 通过 |
| IR-ERR-013 | ERR | P1 | tsCode 空字符串 | 400 | ✅ 通过 |
| IR-ERR-014 | ERR | P1 | industry 空字符串 | 400 | ✅ 通过 |
| IR-ERR-015 | ERR | P1 | days 超出范围 | 400 | ✅ 通过 |
| IR-EDGE-007 | EDGE | P1 | days=5（最小） | 201 | ✅ 通过 |
| IR-EDGE-008 | EDGE | P1 | days=60（最大） | 201 | ✅ 通过 |

### 热力图 (heatmap)

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| IR-BIZ-016 | BIZ | P0 | 空 body 查询 | 201, tradeDate+periods+industries | ✅ 通过 |
| IR-BIZ-017 | BIZ | P0 | 自定义 periods | 201 | ✅ 通过 |

---

## 4. 测试执行报告

> 执行时间：2026-05-24
> 执行方式：Jest controller spec + Test.createTestingModule + useGlobalGuards(mock) + mock services + supertest

### 执行总览

| 模块 | 用例数 | 通过 | 失败 | 跳过 | 通过率 |
| ---- | ------ | ---- | ---- | ---- | ------ |
| Industry-rotation | 40 | 40 | 0 | 0 | 100% |
