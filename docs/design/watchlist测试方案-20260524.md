# Watchlist 模块 API 测试方案-20260524

> 范围：Watchlist（自选股）
> 设计原则：全新开始；业务场景优先；黑盒推导期望结果；不以现有实现或现有测试为正确性依据。
> 状态：已完成

---

## 1. 测试范围

| 项目 | 内容 |
| ---- | ---- |
| 模块 | Watchlist - 自选股 |
| 接口列表 | 14 个端点 |
| 用户角色 | 全部需 JWT 认证 |
| 依赖数据 | watchlist, watchlistStock, stockBasic, stockDailyPrice |

### 接口清单

| 分类 | 端点 | 说明 |
| ---- | ---- | ---- |
| 自选组 | list | 获取用户所有自选组 |
| 自选组 | overview | 所有自选组快速概览 |
| 自选组 | create | 创建自选组 |
| 自选组 | reorder | 批量更新自选组排序 |
| 自选组 | update | 更新自选组 |
| 自选组 | delete | 删除自选组 |
| 成员 | stocks/list | 获取组内股票列表 |
| 成员 | stocks | 添加单只股票 |
| 成员 | stocks/batch | 批量添加股票 |
| 成员 | stocks/reorder | 批量更新股票排序 |
| 成员 | stocks/update | 更新股票备注/标签/目标价 |
| 成员 | stocks/batch/delete | 批量移除股票 |
| 成员 | stocks/delete | 移除单只股票 |
| 汇总 | summary | 获取自选组行情汇总 |

---

## 2. 核心业务规则

| 规则编号 | 规则 | 来源 | 测试影响 |
| -------- | ---- | ---- | -------- |
| R-WL01 | 所有端点需 JWT 认证 | @UseGuards(JwtAuthGuard) | 无 Token 应 401 |
| R-WL02 | create name 必填 1~50 字符 | DTO @IsString @MinLength(1) @MaxLength(50) | 空/超长应 400 |
| R-WL03 | create description 可选，最大 200 字符 | DTO @IsOptional @MaxLength(200) | 超长应 400 |
| R-WL04 | update name 可选 1~50 字符 | DTO @IsOptional @MinLength(1) @MaxLength(50) | 空字符串应 400 |
| R-WL05 | addStock tsCode 必须匹配 /^\d{6}\.(SH\|SZ\|BJ)$/ | DTO @Matches | 格式错误应 400 |
| R-WL06 | addStock notes 最大 500 字符 | DTO @MaxLength(500) | 超长应 400 |
| R-WL07 | addStock tags 最多 10 个，每个最长 30 字符 | DTO @ArrayMaxSize(10) @MaxLength(30) | 超限应 400 |
| R-WL08 | addStock targetPrice 最小 0 | DTO @Min(0) | 负数应 400 |
| R-WL09 | batchAdd stocks 必须 1~50 个 | DTO @ArrayMinSize(1) @ArrayMaxSize(50) | 空/超限应 400 |
| R-WL10 | batchRemove stockIds 必须 1~50 个 | DTO @ArrayMinSize(1) @ArrayMaxSize(50) | 空/超限应 400 |
| R-WL11 | reorder items 必须是数组 | DTO @IsArray @ValidateNested | 非数组应 400 |
| R-WL12 | updateStock notes 最大 500 字符 | DTO @MaxLength(500) | 超长应 400 |

---

## 3. 测试用例矩阵

