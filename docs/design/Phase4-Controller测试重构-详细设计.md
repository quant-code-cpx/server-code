# Phase 4 — Controller 层测试重构详细设计

> **对应文档**：[测试重构总纲](../测试重构总纲.md) §六 P3 — Controller 层与辅助功能
> **目标**：把现有 14 个 Controller spec（84 个用例，全部 happy-path）重构为带 DTO 校验、异常透传、权限边界的集成测试；同时为 6 个无 spec 的 Controller 新建测试文件。
> **预期产出**：~120 个新增用例（总计 ~200），覆盖 3 类核心场景：DTO 校验失败、Service 异常透传、权限/认证边界。

---

## 一、现状盘点

### 1.1 现有 Controller Spec 清单

| #   | Controller               | Spec 文件                                   | 现有用例 | 评级 | 主要问题                                                                |
| --- | ------------------------ | ------------------------------------------- | -------- | ---- | ----------------------------------------------------------------------- |
| 1   | AuthController           | ✅ auth.controller.spec.ts                  | 6        | D    | 已覆盖 happy-path + refresh 无 token，但未测 LoginDto 校验力度          |
| 2   | UserController           | ✅ user.controller.spec.ts                  | 16       | B-   | **最好的参考**：USER/ADMIN/未登录三组，但缺 SUPER_ADMIN 路径和 DTO 校验 |
| 3   | StrategyController       | ✅ strategy.controller.spec.ts              | 5        | D    | 纯 happy-path，未测 DTO 必填/枚举校验                                   |
| 4   | BacktestController       | ✅ backtest.controller.spec.ts              | 5        | D    | 纯 happy-path，未测 DTO 日期格式/金额下限                               |
| 5   | FactorController         | ✅ factor.controller.spec.ts                | 6        | D    | 纯 happy-path，21 个端点只测了 5 个                                     |
| 6   | StockController          | ✅ stock.controller.spec.ts                 | 7        | D    | 纯 happy-path                                                           |
| 7   | MarketController         | ✅ market.controller.spec.ts                | 4        | D    | 纯 happy-path                                                           |
| 8   | HeatmapController        | ✅ heatmap.controller.spec.ts               | 3        | D    | 纯 happy-path，SUPER_ADMIN 端点只测了 guard 放行                        |
| 9   | IndexController          | ✅ index.controller.spec.ts                 | 3        | D    | 纯 happy-path                                                           |
| 10  | WatchlistController      | ✅ watchlist.controller.spec.ts             | 7        | C+   | 有部分 happy-path                                                       |
| 11  | ResearchNoteController   | ✅ research-note.controller.spec.ts         | 7        | D    | 纯 happy-path                                                           |
| 12  | ScreenerSubscriptionCtrl | ✅ screener-subscription.controller.spec.ts | 8        | D    | 纯 happy-path                                                           |
| 13  | StrategyDraftController  | ✅ strategy-draft.controller.spec.ts        | 7        | D    | 纯 happy-path                                                           |
| 14  | TushareAdminController   | ✅ tushare-admin.controller.spec.ts         | 4        | C+   | 有 202 状态校验                                                         |

### 1.2 无 Spec 的 Controller

| #   | Controller                 | 端点数 | Guards              | 注入 Service 数 | 复杂度 |
| --- | -------------------------- | ------ | ------------------- | --------------- | ------ |
| 15  | PortfolioController        | 26     | JwtAuthGuard        | 8               | 🔴 高  |
| 16  | SignalController           | 5      | JwtAuthGuard        | 1               | 🟡 中  |
| 17  | AlertController            | 8      | RolesGuard          | 3               | 🟡 中  |
| 18  | ReportController           | 7      | JwtAuthGuard        | 1               | 🟢 低  |
| 19  | IndustryRotationController | 7      | 无                  | 1               | 🟢 低  |
| 20  | EventStudyController       | 9      | RolesGuard (选择性) | 2               | 🟡 中  |
| 21  | PatternController          | 3      | Bearer              | 1               | 🟢 低  |

### 1.3 基准数据

| 指标                   | 当前值                      |
| ---------------------- | --------------------------- |
| Controller spec 文件数 | 14 / 21                     |
| Controller 用例总数    | 84                          |
| 有 DTO 校验测试的 spec | 1 (auth 的 empty body 测试) |
| 有权限边界测试的 spec  | 1 (user — 三种角色)         |
| 有异常透传测试的 spec  | 1 (auth — refresh 无 token) |

---

## 二、核心设计原则

### 2.1 测试目标

Controller 集成测试验证的是 **NestJS 管道化处理链** 的正确性，而非业务逻辑本身：

```
HTTP Request
  → ValidationPipe（DTO 校验）
    → JwtAuthGuard / RolesGuard（认证授权）
      → Controller 方法（路由分发）
        → Service 调用（mock）
          → TransformInterceptor（统一包装）
            → GlobalExceptionsFilter（异常转换）
              → HTTP Response
```

