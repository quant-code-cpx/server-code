# StrategyDraft 模块 API 测试方案-20260524

> 范围：StrategyDraft（策略草稿箱）
> 设计原则：全新开始；业务场景优先；黑盒推导期望结果；不以现有实现或现有测试为正确性依据。
> 状态：已完成

---

## 1. 测试范围

| 项目 | 内容 |
| ---- | ---- |
| 模块 | StrategyDraft - 策略草稿箱 |
| 接口列表 | 6 个端点 |
| 用户角色 | 需 JWT 认证（全部端点） |
| 依赖数据 | strategyDraft, backtestRun |

### 接口清单

| 分类 | 端点 | 说明 |
| ---- | ---- | ---- |
| 列表 | list | 获取用户所有草稿（按更新时间倒序） |
| 详情 | detail | 获取单个草稿详情 |
| 创建 | create | 创建策略草稿 |
| 更新 | update | 更新草稿（前端自动保存） |
| 删除 | delete | 删除草稿 |
| 提交 | submit | 从草稿提交回测任务 |

---

## 2. 核心业务规则

| 规则编号 | 规则 | 来源 | 测试影响 |
| -------- | ---- | ---- | -------- |
| R-SD01 | 全部端点需 JWT 认证 | @UseGuards(JwtAuthGuard) | 无 Token 应 401 |
| R-SD02 | create name 必填，1~100 字符 | @IsString @MinLength(1) @MaxLength(100) | 缺失/空/超长应 400 |
| R-SD03 | create config 必填且为对象 | @IsObject | 缺失/非对象应 400 |
| R-SD04 | update name 可选，1~100 字符 | @IsOptional @IsString @MinLength(1) @MaxLength(100) | 超长应 400 |
| R-SD05 | update config 可选，需为对象 | @IsOptional @IsObject | 非对象应 400 |
| R-SD06 | submit name 可选，最长 128 字符 | @IsOptional @IsString @MaxLength(128) | 超长应 400 |
| R-SD07 | 每用户最多 20 个草稿 | Service 层硬编码 MAX_DRAFTS_PER_USER=20 | 超限应 400 |
| R-SD08 | 草稿名同名冲突 | Prisma P2002 唯一约束 | 重名应 409 |
| R-SD09 | 草稿不存在 | findFirst 返回 null | 应 404 |
| R-SD10 | submit 草稿 config 必须含 strategyType | Service 层校验 | 缺失应 400 |

---

## 3. 测试用例矩阵

### 草稿列表

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SD-BIZ-001 | BIZ | P0 | 查询草稿列表 | 201, { drafts: [...] } | 通过 |
| SD-BIZ-002 | BIZ | P0 | 空列表 | 201, { drafts: [] } | 通过 |

### 草稿详情

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SD-BIZ-003 | BIZ | P0 | 获取存在的草稿详情 | 201, 草稿对象 | 通过 |
| SD-ERR-001 | ERR | P1 | 草稿不存在 | 404 | 通过 |

### 创建草稿

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SD-BIZ-004 | BIZ | P0 | 正常创建草稿 | 201, 草稿对象 | 通过 |
| SD-ERR-002 | ERR | P1 | 创建缺 name | 400 | 通过 |
| SD-ERR-003 | ERR | P1 | 创建缺 config | 400 | 通过 |
| SD-ERR-004 | ERR | P1 | 创建 name 空字符串 | 400 | 通过 |
| SD-ERR-005 | ERR | P1 | 创建 name 超 100 字符 | 400 | 通过 |
| SD-ERR-006 | ERR | P1 | 创建 config 非对象 | 400 | 通过 |
| SD-ERR-007 | ERR | P1 | 创建重名草稿 | 409 | 通过 |
| SD-ERR-008 | ERR | P1 | 超过 20 个草稿上限 | 400 | 通过 |
| SD-EDGE-001 | EDGE | P1 | name 恰好 100 字符 | 201 | 通过 |
| SD-EDGE-002 | EDGE | P1 | name 恰好 1 字符 | 201 | 通过 |

### 更新草稿

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SD-BIZ-005 | BIZ | P0 | 更新草稿名称 | 201, 更新后草稿 | 通过 |
| SD-BIZ-006 | BIZ | P0 | 更新草稿配置 | 201, 更新后草稿 | 通过 |
| SD-ERR-009 | ERR | P1 | 更新不存在的草稿 | 404 | 通过 |
| SD-ERR-010 | ERR | P1 | 更新 name 超 100 字符 | 400 | 通过 |
| SD-ERR-011 | ERR | P1 | 更新 config 非对象 | 400 | 通过 |
| SD-ERR-012 | ERR | P1 | 更新重名草稿 | 409 | 通过 |

### 删除草稿

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SD-BIZ-007 | BIZ | P0 | 删除存在的草稿 | 201, { message: '...' } | 通过 |
| SD-ERR-013 | ERR | P1 | 删除不存在的草稿 | 404 | 通过 |

### 提交回测

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SD-BIZ-008 | BIZ | P0 | 正常提交草稿回测 | 201, 回测结果 | 通过 |
| SD-BIZ-009 | BIZ | P0 | 提交时指定回测名称 | 201, 使用指定名称 | 通过 |
| SD-ERR-014 | ERR | P1 | 提交不存在的草稿 | 404 | 通过 |
| SD-ERR-015 | ERR | P1 | 提交缺 strategyType | 400 | 通过 |
| SD-ERR-016 | ERR | P1 | 提交 name 超 128 字符 | 400 | 通过 |

### 安全

| 用例ID | 类型 | 优先级 | 场景 | 期望结果 | 状态 |
| ------ | ---- | ------ | ---- | -------- | ---- |
| SD-SEC-001 | SEC | P0 | 无 Token 访问 list | 401 | 通过 |

---

## 4. 测试执行报告

> 执行时间：2026-05-24
> 执行方式：Jest controller spec + Test.createTestingModule + overrideGuard(JwtAuthGuard) + mock services + supertest

### 执行总览

| 模块 | 用例数 | 通过 | 失败 | 跳过 | 通过率 |
| ---- | ------ | ---- | ---- | ---- | ------ |
| StrategyDraft | 28 | 28 | 0 | 0 | 100% |

### Bug 修复记录

| 编号 | 文件 | 问题 | 修复 |
| ---- | ---- | ---- | ---- |
| BUG-SD-01 | strategy-draft.dto.ts + strategy-draft.controller.ts | update/submit 端点使用 `Dto & { id: number }` 交集类型，TypeScript emitDecoratorMetadata 对交集类型发出 `Object` 而非具体 class，导致 ValidationPipe 无法校验 name/config 字段 | 将 `id` 字段直接加入 `UpdateStrategyDraftDto` 和 `SubmitDraftDto`，controller 移除交集类型 |