### 自选组 CRUD

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| WL-BIZ-001 | BIZ | P0 | 获取自选组列表 | 201, 数组 | 通过 |
| WL-BIZ-002 | BIZ | P0 | 获取概览 | 201, watchlists 数组 | 通过 |
| WL-BIZ-003 | BIZ | P0 | 创建自选组 | 201, 自选组对象 | 通过 |
| WL-BIZ-004 | BIZ | P0 | 更新自选组 | 201, 更新后对象 | 通过 |
| WL-BIZ-005 | BIZ | P0 | 删除自选组 | 201, message | 通过 |
| WL-BIZ-006 | BIZ | P1 | 重排自选组 | 201, message | 通过 |
| WL-ERR-001 | ERR | P1 | create 缺 name | 400 | 通过 |
| WL-ERR-002 | ERR | P1 | create name 空 | 400 | 通过 |
| WL-ERR-003 | ERR | P1 | create name 超 50 字符 | 400 | 通过 |
| WL-ERR-004 | ERR | P1 | create description 超 200 字符 | 400 | 通过 |
| WL-ERR-005 | ERR | P1 | update name 空字符串 | 400 | 通过 |
| WL-EDGE-001 | EDGE | P1 | create name 恰好 50 字符 | 201 | 通过 |
| WL-EDGE-002 | EDGE | P1 | create description 恰好 200 字符 | 201 | 通过 |

### 股票成员管理

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| WL-BIZ-007 | BIZ | P0 | 获取组内股票列表 | 201, stocks 数组 | 通过 |
| WL-BIZ-008 | BIZ | P0 | 添加单只股票 | 201, 股票对象 | 通过 |
| WL-BIZ-009 | BIZ | P0 | 批量添加股票 | 201, added/skipped | 通过 |
| WL-BIZ-010 | BIZ | P0 | 更新股票备注 | 201, 更新后对象 | 通过 |
| WL-BIZ-011 | BIZ | P0 | 移除股票 | 201, message | 通过 |
| WL-BIZ-012 | BIZ | P0 | 批量移除股票 | 201, removed | 通过 |
| WL-BIZ-013 | BIZ | P1 | 重排股票 | 201, message | 通过 |
| WL-ERR-006 | ERR | P1 | addStock 缺 tsCode | 400 | 通过 |
| WL-ERR-007 | ERR | P1 | addStock tsCode 格式错误 | 400 | 通过 |
| WL-ERR-008 | ERR | P1 | addStock targetPrice 负数 | 400 | 通过 |
| WL-ERR-009 | ERR | P1 | addStock notes 超 500 字符 | 400 | 通过 |
| WL-ERR-010 | ERR | P1 | batchAdd stocks 空数组 | 400 | 通过 |
| WL-ERR-011 | ERR | P1 | batchAdd stocks 超 50 个 | 400 | 通过 |
| WL-ERR-012 | ERR | P1 | batchRemove stockIds 空数组 | 400 | 通过 |
| WL-ERR-013 | ERR | P1 | batchRemove stockIds 超 50 个 | 400 | 通过 |
| WL-ERR-014 | ERR | P1 | addStock tags 超 10 个 | 400 | 通过 |
| WL-ERR-015 | ERR | P1 | addStock tag 超 30 字符 | 400 | 通过 |
| WL-EDGE-003 | EDGE | P1 | addStock tsCode 北交所格式 | 201 | 通过 |
| WL-EDGE-004 | EDGE | P1 | batchAdd 恰好 50 个 | 201 | 通过 |
| WL-EDGE-005 | EDGE | P1 | batchRemove 恰好 50 个 | 201 | 通过 |
| WL-EDGE-006 | EDGE | P1 | addStock tags 恰好 10 个 | 201 | 通过 |
| WL-EDGE-007 | EDGE | P1 | addStock tag 恰好 30 字符 | 201 | 通过 |

### 汇总

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| WL-BIZ-014 | BIZ | P0 | 获取行情汇总 | 201, 汇总数据 | 通过 |

### 安全

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| WL-SEC-001 | SEC | P0 | 无 Token 访问 list | 401 | 通过 |
| WL-SEC-002 | SEC | P0 | 无 Token 创建自选组 | 401 | 通过 |
| WL-SEC-003 | SEC | P0 | 无 Token 添加股票 | 401 | 通过 |

---

## 4. 测试执行报告

> 执行时间：2026-05-24
> 执行方式：Jest controller spec + Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock services + supertest

### 执行总览

| 模块 | 用例数 | 通过 | 失败 | 跳过 | 通过率 |
| ---- | ------ | ---- | ---- | ---- | ------ |
| Watchlist | 39 | 39 | 0 | 0 | 100% |