**每个 Controller spec 必须覆盖以下三类场景**：

| 类别         | 缩写   | 验证对象         | 断言目标                                                          |
| ------------ | ------ | ---------------- | ----------------------------------------------------------------- |
| **DTO 校验** | `VAL`  | ValidationPipe   | 缺必填字段 → 400；枚举非法 → 400；格式不符 → 400                  |
| **异常透传** | `ERR`  | ExceptionsFilter | Service 抛 NotFoundException → 404；BusinessException → 对应 code |
| **权限边界** | `AUTH` | Guards           | 未登录 → 401；权限不足 → 403；ADMIN 端点普通 USER → 403           |

### 2.2 测试方法

**统一使用 `createTestApp()` 工厂**（[test/helpers/create-test-app.ts](../test/helpers/create-test-app.ts)）：

```typescript
import { createTestApp, buildTestUser } from 'test/helpers/create-test-app'

// 已内置：ValidationPipe + MockJwtGuard + RolesGuard + TransformInterceptor + GlobalExceptionsFilter
const { app, request } = await createTestApp({
  controllers: [XxxController],
  providers: [{ provide: XxxService, useValue: mockService }],
  user: buildTestUser({ role: UserRole.USER }), // 注入认证用户
})
```

**好处**：

- 与 `main.ts` 一致的管道链（ValidationPipe whitelist+transform, RolesGuard, TransformInterceptor, GlobalExceptionsFilter）
- Mock JWT Guard 自动处理 `@Public()`、注入 `request.user`、未登录抛 401
- 真正的 RolesGuard 实例（带 `ROLE_LEVEL` 层级检查）
- 通过修改 `user` 参数即可切换角色场景

### 2.3 断言规范

```typescript
// ✅ 正确：具体的业务值断言
expect(res.body.code).toBe(0)
expect(res.body.data.items).toHaveLength(3)
expect(res.body.data.total).toBe(42)

// ✅ 正确：DTO 校验错误包含字段名
expect(res.body.message).toEqual(expect.arrayContaining([expect.stringContaining('name')]))

// ✅ 正确：Service 调用参数验证
expect(mockService.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, name: '测试策略' }))

// ❌ 禁止：弱断言
expect(res.body.data).toBeDefined()
expect(mockService.create).toHaveBeenCalled()
```

### 2.4 现有 spec 改写策略

**不删除**现有 happy-path 用例，而是：

1. 迁移到 `createTestApp()` 工厂（替换手工 TestingModule 搭建）
2. 补充 `describe('[VAL] DTO 校验')` 分组
3. 补充 `describe('[ERR] 异常透传')` 分组
4. 补充 `describe('[AUTH] 权限边界')` 分组（仅对有 Guard 的 Controller）

---

## 三、全局基础设施增强

### 3.1 createTestApp 已有能力（无需改动）

| 能力                                   | 状态 | 说明                           |
| -------------------------------------- | ---- | ------------------------------ |
| ValidationPipe (whitelist + transform) | ✅   | DTO 校验自动生效               |
| Mock JWT Guard（@Public 支持）         | ✅   | 认证/未认证切换                |
| RolesGuard（ROLE_LEVEL 层级）          | ✅   | 真实权限检查                   |
| TransformInterceptor                   | ✅   | `{ code, data, message }` 包装 |
| GlobalExceptionsFilter                 | ✅   | 异常转 HTTP 状态码             |
| `buildTestUser(overrides)`             | ✅   | 快速构造不同角色               |

### 3.2 需要新增的测试工具

#### (a) mockServiceFactory — 按 Controller 依赖自动生成最小 mock

```typescript
// test/helpers/mock-service.ts
export function mockAllMethods<T extends object>(target: new (...args: any[]) => T): Record<string, jest.Mock> {
  const proto = target.prototype
  const methods = Object.getOwnPropertyNames(proto).filter((k) => k !== 'constructor' && typeof proto[k] === 'function')
  return Object.fromEntries(methods.map((m) => [m, jest.fn()]))
}
```

用法：

```typescript
const mockService = mockAllMethods(PortfolioService)
```

#### (b) expectValidationError — DTO 校验断言辅助

```typescript
// test/helpers/expect-validation.ts
export function expectValidationError(res: request.Response, ...fields: string[]) {
  expect(res.status).toBe(400)
  for (const field of fields) {
    expect(res.body.message).toEqual(expect.arrayContaining([expect.stringContaining(field)]))
  }
}
```

---

## 四、各 Controller 详细测试设计

### 分批策略

| 批次        | Controller 组合                                                        | 新增用例 | 说明                 |
| ----------- | ---------------------------------------------------------------------- | -------- | -------------------- |
| **Batch A** | Auth + User（改写）                                                    | +8       | 安全关键，最高优先   |
| **Batch B** | Strategy + Backtest（改写）                                            | +16      | 核心业务，DTO 最复杂 |
| **Batch C** | Portfolio + Signal（新建）                                             | +20      | 无 spec，端点最多    |
| **Batch D** | Alert + Report + EventStudy + Pattern（新建）                          | +24      | 无 spec，中等复杂    |
| **Batch E** | Factor + Stock + Market（改写）                                        | +18      | 端点多，DTO 简单     |
| **Batch F** | Heatmap + Index + IndustryRotation（改写/新建）                        | +12      | 简单                 |
| **Batch G** | Watchlist + ResearchNote + Subscription + Draft + TushareAdmin（改写） | +20      | 辅助模块             |

