# Notification 模块 API 测试方案-20260524

> 范围：Notification（站内消息通知）
> 设计原则：全新开始；业务场景优先；黑盒推导期望结果；不以现有实现或现有测试为正确性依据。
> 状态：✅ 已完成

---

## 1. 测试范围

| 项目 | 内容 |
| ---- | ---- |
| 模块 | Notification - 站内消息通知 |
| 接口列表 | 7 个端点 |
| 用户角色 | 全部需 JWT 认证 |
| 依赖数据 | notification, notificationPreference |

### 接口清单

| 分类 | 端点 | 说明 |
| ---- | ---- | ---- |
| 列表 | list | 获取通知列表（分页，支持仅显示未读） |
| 计数 | unread-count | 获取未读通知数 |
| 已读 | mark-read | 标记指定通知为已读 |
| 全部已读 | mark-all-read | 标记所有通知为已读 |
| 删除 | delete | 删除指定通知 |
| 偏好查询 | preferences | 获取通知偏好设置列表 |
| 偏好更新 | preferences/update | 更新通知偏好（按类型开关） |

---

## 2. 核心业务规则

| 规则编号 | 规则 | 来源 | 测试影响 |
| -------- | ---- | ---- | -------- |
| R-NT01 | page >= 1，默认 1 | DTO @IsInt @Min(1) | < 1 应 400 |
| R-NT02 | pageSize 1~100，默认 20 | DTO @IsInt @Min(1) @Max(100) | 超范围应 400 |
| R-NT03 | unreadOnly 可选布尔值 | DTO @IsOptional @Type(Boolean) | 非布尔应 400 |
| R-NT04 | mark-read id 必填，整数 | DTO @IsInt | 缺失/非整数应 400 |
| R-NT05 | delete 复用 MarkReadDto，id 必填 | DTO @IsInt | 缺失/非整数应 400 |
| R-NT06 | type 必须是 NotificationType 枚举值 | DTO @IsEnum | 无效应 400 |
| R-NT07 | enabled 必须是布尔值 | DTO @IsBoolean | 非布尔应 400 |
| R-NT08 | 所有端点需 JWT 认证 | @CurrentUser() | 无 Token 应 401 |
| R-NT09 | mark-read / delete 通知不存在或无权 | Service NotFoundException | 应 404 |

---

## 3. 测试用例矩阵

### 通知列表

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| NT-BIZ-001 | BIZ | P0 | 查询通知列表（默认分页） | 201, page+pageSize+total+unreadCount+items | ✅ 通过 |
| NT-BIZ-002 | BIZ | P0 | 查询未读通知列表 | 201, 仅未读消息 | ✅ 通过 |
| NT-ERR-001 | ERR | P1 | page=0 | 400 | ✅ 通过 |
| NT-ERR-002 | ERR | P1 | pageSize=0 | 400 | ✅ 通过 |
| NT-EDGE-001 | EDGE | P1 | pageSize=100（最大） | 201 | ✅ 通过 |
| NT-EDGE-002 | EDGE | P1 | pageSize=101 | 400 | ✅ 通过 |

### 未读计数

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| NT-BIZ-003 | BIZ | P0 | 获取未读通知数 | 201, unreadCount 字段 | ✅ 通过 |

### 标记已读

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| NT-BIZ-004 | BIZ | P0 | 标记指定通知已读 | 201, null | ✅ 通过 |
| NT-BIZ-005 | BIZ | P0 | 标记所有通知已读 | 201, null | ✅ 通过 |
| NT-ERR-003 | ERR | P1 | mark-read 缺 id | 400 | ✅ 通过 |
| NT-ERR-004 | ERR | P1 | mark-read id 非整数 | 400 | ✅ 通过 |

### 删除通知

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| NT-BIZ-006 | BIZ | P0 | 删除指定通知 | 201, null | ✅ 通过 |
| NT-ERR-005 | ERR | P1 | delete 缺 id | 400 | ✅ 通过 |
| NT-ERR-006 | ERR | P1 | delete id 非整数 | 400 | ✅ 通过 |

### 通知偏好

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| NT-BIZ-007 | BIZ | P0 | 获取通知偏好列表 | 201, 数组含 type+enabled | ✅ 通过 |
| NT-BIZ-008 | BIZ | P0 | 更新通知偏好 | 201, null | ✅ 通过 |
| NT-ERR-007 | ERR | P1 | update 缺 type | 400 | ✅ 通过 |
| NT-ERR-008 | ERR | P1 | update 缺 enabled | 400 | ✅ 通过 |
| NT-ERR-009 | ERR | P1 | update type 无效枚举 | 400 | ✅ 通过 |
| NT-ERR-010 | ERR | P1 | update enabled 非布尔 | 400 | ✅ 通过 |

### 安全

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| NT-SEC-001 | SEC | P0 | 无 Token 访问 list | 401 | ✅ 通过 |
| NT-SEC-002 | SEC | P0 | 无 Token 访问 unread-count | 401 | ✅ 通过 |

---

## 4. 测试执行报告

> 执行时间：2026-05-24
> 执行方式：Jest controller spec + Test.createTestingModule + useGlobalGuards(mock) + mock services + supertest

### 执行总览

| 模块 | 用例数 | 通过 | 失败 | 跳过 | 通过率 |
| ---- | ------ | ---- | ---- | ---- | ------ |
| Notification | 22 | 22 | 0 | 0 | 100% |
