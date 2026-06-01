# ScreenerSubscription 模块 API 测试方案-20260524

> 范围：ScreenerSubscription（条件订阅）
> 设计原则：全新开始；业务场景优先；黑盒推导期望结果；不以现有实现或现有测试为正确性依据。
> 状态：已完成

---

## 1. 测试范围

| 项目 | 内容 |
| ---- | ---- |
| 模块 | ScreenerSubscription - 条件订阅 |
| 接口列表 | 10 个端点 |
| 用户角色 | 全部需 JWT 认证 |
| 依赖数据 | screenerSubscription, screenerStrategy, screenerSubscriptionLog |

### 接口清单

| 分类 | 端点 | 说明 |
| ---- | ---- | ---- |
| 列表 | list | 获取用户所有条件订阅 |
| 详情 | detail | 获取单条订阅详情 |
| 创建 | create | 创建条件订阅 |
| 更新 | update | 更新条件订阅（名称/频率/条件/策略） |
| 删除 | delete | 删除条件订阅 |
| 状态 | pause, resume | 暂停/恢复订阅 |
| 执行 | run | 手动触发一次订阅执行 |
| 日志 | logs | 获取订阅执行日志（含股票元数据） |
| 校验 | validate | 检测是否存在重复/相似订阅 |

---

## 2. 核心业务规则

| 规则编号 | 规则 | 来源 | 测试影响 |
| -------- | ---- | ---- | -------- |
| R-SS01 | 所有端点需 JWT 认证 | @UseGuards(JwtAuthGuard) | 无 Token 应 401 |
| R-SS02 | create name 必填 1~50 字符 | DTO @IsString @MinLength(1) @MaxLength(50) | 缺失/空/超长应 400 |
| R-SS03 | create strategyId 和 filters 二选一 | Service 层校验 | 都缺应 400 |
| R-SS04 | frequency 必须是 SubscriptionFrequency 枚举 | DTO @IsEnum | 无效应 400 |
| R-SS05 | sortOrder 必须是 'asc' 或 'desc' | DTO @IsIn(['asc', 'desc']) | 无效应 400 |
| R-SS06 | filters 必须是对象 | DTO @IsObject | 非对象应 400 |
| R-SS07 | strategyId 必须是整数 | DTO @IsInt | 非整数应 400 |
| R-SS08 | logs page 默认 1，pageSize 默认 20，最大 50 | DTO @IsInt | 超范围应 400 |
| R-SS09 | validate id 必须是整数 | DTO @IsInt | 非整数应 400 |
| R-SS10 | 所有 id 参数必须是整数 | DTO @IsInt | 非整数应 400 |

---

## 3. 测试用例矩阵

### 列表

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SS-BIZ-001 | BIZ | P0 | 查询订阅列表 | 201, subscriptions 数组 | 通过 |
| SS-SEC-001 | SEC | P0 | 无 Token 查询列表 | 401 | 通过 |

### 详情

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SS-BIZ-002 | BIZ | P0 | 查询订阅详情 | 201, 订阅对象 | 通过 |
| SS-ERR-001 | ERR | P1 | detail 缺 id | 400 | 通过 |
| SS-ERR-002 | ERR | P1 | detail id 非整数 | 400 | 通过 |

### 创建

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SS-BIZ-003 | BIZ | P0 | 创建订阅（name+filters） | 201, 订阅对象 | 通过 |
| SS-BIZ-004 | BIZ | P0 | 创建订阅（name+strategyId） | 201, 订阅对象 | 通过 |
| SS-ERR-003 | ERR | P1 | create 缺 name | 400 | 通过 |
| SS-ERR-004 | ERR | P1 | create name 空 | 400 | 通过 |
| SS-ERR-005 | ERR | P1 | create name 超 50 字符 | 400 | 通过 |
| SS-ERR-006 | ERR | P1 | create filters 非对象 | 400 | 通过 |
| SS-ERR-007 | ERR | P1 | create strategyId 非整数 | 400 | 通过 |
| SS-ERR-008 | ERR | P1 | create 无效 frequency | 400 | 通过 |
| SS-ERR-009 | ERR | P1 | create 无效 sortOrder | 400 | 通过 |
| SS-EDGE-001 | EDGE | P1 | create name 1 字符 | 201 | 通过 |
| SS-EDGE-002 | EDGE | P1 | create name 50 字符 | 201 | 通过 |
| SS-EDGE-003 | EDGE | P1 | create name 51 字符应 400 | 400 | 通过 |

### 更新

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SS-BIZ-005 | BIZ | P0 | 更新订阅名称 | 201, 更新后对象 | 通过 |
| SS-BIZ-006 | BIZ | P0 | 更新订阅频率 | 201 | 通过 |
| SS-ERR-010 | ERR | P1 | update 缺 id | 400 | 通过 |
| SS-ERR-011 | ERR | P1 | update name 超 50 字符 | 400 | 通过 |
| SS-ERR-012 | ERR | P1 | update 无效 frequency | 400 | 通过 |

### 删除

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SS-BIZ-007 | BIZ | P0 | 删除订阅 | 201, message | 通过 |
| SS-ERR-013 | ERR | P1 | delete 缺 id | 400 | 通过 |

### 暂停/恢复

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SS-BIZ-008 | BIZ | P0 | 暂停订阅 | 201, status=PAUSED | 通过 |
| SS-BIZ-009 | BIZ | P0 | 恢复订阅 | 201, status=ACTIVE | 通过 |
| SS-ERR-014 | ERR | P1 | pause 缺 id | 400 | 通过 |
| SS-ERR-015 | ERR | P1 | resume 缺 id | 400 | 通过 |

### 手动执行

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SS-BIZ-010 | BIZ | P0 | 手动触发执行 | 201, jobId+message | 通过 |
| SS-ERR-016 | ERR | P1 | run 缺 id | 400 | 通过 |

### 日志

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SS-BIZ-011 | BIZ | P0 | 查询日志（默认分页） | 201, logs+total+page+pageSize | 通过 |
| SS-BIZ-012 | BIZ | P0 | 查询日志（自定义分页） | 201 | 通过 |
| SS-ERR-017 | ERR | P1 | logs 缺 id | 400 | 通过 |
| SS-EDGE-004 | EDGE | P1 | logs pageSize=50（最大） | 201 | 通过 |

### 校验

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SS-BIZ-013 | BIZ | P0 | 校验重复订阅 | 201, hasDuplicate+similarSubscriptions | 通过 |
| SS-BIZ-014 | BIZ | P0 | 校验无重复 | 201, hasDuplicate=false | 通过 |
| SS-EDGE-005 | EDGE | P1 | validate 传 id 排除自身 | 201 | 通过 |

---

## 4. 测试执行报告

> 执行时间：2026-05-24
> 执行方式：Jest controller spec + Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock services + supertest

### 执行总览

| 模块 | 用例数 | 通过 | 失败 | 跳过 | 通过率 |
| ---- | ------ | ---- | ---- | ---- | ------ |
| ScreenerSubscription | 37 | 37 | 0 | 0 | 100% |