---

### Batch A — Auth + User Controller

#### A1. AuthController 改写

**现有**：6 用例（happy-path + empty body + refresh 无 token）
**改写目标**：迁移到 `createTestApp()`，补充 DTO 和异常路径

| #    | 分类  | 测试场景                                                        | 预期                                    | 说明                                             |
| ---- | ----- | --------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| A1-1 | `VAL` | POST /auth/login 空 body                                        | 201（@Allow 无校验，body 直达 service） | 文档化 LoginDto 的 @Allow 缺陷 — **[BUG P4-B1]** |
| A1-2 | `ERR` | POST /auth/login → Service 抛 UnauthorizedException             | HTTP 401 + 非零 code                    | 密码错误                                         |
| A1-3 | `ERR` | POST /auth/login → Service 抛 BusinessException(ACCOUNT_LOCKED) | HTTP 200 + 非零 code                    | 账户锁定                                         |
| A1-4 | `BIZ` | POST /auth/logout 无 Authorization header                       | HTTP 201 + code=0                       | logout 无 token 时仍应成功（幂等）               |

#### A2. UserController 增强

**现有**：16 用例（USER 6 + ADMIN 8 + 未登录 1）— 已是最佳参考
**增强目标**：补 SUPER_ADMIN 路径 + DTO 校验

| #    | 分类   | 测试场景                                          | 预期                          | 说明               |
| ---- | ------ | ------------------------------------------------- | ----------------------------- | ------------------ |
| A2-1 | `AUTH` | SUPER_ADMIN 访问所有 ADMIN 端点                   | 全部 201                      | 角色穿透           |
| A2-2 | `VAL`  | POST /user/create 缺 account                      | 400 + message 包含 'account'  | CreateUserDto 校验 |
| A2-3 | `VAL`  | POST /user/create 缺 password                     | 400 + message 包含 'password' |                    |
| A2-4 | `VAL`  | POST /user/create role 非法值                     | 400                           | @IsEnum(UserRole)  |
| A2-5 | `ERR`  | POST /user/detail → Service 抛 NotFoundException  | 404                           |                    |
| A2-6 | `VAL`  | POST /user/profile/change-password 缺 oldPassword | 400                           | ChangePasswordDto  |

---

### Batch B — Strategy + Backtest Controller

#### B1. StrategyController 改写

**现有**：5 用例
**改写目标**：迁移到 `createTestApp()`，补 DTO 校验 + 异常 + 未登录

| #    | 分类   | 测试场景                                     | 预期                        | 说明                           |
| ---- | ------ | -------------------------------------------- | --------------------------- | ------------------------------ |
| B1-1 | `VAL`  | POST /strategies/create 缺 name              | 400                         | @IsString @MinLength(1)        |
| B1-2 | `VAL`  | POST /strategies/create 缺 strategyType      | 400                         | @IsString @IsIn(...)           |
| B1-3 | `VAL`  | POST /strategies/create strategyType 非法值  | 400                         | @IsIn(BACKTEST_STRATEGY_TYPES) |
| B1-4 | `VAL`  | POST /strategies/create name 超长 (>100)     | 400                         | @MaxLength(100)                |
| B1-5 | `ERR`  | POST /strategies/detail → NotFoundException  | 404                         | 策略不存在                     |
| B1-6 | `ERR`  | POST /strategies/delete → ForbiddenException | 403                         | 越权删除                       |
| B1-7 | `AUTH` | 未登录访问 /strategies/create                | 401                         | JwtAuthGuard                   |
| B1-8 | `BIZ`  | POST /strategies/run → Service 传入了 userId | service.run 参数包含 userId | 验证 @CurrentUser 注入         |

#### B2. BacktestController 改写

**现有**：5 用例
**DTO 特点**：CreateBacktestRunDto 有 5 个必填字段 + 30+ 可选字段，日期需 YYYYMMDD 格式

| #    | 分类   | 测试场景                                                    | 预期 | 说明                               |
| ---- | ------ | ----------------------------------------------------------- | ---- | ---------------------------------- |
| B2-1 | `VAL`  | POST /backtests/runs 缺 strategyType                        | 400  | 必填                               |
| B2-2 | `VAL`  | POST /backtests/runs 缺 startDate                           | 400  | 必填                               |
| B2-3 | `VAL`  | POST /backtests/runs startDate='2024-01-01'                 | 400  | @Matches(/^\d{8}$/) 不接受横线格式 |
| B2-4 | `VAL`  | POST /backtests/runs initialCapital=500                     | 400  | @Min(1000)                         |
| B2-5 | `VAL`  | POST /backtests/runs strategyType='INVALID'                 | 400  | @IsEnum                            |
| B2-6 | `ERR`  | POST /backtests/runs/detail → NotFoundException             | 404  | runId 不存在                       |
| B2-7 | `ERR`  | POST /backtests/runs/cancel → 运行中取消 → Service 正常返回 | 201  |                                    |
| B2-8 | `AUTH` | 未登录访问 /backtests/runs                                  | 401  | JwtAuthGuard                       |

---

### Batch C — Portfolio + Signal Controller（新建）

#### C1. PortfolioController（新建 — 26 个端点，最大最复杂）

**依赖**：8 个 Service，需全部 mock
**Guard**：JwtAuthGuard（全局）

采用分组策略，按「功能域」组织测试：

| 组        | 端点                                            | 用例                    |
| --------- | ----------------------------------------------- | ----------------------- |
| 组合 CRUD | create/list/detail/update/delete                | 5 happy + 3 VAL + 2 ERR |
| 持仓管理  | holding/add, holding/update, holding/remove     | 3 happy + 3 VAL + 1 ERR |
| 盈亏查询  | pnl/today, pnl/history                          | 2 happy + 1 ERR         |
| 风控      | risk/_, rules/_                                 | 3 happy + 2 VAL + 1 ERR |
| 调仓      | rebalance-plan, apply-backtest, drift-detection | 3 happy + 2 VAL         |
| 权限      | 未登录                                          | 1 AUTH                  |

**详细用例**：

| #     | 分类   | 测试场景                                             | 预期                        | 说明                          |
| ----- | ------ | ---------------------------------------------------- | --------------------------- | ----------------------------- |
| C1-1  | `BIZ`  | POST /portfolio/create → 201                         | code=0, data 含 id          | happy-path                    |
| C1-2  | `BIZ`  | POST /portfolio/list → 201                           | code=0, data 为数组         |                               |
| C1-3  | `BIZ`  | POST /portfolio/detail → 201                         | code=0, data 含 portfolioId |                               |
| C1-4  | `VAL`  | POST /portfolio/create 缺 name                       | 400                         | @IsString @MaxLength(100)     |
| C1-5  | `VAL`  | POST /portfolio/create initialCash=-100              | 400                         | @IsNumber @Min(0)             |
| C1-6  | `VAL`  | POST /portfolio/holding/add tsCode='invalid'         | 400                         | @Matches(/^\d{6}\.[A-Z]{2}$/) |
| C1-7  | `VAL`  | POST /portfolio/holding/add quantity=0               | 400                         | @IsInt @Min(1)                |
| C1-8  | `VAL`  | POST /portfolio/holding/add avgCost=-1               | 400                         | @IsNumber @Min(0)             |
| C1-9  | `VAL`  | POST /portfolio/rules threshold=0                    | 400                         | @Min(0.01)                    |
| C1-10 | `VAL`  | POST /portfolio/rules threshold=2.0                  | 400                         | @Max(1.0)                     |
| C1-11 | `VAL`  | POST /portfolio/rebalance-plan 嵌套 targets 格式错误 | 400                         | @ValidateNested               |
| C1-12 | `ERR`  | POST /portfolio/detail → NotFoundException           | 404                         |                               |
| C1-13 | `ERR`  | POST /portfolio/delete → ForbiddenException          | 403                         | 越权                          |
| C1-14 | `ERR`  | POST /portfolio/holding/remove → NotFoundException   | 404                         | 持仓不存在                    |
| C1-15 | `AUTH` | 未登录访问 /portfolio/create                         | 401                         |                               |

#### C2. SignalController（新建）

| #    | 分类   | 测试场景                                               | 预期                  | 说明      |
| ---- | ------ | ------------------------------------------------------ | --------------------- | --------- |
| C2-1 | `BIZ`  | POST /signal/strategies/activate → 201                 | code=0                |           |
| C2-2 | `BIZ`  | POST /signal/strategies/list → 201                     | code=0, data 结构正确 |           |
| C2-3 | `BIZ`  | POST /signal/latest → 201                              | code=0                |           |
| C2-4 | `VAL`  | POST /signal/strategies/activate 缺 strategyId         | 400                   | @IsString |
| C2-5 | `ERR`  | POST /signal/strategies/deactivate → NotFoundException | 404                   |           |
| C2-6 | `AUTH` | 未登录访问 /signal/strategies/activate                 | 401                   |           |

---

### Batch D — Alert + Report + EventStudy + Pattern（新建）

#### D1. AlertController（新建）

**Guard**：RolesGuard（全局），部分端点需 ADMIN 角色

| #     | 分类   | 测试场景                                           | 预期                  | 说明                        |
| ----- | ------ | -------------------------------------------------- | --------------------- | --------------------------- |
| D1-1  | `BIZ`  | POST /alert/calendar/list → 201                    | code=0                |                             |
| D1-2  | `BIZ`  | POST /alert/price-rules → 201                      | code=0                | 创建价格预警                |
| D1-3  | `BIZ`  | POST /alert/price-rules/list → 201                 | code=0, data 结构正确 |                             |
| D1-4  | `VAL`  | POST /alert/calendar/list 缺 startDate             | 400                   | @Matches YYYYMMDD           |
| D1-5  | `VAL`  | POST /alert/calendar/list startDate='2024-01-01'   | 400                   | 格式不对                    |
| D1-6  | `VAL`  | POST /alert/price-rules 缺 ruleType                | 400                   | @IsEnum(PriceAlertRuleType) |
| D1-7  | `ERR`  | POST /alert/price-rules/update → NotFoundException | 404                   |                             |
| D1-8  | `AUTH` | USER 访问 /alert/price-rules/scan                  | 403                   | 需 ADMIN 角色               |
| D1-9  | `AUTH` | ADMIN 访问 /alert/price-rules/scan                 | 201                   | 角色穿透                    |
| D1-10 | `AUTH` | 未登录访问 /alert/calendar/list                    | 401                   |                             |

#### D2. ReportController（新建）

| #    | 分类   | 测试场景                                | 预期   | 说明                   |
| ---- | ------ | --------------------------------------- | ------ | ---------------------- |
| D2-1 | `BIZ`  | POST /report/backtest → 201             | code=0 |                        |
| D2-2 | `BIZ`  | POST /report/list → 201                 | code=0 |                        |
| D2-3 | `VAL`  | POST /report/backtest 缺 runId          | 400    | @IsString              |
| D2-4 | `VAL`  | POST /report/backtest format='DOCX'     | 400    | @IsEnum(JSON/HTML/PDF) |
| D2-5 | `ERR`  | POST /report/detail → NotFoundException | 404    |                        |
| D2-6 | `AUTH` | 未登录访问 /report/list                 | 401    |                        |

#### D3. EventStudyController（新建）

**Guard**：来自 `@ApiBearerAuth()`，signal-rules/scan 端点需 ADMIN

| #    | 分类   | 测试场景                                                  | 预期                | 说明                |
| ---- | ------ | --------------------------------------------------------- | ------------------- | ------------------- |
| D3-1 | `BIZ`  | POST /event-study/event-types/list → 201                  | code=0, data 为数组 |                     |
| D3-2 | `BIZ`  | POST /event-study/events → 201                            | code=0              |                     |
| D3-3 | `BIZ`  | POST /event-study/analyze → 201                           | code=0              |                     |
| D3-4 | `VAL`  | POST /event-study/analyze 缺 eventType                    | 400                 | @IsEnum(EventType)  |
| D3-5 | `VAL`  | POST /event-study/signal-rules 缺 name                    | 400                 | CreateSignalRuleDto |
| D3-6 | `ERR`  | POST /event-study/signal-rules/update → NotFoundException | 404                 |                     |
| D3-7 | `AUTH` | USER 访问 /event-study/signal-rules/scan                  | 403                 | 需 ADMIN 角色       |
| D3-8 | `AUTH` | 未登录访问 /event-study/events                            | 401                 |                     |

#### D4. PatternController（新建）

| #    | 分类   | 测试场景                                 | 预期                    | 说明     |
| ---- | ------ | ---------------------------------------- | ----------------------- | -------- |
| D4-1 | `BIZ`  | POST /pattern/templates/list → 201       | code=0, data 为模板数组 |          |
| D4-2 | `BIZ`  | POST /pattern/search → 201               | code=0                  |          |
| D4-3 | `VAL`  | POST /pattern/search 缺 tsCode           | 400                     |          |
| D4-4 | `ERR`  | POST /pattern/search → BusinessException | 对应 code               | 数据不足 |
| D4-5 | `AUTH` | 未登录访问 /pattern/search               | 401                     |          |

---

### Batch E — Factor + Stock + Market（改写）

#### E1. FactorController

**现有**：6 用例。21 个端点只测了 5 个。

| #    | 分类   | 测试场景                                   | 预期     | 说明          |
| ---- | ------ | ------------------------------------------ | -------- | ------------- |
| E1-1 | `VAL`  | POST /factor/values 缺 factorName          | 400      |               |
| E1-2 | `VAL`  | POST /factor/screening 缺 conditions       | 400      |               |
| E1-3 | `VAL`  | POST /factor/screening conditions 不是数组 | 400      | @IsArray      |
| E1-4 | `VAL`  | POST /factor/custom/create 缺 expression   | 400      |               |
| E1-5 | `ERR`  | POST /factor/detail → NotFoundException    | 404      |               |
| E1-6 | `AUTH` | 未登录访问 /factor/library                 | 401      |               |
| E1-7 | `BIZ`  | POST /factor/analysis/ic → 201             | 端点覆盖 | 补 happy-path |
| E1-8 | `BIZ`  | POST /factor/custom/create → 201           | 端点覆盖 | 补 happy-path |

#### E2. StockController

**现有**：7 用例。27 个端点只测了 6 个。
**Guard**：无全局 Guard（公开端点），部分端点用 @CurrentUser

| #    | 分类  | 测试场景                                    | 预期                            | 说明           |
| ---- | ----- | ------------------------------------------- | ------------------------------- | -------------- |
| E2-1 | `VAL` | POST /stock/detail 缺 ts_code               | 400                             | StockDetailDto |
| E2-2 | `VAL` | POST /stock/screener 缺 required 字段       | 400 或 201（视 DTO 是否全可选） |                |
| E2-3 | `VAL` | POST /stock/technical-indicators 缺 ts_code | 400                             |                |
| E2-4 | `ERR` | POST /stock/detail → NotFoundException      | 404                             | 股票不存在     |
| E2-5 | `BIZ` | POST /stock/screener → 201                  | code=0                          | 补 happy-path  |
| E2-6 | `BIZ` | POST /stock/concepts → 201                  | code=0                          | 补 happy-path  |
| E2-7 | `BIZ` | POST /stock/relative-strength → 201         | code=0                          | 补 happy-path  |

#### E3. MarketController

**现有**：4 用例。20 个端点只测了 4 个。
**Guard**：无（公开端点）

| #    | 分类  | 测试场景                                        | 预期   | 说明              |
| ---- | ----- | ----------------------------------------------- | ------ | ----------------- |
| E3-1 | `VAL` | POST /market/money-flow trade_date='2024-01-01' | 400    | @Matches YYYYMMDD |
| E3-2 | `VAL` | POST /market/sector-flow content_type='INVALID' | 400    | @IsEnum           |
| E3-3 | `BIZ` | POST /market/sentiment → 201                    | code=0 | 补端点覆盖        |
| E3-4 | `BIZ` | POST /market/valuation → 201                    | code=0 |                   |
| E3-5 | `BIZ` | POST /market/hsgt-flow → 201                    | code=0 |                   |

---

### Batch F — Heatmap + Index + IndustryRotation

#### F1. HeatmapController

**现有**：3 用例
**Guard**：snapshot/trigger 需 SUPER_ADMIN

| #    | 分类   | 测试场景                               | 预期                  | 说明              |
| ---- | ------ | -------------------------------------- | --------------------- | ----------------- |
| F1-1 | `VAL`  | POST /heatmap/data trade_date 格式错误 | 400                   |                   |
| F1-2 | `AUTH` | USER 访问 /heatmap/snapshot/trigger    | 403                   | 需 SUPER_ADMIN    |
| F1-3 | `AUTH` | 未登录访问 /heatmap/data               | 201（公开端点）或 401 | 取决于 Guard 配置 |

#### F2. IndexController

**现有**：3 用例

| #    | 分类  | 测试场景                                     | 预期 | 说明               |
| ---- | ----- | -------------------------------------------- | ---- | ------------------ |
| F2-1 | `VAL` | POST /index/daily 缺 ts_code                 | 400  | IndexDailyQueryDto |
| F2-2 | `VAL` | POST /index/constituents trade_date 格式错误 | 400  |                    |

#### F3. IndustryRotationController（新建）

**Guard**：无（公开端点）

| #    | 分类  | 测试场景                                           | 预期   | 说明 |
| ---- | ----- | -------------------------------------------------- | ------ | ---- |
| F3-1 | `BIZ` | POST /industry-rotation/return-comparison → 201    | code=0 |      |
| F3-2 | `BIZ` | POST /industry-rotation/momentum-ranking → 201     | code=0 |      |
| F3-3 | `BIZ` | POST /industry-rotation/overview → 201             | code=0 |      |
| F3-4 | `VAL` | POST /industry-rotation/detail 缺 industryName     | 400    |      |
| F3-5 | `ERR` | POST /industry-rotation/detail → NotFoundException | 404    |      |
| F3-6 | `BIZ` | POST /industry-rotation/valuation → 201            | code=0 |      |
| F3-7 | `BIZ` | POST /industry-rotation/heatmap → 201              | code=0 |      |

---

### Batch G — Watchlist + ResearchNote + Subscription + Draft + TushareAdmin

#### G1. WatchlistController

**现有**：7 用例。14 个端点。

| #    | 分类   | 测试场景                                   | 预期 | 说明 |
| ---- | ------ | ------------------------------------------ | ---- | ---- |
| G1-1 | `VAL`  | POST /watchlist/create 缺 name             | 400  |      |
| G1-2 | `VAL`  | POST /watchlist/stocks 缺 tsCode           | 400  |      |
| G1-3 | `ERR`  | POST /watchlist/delete → NotFoundException | 404  |      |
| G1-4 | `AUTH` | 未登录访问 /watchlist/list                 | 401  |      |

#### G2. ResearchNoteController

**现有**：7 用例

| #    | 分类   | 测试场景                                       | 预期         | 说明   |
| ---- | ------ | ---------------------------------------------- | ------------ | ------ |
| G2-1 | `VAL`  | POST /research-note/create 缺 title            | 400          |        |
| G2-2 | `VAL`  | POST /research-note/create content 超长        | 400 或无限制 | 视 DTO |
| G2-3 | `ERR`  | POST /research-note/detail → NotFoundException | 404          |        |
| G2-4 | `AUTH` | 未登录访问 /research-note/list                 | 401          |        |

#### G3. ScreenerSubscriptionController

**现有**：8 用例

| #    | 分类   | 测试场景                                              | 预期 | 说明 |
| ---- | ------ | ----------------------------------------------------- | ---- | ---- |
| G3-1 | `VAL`  | POST /screener-subscription/create 缺必填字段         | 400  |      |
| G3-2 | `ERR`  | POST /screener-subscription/pause → NotFoundException | 404  |      |
| G3-3 | `AUTH` | 未登录访问 /screener-subscription/list                | 401  |      |

#### G4. StrategyDraftController

**现有**：7 用例

| #    | 分类   | 测试场景                                        | 预期 | 说明           |
| ---- | ------ | ----------------------------------------------- | ---- | -------------- |
| G4-1 | `VAL`  | POST /strategy-draft/create 缺 name             | 400  |                |
| G4-2 | `ERR`  | POST /strategy-draft/detail → NotFoundException | 404  |                |
| G4-3 | `VAL`  | POST /strategy-draft/submit 缺 strategyType     | 400  | SubmitDraftDto |
| G4-4 | `AUTH` | 未登录访问 /strategy-draft/list                 | 401  |                |

#### G5. TushareAdminController

**现有**：4 用例
**Guard**：RolesGuard + @Roles(SUPER_ADMIN) 全局

| #    | 分类   | 测试场景                              | 预期 | 说明           |
| ---- | ------ | ------------------------------------- | ---- | -------------- |
| G5-1 | `AUTH` | USER 访问 /tushare/admin/plans        | 403  |                |
| G5-2 | `AUTH` | ADMIN 访问 /tushare/admin/plans       | 403  | 需 SUPER_ADMIN |
| G5-3 | `VAL`  | POST /tushare/admin/sync 缺 taskNames | 400  | ManualSyncDto  |

---

## 五、已知 Bug 与特殊标注

### 5.1 DTO 校验缺陷

| Bug ID    | 模块   | 问题                                                                         | 严重度  | 测试标注                          |
| --------- | ------ | ---------------------------------------------------------------------------- | ------- | --------------------------------- |
| **P4-B1** | Auth   | LoginDto 使用 `@Allow()` 装饰器，无任何校验 — 空 body 可直达 Service         | 🟠 中等 | 空 body → 201，标注 `[BUG P4-B1]` |
| **P4-B2** | Signal | LatestSignalQueryDto 的 date 字段用 `@IsString()` 而非 `@Matches(/^\d{8}$/)` | 🟡 低   | 随机字符串也通过                  |

### 5.2 Guard 配置观察

| Controller         | Guard 配置                              | 潜在风险                        | 测试覆盖                        |
| ------------------ | --------------------------------------- | ------------------------------- | ------------------------------- |
| Stock/Market/Index | 无 Guard                                | 公开端点，无认证 — 确认设计意图 | 验证公开访问不返回 401          |
| IndustryRotation   | 无 Guard                                | 公开端点 — 确认设计意图         | 同上                            |
| Heatmap            | 仅 snapshot/trigger 有 RolesGuard       | data 端点公开 — 确认设计意图    | 验证非 SUPER_ADMIN 触发快照被拒 |
| EventStudy         | `@ApiBearerAuth` 但无 class-level Guard | 依赖全局 APP_GUARD — 需确认     | 测试未登录是否 401              |

---

## 六、实施路径

### 6.1 执行顺序

```
Batch A (Auth + User)           →  验证框架搭建正确
  ↓
Batch B (Strategy + Backtest)   →  最复杂 DTO 校验
  ↓
Batch C (Portfolio + Signal)    →  最大新建文件
  ↓
Batch D (Alert + Report + EventStudy + Pattern)  →  新建文件
  ↓
Batch E (Factor + Stock + Market)  →  改写 + 补端点覆盖
  ↓
Batch F (Heatmap + Index + IndustryRotation)  →  简单改写/新建
  ↓
Batch G (辅助模块 x5)           →  统一收尾
```

### 6.2 每批验收标准

| 批次    | 验收标准                                                                         |
| ------- | -------------------------------------------------------------------------------- |
| Batch A | `createTestApp()` 工厂验证可用；Auth DTO @Allow 缺陷被记录；SUPER_ADMIN 路径通过 |
| Batch B | 所有 @Matches/@Min/@IsEnum DTO 校验有对应 400 测试                               |
| Batch C | 两个新 spec 文件覆盖全部端点 happy-path + 关键 VAL + ERR                         |
| Batch D | 四个新 spec 文件覆盖全部端点                                                     |
| Batch E | 三个改写文件端点覆盖率 > 50%；DTO 校验有测试                                     |
| Batch F | 全部端点有 happy-path；SUPER_ADMIN 边界有测试                                    |
| Batch G | 全部辅助模块有 VAL + ERR + AUTH 三类测试                                         |

### 6.3 预期产出

| 指标                   | 当前 | Phase 4 后   |
| ---------------------- | ---- | ------------ |
| Controller spec 文件数 | 14   | 21 (+7 新建) |
| Controller 用例总数    | 84   | ~200 (+~120) |
| 有 DTO 校验测试的 spec | 1    | 21 (100%)    |
| 有权限边界测试的 spec  | 1    | 15+          |
| 有异常透传测试的 spec  | 1    | 21 (100%)    |

---

## 七、Mock 策略约定

### 7.1 Service Mock 原则

```typescript
// 每个 Controller spec 的 Service mock 只需覆盖被测端点用到的方法
// 默认返回值遵循最小可用原则

// ✅ 推荐：用 mockResolvedValue 提供默认返回
const mockService = {
  create: jest.fn().mockResolvedValue({ id: 'test-1', name: 'test' }),
  list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  detail: jest.fn().mockResolvedValue({ id: 'test-1' }),
  // ...其他方法用 jest.fn() 即可
}

// ✅ 推荐：异常测试用 mockRejectedValueOnce（一次性覆盖）
mockService.detail.mockRejectedValueOnce(new NotFoundException('资源不存在'))
```

### 7.2 多 Service Controller 的 Mock

对于 PortfolioController（8 个 Service）、BacktestController（8 个 Service）等：

```typescript
// 按功能域分组 mock，用辅助函数减少样板代码
function buildPortfolioMocks() {
  return {
    portfolioService: { create: jest.fn(), list: jest.fn(), ... },
    riskService: { getIndustry: jest.fn(), ... },
    riskCheckService: { checkRisk: jest.fn(), ... },
    // ...
  }
}
```

---

## 八、与总纲的对应关系

| 总纲章节                        | 本设计覆盖内容                                              |
| ------------------------------- | ----------------------------------------------------------- |
| §六 6.1 Controller 测试重构策略 | 全部采纳，统一使用 createTestApp                            |
| §六 6.1 Controller 测试重构清单 | 全部 21 个 Controller 均已列出                              |
| §六 6.2 辅助模块测试重构        | Watchlist/ResearchNote/Alert 的 Controller 部分已包含       |
| §七 P4 Lifecycle 加固           | Guard/Filter/Interceptor 的边界在 Controller 测试中间接覆盖 |

---

## 附录 A：端点总数统计

| Controller           | 端点数  | 现有覆盖 | Phase 4 后预计覆盖          |
| -------------------- | ------- | -------- | --------------------------- |
| Auth                 | 4       | 4/4      | 4/4 + 4 VAL/ERR             |
| User                 | 11      | 11/11    | 11/11 + 6 VAL/ERR/AUTH      |
| Strategy             | 10      | 5/10     | 8/10 + 8 VAL/ERR/AUTH       |
| Backtest             | 20      | 5/20     | 8/20 + 8 VAL/ERR/AUTH       |
| Factor               | 21      | 5/21     | 10/21 + 6 VAL/ERR/AUTH      |
| Stock                | 27      | 6/27     | 10/27 + 4 VAL/ERR           |
| Market               | 20      | 4/20     | 8/20 + 2 VAL                |
| Heatmap              | 3       | 3/3      | 3/3 + 3 VAL/AUTH            |
| Index                | 3       | 3/3      | 3/3 + 2 VAL                 |
| Watchlist            | 14      | 7/14     | 8/14 + 4 VAL/ERR/AUTH       |
| ResearchNote         | 7       | 7/7      | 7/7 + 4 VAL/ERR/AUTH        |
| ScreenerSubscription | 8       | 8/8      | 8/8 + 3 VAL/ERR/AUTH        |
| StrategyDraft        | 6       | 6/6      | 6/6 + 4 VAL/ERR/AUTH        |
| TushareAdmin         | 8       | 4/8      | 5/8 + 3 VAL/AUTH            |
| **Portfolio**        | **26**  | **0/26** | **12/26 + 15 VAL/ERR/AUTH** |
| **Signal**           | **5**   | **0/5**  | **3/5 + 3 VAL/ERR/AUTH**    |
| **Alert**            | **8**   | **0/8**  | **4/8 + 6 VAL/ERR/AUTH**    |
| **Report**           | **7**   | **0/7**  | **3/7 + 3 VAL/ERR/AUTH**    |
| **IndustryRotation** | **7**   | **0/7**  | **5/7 + 2 VAL/ERR**         |
| **EventStudy**       | **9**   | **0/9**  | **4/9 + 4 VAL/ERR/AUTH**    |
| **Pattern**          | **3**   | **0/3**  | **2/3 + 3 VAL/ERR/AUTH**    |
| **总计**             | **221** | **84**   | **~200**                    |
