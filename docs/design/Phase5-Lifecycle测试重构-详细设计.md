# Phase 5 — Lifecycle 与基础设施测试重构详细设计

> **对应文档**：[测试重构总纲](../测试重构总纲.md) §七 P4 — Lifecycle 与基础设施
> **目标**：把现有 6 个 Lifecycle spec（54 个用例，多数仅验证 happy-path 或纯 mock 调用）重构为覆盖安全边界、异常路径和并发场景的高质量测试；同时为 7 个无 spec 的基础设施组件新建测试文件。
> **预期产出**：~75 个新增/重写用例（总计 ~129），覆盖 4 类核心场景：安全防护、边界条件、错误处理、数据一致性。

---

## 一、现状盘点

### 1.1 已有 Spec 清单

| #   | 组件                   | Spec 文件                          | 现有用例 | 评级 | 主要问题                                           |
| --- | ---------------------- | ---------------------------------- | -------- | ---- | -------------------------------------------------- |
| 1   | JwtAuthGuard           | jwt-auth.guard.spec.ts             | 5        | B-   | 缺畸形 Token、PUBLIC_PATHS 白名单、user.id 缺失    |
| 2   | RolesGuard             | roles.guard.spec.ts                | 9        | B    | 缺伪造角色值、未知 role 值、ROLE_LEVEL 默认值 0     |
| 3   | TransformInterceptor   | transform.interceptor.spec.ts      | 6        | B+   | 边界覆盖较好，缺数组、0、空字符串等细微类型         |
| 4   | GlobalExceptionsFilter | global.exception.spec.ts           | 6        | B    | 缺 Prisma 异常、非 Error 异常、嵌套异常、null 异常 |
| 5   | EventsGateway          | events.gateway.spec.ts             | 18       | B+   | 纯 mock 调用验证，缺 token 提取边界、房间隔离       |
| 6   | BacktestingProcessor   | backtesting.processor.spec.ts      | 10       | B    | 缺 job.id 为 undefined、onFailed DB 写入失败        |

### 1.2 无 Spec 清单

| #   | 组件                    | 源文件                                   | 行数 | 复杂度 | 主要风险                                     |
| --- | ----------------------- | ---------------------------------------- | ---- | ------ | -------------------------------------------- |
| 7   | LoggingInterceptor      | lifecycle/interceptors/logging.interceptor.ts | 84   | 🟡 中  | 敏感字段脱敏、路径排除、异步日志副作用        |
| 8   | RequestContextService   | shared/context/request-context.service.ts     | 44   | 🟡 中  | AsyncLocalStorage 隔离、上下文缺失静默失败    |
| 9   | RequestContextMiddleware | shared/context/request-context.middleware.ts  | 25   | 🟢 低  | traceId 生成、响应头回写                      |
| 10  | RedisShutdownService    | shared/redis-shutdown.service.ts              | 31   | 🟢 低  | Redis 已关闭时重复 quit、quit 超时             |
| 11  | PrismaService           | shared/prisma.service.ts                      | 126  | 🔴 高  | URL 构建、连接池参数、慢查询检测、生命周期     |
| 12  | HealthController        | shared/health/health.controller.ts            | 32   | 🟢 低  | 存活/就绪探针行为                              |
| 13  | PrismaHealthIndicator   | shared/health/prisma.health.ts                | 22   | 🟢 低  | SELECT 1 失败时的 HealthCheckError             |
| 14  | RedisHealthIndicator    | shared/health/redis.health.ts                 | 26   | 🟢 低  | PING 响应非 PONG 的处理                        |
| 15  | HttpMetricsInterceptor  | shared/metrics/http-metrics.interceptor.ts    | 59   | 🟡 中  | 路径排除、路由提取回退、计数器/直方图准确性    |

### 1.3 基准数据

| 指标                    | 当前值             |
| ----------------------- | ------------------ |
| Lifecycle spec 文件数   | 6 / 15（含新增）   |
| Lifecycle 用例总数      | 54                 |
| 有安全边界测试的 spec   | 0                  |
| 有异常路径测试的 spec   | 2（部分）          |
| 有 AsyncLocalStorage 测试 | 0               |
| 无 spec 的组件          | 9                  |

---

## 二、源码审计 Bug 清单

### 2.1 严重度标准

| 等级   | 含义                                 | 举例                             |
| :----: | ------------------------------------ | -------------------------------- |
| **S1** | 安全风险或数据损坏                   | Token 绕过、敏感信息泄露         |
| **S2** | 功能行为错误，影响可观测性或可靠性   | 日志丢失、指标偏差、健康检查误判 |
| **S3** | 边界条件异常或设计瑕疵，不影响主流程 | 静默失败、类型窄化不足           |

### 2.2 Bug 清单

| Bug ID     | 严重度 | 模块                    | 位置                                              | 描述                                                                                                                                                                                                                                                                    |
| ---------- | :----: | ----------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P5-B1**  |   S1   | GlobalExceptionsFilter  | `catch()` L43-44                                  | 500 错误日志中 `(exception as Error).message` 和 `.stack` — 当 `exception` 不是 Error 实例时（如 `throw 'string'` 或 `throw null`），`.message` 返回 undefined，`.stack` 返回 undefined。日志系统记录无效信息，且响应 `message` 字段可能回退到 `String(exception)` 向客户端泄露原始异常内容。 |
| **P5-B2**  |   S1   | GlobalExceptionsFilter  | `catch()` L47-48                                  | 非 dev 模式下隐藏 500 错误消息依赖 `ErrorEnum.SERVER_ERROR.split(':')[1]`。若 ErrorEnum 值格式被修改（缺少冒号），`split(':')[1]` 返回 undefined → 客户端收到 `message: undefined`。虽然当前值正确，但缺少防御性检查。                                                  |
| **P5-B3**  |   S2   | LoggingInterceptor      | `sanitizeBody()` L10-18                           | 仅做浅层一级脱敏。若请求体为 `{ user: { password: '123' } }`，嵌套的 `password` 字段不会被脱敏，可能记录到日志中。                                                                                                                                                       |
| **P5-B4**  |   S3   | LoggingInterceptor      | `EXCLUDED_PATHS` L6                               | 使用 `url.startsWith(p)` 匹配。`/healthz`、`/health-check` 等路径也会被意外排除（前缀匹配而非完全匹配或 `startsWith(p + '?')` / `startsWith(p + '/')` 模式）。当前项目中不存在这些路径因此无实际影响，但设计上不够精确。                                                 |
| **P5-B5**  |   S3   | JwtAuthGuard            | `canActivate()` L30                               | `user?.id` 为 falsy 值（如 `0`）时不会调用 `setUserId()`。PostgreSQL 自增 ID 从 1 开始，因此 `id=0` 不应出现。但若系统使用 UUID 或其他 ID 方案，此条件可能不成立。当前无实际影响。                                                                                       |
| **P5-B6**  |   S2   | JwtAuthGuard            | `PUBLIC_PATHS` L9 + `canActivate()` L24           | `PUBLIC_PATHS` 使用 `startsWith` — `/metrics-debug`、`/metrics/custom` 等路径也会被放行。当前仅 `/metrics` 一条，影响范围有限，但若新增更多路径需注意前缀碰撞。                                                                                                         |
| **P5-B7**  |   S3   | RequestContextService   | `setUserId()` L38-42                              | 当上下文不存在时（非 HTTP 请求场景，如 Cron Job 或 WebSocket），`setUserId()` 静默无操作。调用方无法知道是否设置成功。这是有意设计（Cron 无 HTTP 上下文），但可能导致调试困难。                                                                                          |
| **P5-B8**  |   S2   | HttpMetricsInterceptor  | `extractRoute()` L56-57                           | 回退到 `request.url` 当 `request.route?.path` 不存在时。若请求命中 404（无匹配路由），`request.route` 为 undefined，此时回退到完整 URL（含查询参数和路径参数），导致 Prometheus label 基数爆炸。                                                                         |
| **P5-B9**  |   S3   | HttpMetricsInterceptor  | `EXCLUDED_PATHS` L8                               | 同 P5-B4，使用前缀匹配排除路径。                                                                                                                                                                                                                                        |
| **P5-B10** |   S3   | PrismaService           | `buildPrismaDatasourceUrl()` L86-108              | `new URL(databaseUrl)` — 若 `DATABASE_URL` 不是有效 URL 格式（如缺少协议头），`new URL()` 抛出 `TypeError`，导致应用启动失败且错误信息不够友好。                                                                                                                         |
| **P5-B11** |   S3   | PrismaService           | `readPositiveIntegerEnv()` L117-124               | 对负数不回退到 fallback（仅检查 `> 0`）。`PRISMA_CONNECTION_LIMIT=0` 或 `=-5` 正确回退；但 `=1.5` → `parseInt('1.5') = 1` → 通过检查 → 返回 1。此行为可接受但可能不符合"正整数"的严格语义。                                                                             |
| **P5-B12** |   S2   | BacktestingProcessor    | `process()` L61                                   | `job.id!` 使用非空断言。BullMQ 文档指出 `job.id` 可能为 `undefined`（当 job 未被完全持久化时）。若 `job.id` 为 undefined，后续 `emitBacktestProgress(undefined, ...)` 发送无效 jobId 到 WebSocket 客户端。                                                               |
| **P5-B13** |   S3   | BacktestingProcessor    | `onFailed()` L155                                 | 类型断言 `job.data as BacktestingJobData & WalkForwardJobData & ComparisonJobData` 不安全。若 job 实际数据是 `WalkForwardJobData`（无 `runId` 字段），`data.runId` 为 `undefined` → 跳过 DB 更新 → walkForward 运行状态可能滞留在 RUNNING。                               |
| **P5-B14** |   S2   | RedisShutdownService    | `onApplicationShutdown()` L28                     | `err?.message` — 若 `err` 是字符串或非 Error 类型，`.message` 为 undefined。日志记录 `Error closing Redis connection undefined`。                                                                                                                                       |
| **P5-B15** |   S3   | EventsGateway           | `extractUserId()` L72                             | 使用 `jwtService.decode(token)` 而非 `jwtService.verify(token)`。`decode` 不验证签名，任何人可以构造 JWT payload 加入任意 user 房间。WebSocket 不走 HTTP Guard 链，因此这是唯一的身份验证点。**这是一个安全设计问题**，但可能是有意为之（WS 权限模型由前端控制）。          |
| **P5-B16** |   S3   | EventsGateway           | WebSocket CORS L37                                | `cors: { origin: '*' }` — 允许任何来源连接 WebSocket，生产环境应限制为前端域名。（配置层面而非代码 bug）                                                                                                                                                                |

---

## 三、核心设计原则

### 3.1 测试目标

Lifecycle 层测试验证的是 **NestJS 请求处理管道**各环节的正确性与安全性，以及**应用基础设施**（数据库连接、缓存、可观测性）的可靠性：

```
HTTP Request
  → RequestContextMiddleware（注入 traceId）
    → ThrottlerGuard（限流）
      → JwtAuthGuard（认证 + PUBLIC 跳过）
        → RolesGuard（角色鉴权）
          → ValidationPipe（DTO 校验）
            → Controller 方法
              → LoggingInterceptor（请求日志）
              → HttpMetricsInterceptor（Prometheus 指标）
              → TransformInterceptor（响应包装）
                → GlobalExceptionsFilter（异常转换）
                  → HTTP Response

后台基础设施
  → PrismaService（DB 生命周期 + 慢查询指标）
  → RedisShutdownService（优雅关闭）
  → HealthController（存活/就绪探针）
  → EventsGateway（WebSocket 连接管理）
  → BacktestingProcessor（BullMQ 任务处理）
```

### 3.2 测试分类与覆盖要求

每个 Lifecycle 组件 spec 应覆盖以下类别：

| 类别             | 缩写   | 说明                                               | 最低覆盖 |
| ---------------- | ------ | -------------------------------------------------- | -------- |
| **安全防护**     | `SEC`  | Token 绕过、敏感信息泄露、角色伪造                  | 必须     |
| **业务规则验证** | `BIZ`  | Guard 放行/拒绝、Interceptor 包装、Filter 分发逻辑  | 必须     |
| **边界条件**     | `EDGE` | null/undefined 输入、空上下文、极端值               | 必须     |
| **错误处理**     | `ERR`  | 依赖故障、异常链、超时                              | 按需     |
| **数据一致性**   | `DATA` | 日志脱敏完整性、指标准确性、上下文传播              | 按需     |

### 3.3 断言强度标准

```typescript
// ❌ 弱断言（仅验证存在性或调用）
expect(mockLogger.log).toHaveBeenCalled()
expect(result).toBeDefined()

// ✅ 强断言（验证具体业务值）
expect(mockLogger.log).toHaveBeenCalledWith(
  expect.objectContaining({
    message: expect.stringMatching(/^POST \/api\/test 200 \d+ms$/),
    statusCode: 200,
    traceId: 'trace-123',
  }),
  'HTTP',
)

// ✅ 安全断言（验证敏感信息不泄露）
expect(responseJson.message).not.toContain('internal')
expect(logData.body.password).toBe('***')
```

---

## 四、已有 Spec 加固设计

### 4.1 JwtAuthGuard 加固

**文件**：`src/lifecycle/guard/test/jwt-auth.guard.spec.ts`
**现有**：5 用例
**新增**：+6 用例

| #  | 类别   | 测试场景                                                         | 预期                                       | 关联 Bug |
| -- | ------ | ---------------------------------------------------------------- | ------------------------------------------ | -------- |
| 6  | `SEC`  | PUBLIC_PATHS 白名单 — 请求 `/metrics` 跳过 JWT                   | 返回 true，不调用 super.canActivate        | —        |
| 7  | `SEC`  | PUBLIC_PATHS 前缀碰撞 — `/metrics-debug` 也被放行（假设路径） | 返回 true（记录当前行为，标注 P5-B6）       | P5-B6    |
| 8  | `EDGE` | user 对象存在但 user.id 为 undefined                             | 返回 true，但不调用 setUserId              | P5-B5    |
| 9  | `EDGE` | user 对象存在但 user.id 为 0                                     | 返回 true，不调用 setUserId（falsy 值）     | P5-B5    |
| 10 | `SEC`  | request.url 为 undefined（非标准请求对象）                       | 不崩溃，进入正常 JWT 验证流程              | —        |
| 11 | `BIZ`  | super.canActivate 返回 Observable/Promise（非 boolean）          | 正确 cast 为 boolean                       | —        |

```
describe('[SEC] PUBLIC_PATHS 白名单')
  it('[SEC] /metrics 路径跳过 JWT 验证')
    // 构造 request.url = '/metrics'
    // expect: true，super.canActivate 未调用

  it('[BUG P5-B6] /metrics-debug 也被前缀匹配放行（假设路径，验证 startsWith 行为）')
    // request.url = '/metrics-debug'
    // 当前行为：返回 true（跳过 JWT），因为 startsWith('/metrics') 成立
    // 正确行为：不应放行（非基础设施端点）

describe('[EDGE] user 对象边界')
  it('[EDGE] user.id 为 undefined → 不调用 setUserId')
    // super.canActivate 返回 true
    // request.user = { id: undefined, account: 'test', ... }
    // expect: setUserId 未被调用

  it('[EDGE] user.id 为 0 → 不调用 setUserId')
    // request.user = { id: 0, ... }
    // expect: setUserId 未被调用（0 是 falsy）

  it('[EDGE] request.url 为 undefined')
    // 不应抛出异常，应正常走 JWT 验证
```

### 4.2 RolesGuard 加固

**文件**：`src/lifecycle/guard/test/roles.guard.spec.ts`
**现有**：9 用例
**新增**：+3 用例

| #   | 类别   | 测试场景                                              | 预期                                | 关联 Bug |
| --- | ------ | ----------------------------------------------------- | ----------------------------------- | -------- |
| 10  | `SEC`  | user.role 为非枚举值（如 `'HACKER'`）                 | ROLE_LEVEL 默认 0，权限不足抛 403   | —        |
| 11  | `EDGE` | user 对象存在但 role 字段缺失（undefined）            | ROLE_LEVEL[undefined] ?? 0 = 0     | —        |
| 12  | `BIZ`  | 多个 requiredRoles 中只需满足一个即可（some 语义验证） | 清晰验证 `some` 而非 `every` 逻辑  | —        |

```
describe('[SEC] 角色伪造')
  it('[SEC] user.role 为非法值 "HACKER" → ROLE_LEVEL 默认 0 → 权限不足')
    // user = { role: 'HACKER' as any }
    // requiredRoles = [UserRole.USER]  (ROLE_LEVEL.USER = 1)
    // ROLE_LEVEL['HACKER'] = undefined → ?? 0
    // 0 >= 1 → false → ForbiddenException
    expect: throw ForbiddenException

  it('[EDGE] user.role 为 undefined → ROLE_LEVEL[undefined] ?? 0 → 权限不足')
    // user = { role: undefined as any }
    expect: throw ForbiddenException
```

### 4.3 TransformInterceptor 加固

**文件**：`src/lifecycle/interceptors/test/transform.interceptor.spec.ts`
**现有**：6 用例
**新增**：+3 用例

| #  | 类别   | 测试场景                       | 预期                                        |
| -- | ------ | ------------------------------ | ------------------------------------------- |
| 7  | `EDGE` | 空数组 `[]`                    | 包装为 `{ code: 0, data: [] }`              |
| 8  | `EDGE` | 数字 `0`                       | 包装为 `{ code: 0, data: 0 }`              |
| 9  | `EDGE` | 空字符串 `''`                  | 包装为 `{ code: 0, data: '' }`             |

```
describe('[EDGE] 特殊数据类型')
  it('[EDGE] 空数组 → ResponseModel.success({ data: [] })')
  it('[EDGE] 数字 0 → ResponseModel.success({ data: 0 })')
  it('[EDGE] 空字符串 → ResponseModel.success({ data: "" })')
```

### 4.4 GlobalExceptionsFilter 加固

**文件**：`src/lifecycle/filters/test/global.exception.spec.ts`
**现有**：6 用例
**新增**：+8 用例

| #   | 类别   | 测试场景                                           | 预期                                                      | 关联 Bug |
| --- | ------ | -------------------------------------------------- | --------------------------------------------------------- | -------- |
| 7   | `SEC`  | throw 字符串 `'raw error'`（非 Error 实例）        | 不崩溃，日志记录 undefined stack；非 dev → 通用 500 消息 | P5-B1    |
| 8   | `SEC`  | throw null                                         | 不崩溃，返回 500 + 通用消息                                | P5-B1    |
| 9   | `SEC`  | throw undefined                                    | 不崩溃，返回 500 + 通用消息                                | P5-B1    |
| 10  | `ERR`  | Prisma PrismaClientKnownRequestError（P2002 唯一约束） | status 500（Prisma 异常非 HttpException），消息隐藏        | —        |
| 11  | `ERR`  | 带 cause 的嵌套 Error                              | 日志记录完整链，响应仅返回顶层消息                         | —        |
| 12  | `EDGE` | BadRequestException 包含单条 string message        | 非 array → 不触发 VALIDATION_ERROR 分支                    | —        |
| 13  | `BIZ`  | BusinessException 附带 data 字段                   | HTTP 200 + domain code + 透传 data                         | —        |
| 14  | `SEC`  | 巨大异常对象（防止日志 OOM）                       | 不崩溃，正常返回 500                                       | —        |

```
describe('[SEC] 非 Error 异常')
  it('[BUG P5-B1] throw 字符串 → 不崩溃，日志记录 undefined stack，非 dev 模式返回通用 500 消息')
    // exception = 'raw error text'
    // isDev = false
    // expect: status 500, message = '服务繁忙，请稍后再试'
    // expect: logger.error 调用中 message=(exception as Error).message=undefined, stack=undefined（非 Error 对象无 stack）

  it('[BUG P5-B1] throw null → 不崩溃，返回 500')
    // exception = null
    // expect: status 500

  it('[BUG P5-B1] throw undefined → 不崩溃，返回 500')
    // exception = undefined
    // expect: status 500

describe('[ERR] Prisma 异常')
  it('[ERR] PrismaClientKnownRequestError P2002 → 500 + 隐藏内部细节')
    // exception = new PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '6.x' })
    // 不是 HttpException → status = 500
    // 非 dev → message 被隐藏

describe('[EDGE] 消息格式边界')
  it('[EDGE] BadRequestException 单条 string message → 不触发 validation error 分支')
    // new BadRequestException('invalid input')
    // responseBody.message = 'invalid input'（string 非 array）
    // apiErrorCode = 400（非 9001）

  it('[BIZ] BusinessException 附带 data → HTTP 200 + data 透传')
    // new BusinessException('1001:自定义错误', { detail: 'something' })
    // expect: code = 1001, data.detail = 'something'
```

### 4.5 EventsGateway 加固

**文件**：`src/websocket/test/events.gateway.spec.ts`
**现有**：18 用例
**新增**：+7 用例

| #   | 类别   | 测试场景                                                   | 预期                                       | 关联 Bug |
| --- | ------ | ---------------------------------------------------------- | ------------------------------------------ | -------- |
| 19  | `SEC`  | Authorization header 中的 Bearer token 提取                 | 正确去掉 `Bearer ` 前缀，decode 正确 token  | —        |
| 20  | `SEC`  | 空字符串 token → 不解码                                     | extractUserId 返回 null                    | —        |
| 21  | `SEC`  | decode 返回无 id 字段的 payload                             | extractUserId 返回 null                    | —        |
| 22  | `EDGE` | handleSubscribeBacktest 空 jobId                            | 加入 `backtest:` 房间（空字符串 jobId）     | —        |
| 23  | `BIZ`  | broadcastSyncProgress — 验证完整 payload 结构               | 所有字段正确传递                            | —        |
| 24  | `BIZ`  | broadcastSyncOverallProgress — 验证完整 payload 结构        | 所有字段正确传递                            | —        |
| 25  | `SEC`  | [设计审计 P5-B15] decode 不验证签名 → 伪造 JWT 可加入房间   | 记录当前行为（decode 不做签名校验）          | P5-B15   |

```
describe('[SEC] Token 提取边界')
  it('[SEC] Authorization header 提取 Bearer token')
    // handshake.headers.authorization = 'Bearer valid-jwt-xxx'
    // decode → { id: 5 }
    expect: join('user:5')

  it('[SEC] 空字符串 token → 不 decode')
    // handshake.auth.token = ''
    expect: join 未被调用

  it('[SEC] decode 返回 { sub: 'user' } → 无 id → extractUserId 返回 null')
    // jwtService.decode → { sub: 'user' }（无 id 字段）
    expect: join 未被调用

  it('[BUG P5-B15] decode 不验证签名 → 伪造 JWT 也能加入用户房间')
    // 构造 Base64 编码的 JWT（不签名）
    // jwtService.decode 返回 { id: 99 }
    // 当前行为：成功加入 user:99 房间
    // 安全隐患：任何人可伪造 token 监听其他用户的消息

describe('[EDGE] 订阅参数边界')
  it('[EDGE] subscribe_backtest 空 jobId → 房间名为 "backtest:"')
    expect: join('backtest:')
    expect: return { event: 'subscribed', room: 'backtest:' }
```

### 4.6 BacktestingProcessor 加固

**文件**：`src/queue/backtesting/test/backtesting.processor.spec.ts`
**现有**：10 用例
**新增**：+5 用例

| #   | 类别   | 测试场景                                                  | 预期                                                  | 关联 Bug |
| --- | ------ | --------------------------------------------------------- | ----------------------------------------------------- | -------- |
| 11  | `EDGE` | job.id 为 undefined                                       | emitBacktestProgress 收到 undefined jobId（记录行为）  | P5-B12   |
| 12  | `ERR`  | onFailed 中 prisma.backtestRun.update 抛出异常             | 捕获异常，仍然 emit failure 到 WebSocket              | —        |
| 13  | `ERR`  | runBacktest 中 prisma.backtestRun.update（RUNNING）失败   | 错误向上冒泡，不继续执行引擎                           | —        |
| 14  | `BIZ`  | runBacktest 的进度回调调用 emitProgress(5, 'loading-data') | 初始进度为 5% 的 loading-data 步骤                    | —        |
| 15  | `EDGE` | [设计审计 P5-B13] onFailed 中 WalkForward job 无 runId    | 跳过 DB 更新（walkForward 状态可能滞留 RUNNING）       | P5-B13   |

```
describe('[EDGE] job.id 边界')
  it('[BUG P5-B12] job.id 为 undefined → emitBacktestProgress 收到 undefined')
    // job = makeJob('run-backtest', data, undefined)
    // 当前行为：不崩溃但 jobId = undefined → WS 客户端收到 { jobId: undefined }

describe('[ERR] onFailed 错误处理')
  it('[ERR] onFailed DB 更新失败 → 不影响 emit failure')
    // prisma.backtestRun.update.mockRejectedValue(new Error('db down'))
    // 当前行为：捕获异常并记录日志，仍 emit failed
    expect: emitBacktestFailed 被调用
    expect: 不抛出异常

  it('[BUG P5-B13] WalkForward job 在 onFailed 中 → data.runId 为 undefined → 跳过 DB 更新')
    // job.data = { wfRunId: 'wf-1', userId: 1 }（无 runId 字段）
    // data.runId = undefined → 不进入 if(runId) 分支
    // walkForwardRun 状态可能滞留 RUNNING
    expect: prisma.backtestRun.update 未被调用
    expect: emitBacktestFailed 仍被调用

describe('[ERR] runBacktest 启动失败')
  it('[ERR] 标记 RUNNING 的 DB 更新失败 → 异常冒泡')
    // prisma.backtestRun.update.mockRejectedValue(new Error('db error'))
    expect: rejects.toThrow('db error')
    expect: engineService.runBacktest 未被调用
```

---

## 五、新建 Spec 设计

### 5.1 LoggingInterceptor（新建，~12 用例）

**文件**：`src/lifecycle/interceptors/test/logging.interceptor.spec.ts`

#### 5.1.1 sanitizeBody 纯函数

```
describe('sanitizeBody()')
  it('[DATA] 脱敏 password 字段 → "***"')
    input: { username: 'admin', password: '123456' }
    expect: { username: 'admin', password: '***' }

  it('[DATA] 脱敏多个敏感字段')
    input: { password: '123', token: 'jwt', secret: 'key', captchaCode: '1234', name: 'test' }
    expect: password/token/secret/captchaCode → '***', name 不变

  it('[BUG P5-B3] 嵌套敏感字段 → 不被脱敏（浅拷贝限制）')
    input: { user: { password: '123' } }
    // 当前行为：{ user: { password: '123' } }（未脱敏）
    // 正确行为：应递归脱敏 → { user: { password: '***' } }
    expect: output.user.password === '123'  // 记录当前（有缺陷的）行为
    // 注：修复后应反转断言为 expect: output.user.password === '***'

  it('[EDGE] body 为 null → 返回 null')
    expect: sanitizeBody(null as any) === null

  it('[EDGE] body 为非对象 → 直接返回')
    expect: sanitizeBody('string' as any) === 'string'
```

#### 5.1.2 路径排除

```
describe('[BIZ] 健康检查路径排除')
  it('[BIZ] /health 路径不记录日志')
    // url = '/health'
    // 验证 loggerService.log 和 loggerService.warn 均未调用

  it('[BIZ] /api/ready 路径不记录日志')
    // url = '/api/ready'

  it('[BUG P5-B4] /health-check 被前缀匹配意外排除')
    // url = '/health-check'
    // 当前行为：被排除（startsWith('/health') = true）
    // 正确行为：应记录日志
```

#### 5.1.3 正常请求日志

```
describe('[BIZ] 正常请求日志')
  it('[BIZ] 成功响应 → 记录 method/url/statusCode/latency/traceId/userId')
    // 构造 200 成功响应
    // mock RequestContextService.getCurrentContext → { traceId: 'trace-1', userId: 42 }
    expect: loggerService.log 调用参数包含所有字段
    expect: message 格式 = 'POST /api/test 200 Xms'

  it('[ERR] 错误响应 → 使用 warn 级别记录')
    // 让 next.handle() emit error
    expect: loggerService.warn 被调用
    expect: 包含 error message

  it('[BIZ] logHttpBody=true 时记录请求体')
    // 构造拦截器 logHttpBody=true
    // request.body = { name: 'test', password: '123' }
    expect: logData.body = { name: 'test', password: '***' }

  it('[BIZ] logHttpBody=false 时不记录请求体')
    // 构造拦截器 logHttpBody=false（默认）
    expect: logData 中无 body 字段
```

### 5.2 RequestContextService + Middleware（新建，~10 用例）

**文件**：`src/shared/context/test/request-context.spec.ts`

#### 5.2.1 RequestContextService 静态方法

```
describe('RequestContextService')
  describe('run() + getCurrentContext()')
    it('[BIZ] run 内部可获取上下文')
      RequestContextService.run({ traceId: 'abc' }, () => {
        expect(RequestContextService.getCurrentContext()).toEqual({ traceId: 'abc' })
      })

    it('[BIZ] run 外部获取上下文 → undefined')
      // 在 run 回调外调用
      expect(RequestContextService.getCurrentContext()).toBeUndefined()

    it('[DATA] 嵌套 run 覆盖上下文')
      RequestContextService.run({ traceId: 'outer' }, () => {
        RequestContextService.run({ traceId: 'inner' }, () => {
          expect(RequestContextService.getTraceId()).toBe('inner')
        })
        expect(RequestContextService.getTraceId()).toBe('outer')
      })

    it('[DATA] 并发请求上下文隔离')
      // 两个 Promise 各自 run，互不干扰
      const results: string[] = []
      await Promise.all([
        new Promise<void>((resolve) =>
          RequestContextService.run({ traceId: 'req-1' }, async () => {
            await sleep(10)
            results.push(RequestContextService.getTraceId()!)
            resolve()
          }),
        ),
        new Promise<void>((resolve) =>
          RequestContextService.run({ traceId: 'req-2' }, () => {
            results.push(RequestContextService.getTraceId()!)
            resolve()
          }),
        ),
      ])
      expect(results).toContain('req-1')
      expect(results).toContain('req-2')

  describe('setUserId()')
    it('[BIZ] 在有效上下文中设置 userId')
      RequestContextService.run({ traceId: 'abc' }, () => {
        RequestContextService.setUserId(42)
        expect(RequestContextService.getCurrentContext()?.userId).toBe(42)
      })

    it('[BUG P5-B7] 无上下文时 setUserId 静默无操作')
      // 在 run 外调用
      expect(() => RequestContextService.setUserId(1)).not.toThrow()

  describe('getTraceId()')
    it('[BIZ] 返回当前 traceId')
    it('[EDGE] 无上下文 → undefined')
```

#### 5.2.2 RequestContextMiddleware

```
describe('RequestContextMiddleware')
  it('[BIZ] 注入 traceId 并传递到下游')
    // 调用 middleware.use(req, res, next)
    // next 回调中验证 RequestContextService.getTraceId() 不为空

  it('[BIZ] 优先使用 x-trace-id 请求头')
    // req.headers['x-trace-id'] = 'upstream-trace-123'
    expect: RequestContextService.getTraceId() === 'upstream-trace-123'

  it('[BIZ] 其次使用 x-request-id 请求头')
    // req.headers['x-request-id'] = 'request-456'
    expect: RequestContextService.getTraceId() === 'request-456'

  it('[BIZ] 无 header 时自动生成 16 位 hex')
    expect: traceId.length === 16
    expect: /^[0-9a-f]{16}$/.test(traceId)

  it('[BIZ] 设置响应头 X-Trace-Id')
    expect: res.setHeader('X-Trace-Id', traceId)
```

### 5.3 RedisShutdownService（新建，~5 用例）

**文件**：`src/shared/test/redis-shutdown.service.spec.ts`

```
describe('RedisShutdownService')
  it('[BIZ] Redis 打开状态 → 调用 quit() 优雅关闭')
    // redis.isOpen = true
    expect: redis.quit 被调用一次

  it('[EDGE] Redis 已关闭 → 不调用 quit()')
    // redis.isOpen = false
    expect: redis.quit 未被调用

  it('[EDGE] redis 为 null → 不崩溃')
    // redis = null
    expect: 不抛出异常

  it('[ERR] quit() 抛出异常 → 记录错误日志但不崩溃')
    // redis.quit.mockRejectedValue(new Error('timeout'))
    expect: logger.error 包含 'timeout'
    expect: 不抛出异常

  it('[BUG P5-B14] quit() 抛出字符串异常 → err.message 为 undefined')
    // redis.quit.mockRejectedValue('connection reset')
    // 当前行为：logger.error('Error closing Redis connection', undefined, ...)
    expect: logger.error 被调用（message 参数可能为 undefined）

  it('[BIZ] 日志包含信号名称')
    // onApplicationShutdown('SIGTERM')
    expect: logger.log 包含 'SIGTERM'
```

### 5.4 PrismaService 辅助函数（新建，~10 用例）

**文件**：`src/shared/test/prisma.service.spec.ts`

> 注意：PrismaService 继承 PrismaClient，直接实例化需要数据库连接。
> 测试策略：导出的纯函数（`buildPrismaDatasourceUrl`、`readPositiveIntegerEnv`）可直接单测；
> 生命周期方法（onModuleInit/onModuleDestroy）通过 mock PrismaClient 方法测试。

#### 5.4.1 buildPrismaDatasourceUrl 纯函数

```
describe('buildPrismaDatasourceUrl()')
  it('[BIZ] 标准 URL → 追加 connection_limit/pool_timeout/connect_timeout')
    // input: 'postgresql://user:pass@localhost:5432/mydb'
    // expect: URL 包含 connection_limit=15, pool_timeout=20, connect_timeout=10

  it('[EDGE] URL 已包含 connection_limit → 不覆盖')
    // input: 'postgresql://user:pass@localhost:5432/mydb?connection_limit=5'
    // expect: connection_limit 保持为 5

  it('[EDGE] databaseUrl 为 undefined → 返回 undefined')
    expect: buildPrismaDatasourceUrl(undefined) === undefined

  it('[BUG P5-B10] databaseUrl 不是有效 URL → 抛出 TypeError（当前行为）')
    // input: 'not-a-url'
    // new URL('not-a-url') → throws TypeError
    // 当前行为：异常冒泡到 PrismaService 构造函数 → 应用启动失败
    // 建议修复：增加 try-catch 提供友好错误提示
    expect: throw TypeError
```

#### 5.4.2 readPositiveIntegerEnv 纯函数

```
describe('readPositiveIntegerEnv()')
  it('[BIZ] 有效正整数 → 返回解析值')
    // env.PRISMA_CONNECTION_LIMIT = '20'
    expect: 20

  it('[EDGE] 空值 → 返回 fallback')
    // env.PRISMA_CONNECTION_LIMIT = undefined
    expect: fallback

  it('[EDGE] 负数 → 返回 fallback')
    // env.PRISMA_CONNECTION_LIMIT = '-5'
    // parseInt('-5') = -5, -5 > 0 = false
    expect: fallback

  it('[EDGE] 零 → 返回 fallback')
    // parseInt('0') = 0, 0 > 0 = false
    expect: fallback

  it('[EDGE] 浮点数字符串 → parseInt 截断为整数，通过 isInteger 和 > 0 检查')
    // '1.5' → parseInt('1.5', 10) = 1
    // Number.isInteger(1) = true && 1 > 0 = true → 返回 1
    expect: 1

  it('[EDGE] 非数字字符串 → NaN → 返回 fallback')
    // 'abc' → parseInt = NaN → fallback
    expect: fallback
```

#### 5.4.3 recordQueryMetrics（需 mock Histogram/Counter）

```
describe('recordQueryMetrics()')
  it('[BIZ] 慢查询（>500ms）→ 记录 warn 日志')
    // durationMs = 600
    expect: histogram.observe(0.6)
    expect: counter.inc()
    expect: logger.warn 包含 '600.0ms'

  it('[BIZ] 正常查询（<=500ms）→ 只记录指标不记录日志')
    // durationMs = 100
    expect: histogram.observe(0.1)
    expect: counter.inc()
    expect: logger.warn 未被调用
```

### 5.5 Health 模块（新建，~8 用例）

**文件**：`src/shared/health/test/health.spec.ts`

#### 5.5.1 PrismaHealthIndicator

```
describe('PrismaHealthIndicator')
  it('[BIZ] SELECT 1 成功 → 返回 { database: { status: "up" } }')
    // prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }])
    expect: result.database.status === 'up'

  it('[ERR] SELECT 1 失败 → 抛出 HealthCheckError')
    // prisma.$queryRaw.mockRejectedValue(new Error('connection refused'))
    expect: throw HealthCheckError
    expect: error result 包含 message: 'connection refused'
```

#### 5.5.2 RedisHealthIndicator

```
describe('RedisHealthIndicator')
  it('[BIZ] PING → PONG → 返回 { redis: { status: "up" } }')
    // redis.ping.mockResolvedValue('PONG')
    expect: result.redis.status === 'up'

  it('[EDGE] PING → 非 PONG 响应 → 抛出 HealthCheckError')
    // redis.ping.mockResolvedValue('LOADING')
    expect: throw HealthCheckError

  it('[ERR] PING 超时 → 抛出 HealthCheckError')
    // redis.ping.mockRejectedValue(new Error('timeout'))
    expect: throw HealthCheckError
```

#### 5.5.3 HealthController

```
describe('HealthController')
  it('[BIZ] liveness → 仅调用 health.check([])')
    // 存活探针不检查依赖
    expect: health.check([])

  it('[BIZ] readiness → 检查 database + redis')
    // 就绪探针同时检查 DB 和 Redis
    expect: health.check 参数含两个检查函数

  it('[BIZ] readiness 任一依赖失败 → 返回 503')
    // 健康检查框架自动处理 503 状态码
```

### 5.6 HttpMetricsInterceptor（新建，~8 用例）

**文件**：`src/shared/metrics/test/http-metrics.interceptor.spec.ts`

```
describe('HttpMetricsInterceptor')
  it('[BIZ] 正常请求 → 记录 duration + request count')
    // 200 响应
    expect: durationHistogram.startTimer({ method: 'POST', route: '/api/test' })
    expect: requestCounter.inc({ method: 'POST', route: '/api/test', status_code: '200' })
    expect: errorCounter.inc 未被调用

  it('[BIZ] 4xx 错误 → 同时记录 error count')
    // 400 响应
    expect: errorCounter.inc({ ..., status_code: '400' })

  it('[ERR] 5xx 错误 → 记录 error count + request count')
    // next.handle() throw { status: 500 }
    expect: errorCounter.inc({ ..., status_code: '500' })
    expect: requestCounter.inc(...)

  it('[ERR] 异常无 status 字段 → 默认 500')
    // next.handle() throw new Error('boom')（无 status 属性）
    expect: status_code = '500'

  it('[BIZ] 排除路径 /metrics → 不记录指标')
    // url = '/metrics'
    expect: durationHistogram.startTimer 未被调用

  it('[BIZ] 排除路径 /api/health → 不记录指标')
    // url = '/api/health'

  it('[BUG P5-B8] 无匹配路由（404）→ 回退到完整 URL')
    // request.route = undefined, request.url = '/api/unknown/path?q=1'
    // 当前行为：route = '/api/unknown/path?q=1'（含查询参数）
    // 风险：Prometheus label 基数爆炸

  it('[BUG P5-B9] /metrics-export 被前缀匹配排除')
    // url = '/metrics-export'
    // 当前行为：被排除（startsWith('/metrics') = true）
```

---

## 六、分批策略与实施路径

### 6.1 分批计划

| 批次        | 组件                                                          | 新增用例 | 说明                         |
| ----------- | ------------------------------------------------------------- | -------- | ---------------------------- |
| **Batch A** | JwtAuthGuard + RolesGuard + TransformInterceptor（加固）       | +12      | 安全关键，改动最小            |
| **Batch B** | GlobalExceptionsFilter + LoggingInterceptor（加固 + 新建）     | +20      | 异常处理 + 日志可观测性       |
| **Batch C** | RequestContext + Middleware（新建）                             | +10      | 上下文传播，需 AsyncLocalStorage |
| **Batch D** | Health 模块 + RedisShutdownService + PrismaService（新建）     | +23      | 基础设施生命周期              |
| **Batch E** | HttpMetricsInterceptor + EventsGateway + BacktestingProcessor（新建 + 加固） | +20      | 可观测性 + WebSocket + 队列   |

### 6.2 执行顺序建议

```
Batch A (1 天)
  ├─ JwtAuthGuard 加固（+6）
  ├─ RolesGuard 加固（+3）
  └─ TransformInterceptor 加固（+3）
    ↓
Batch B (1 天)
  ├─ GlobalExceptionsFilter 加固（+8）
  └─ LoggingInterceptor 新建（+12）
    ↓
Batch C (0.5 天)
  ├─ RequestContextService 新建（+7）
  └─ RequestContextMiddleware 新建（+5 含在上面的 spec）
    ↓
Batch D (1 天)
  ├─ PrismaService 纯函数新建（+10）
  ├─ Health 模块新建（+8）
  └─ RedisShutdownService 新建（+5）
    ↓
Batch E (0.5 天)
  ├─ HttpMetricsInterceptor 新建（+8）
  ├─ EventsGateway 加固（+7）
  └─ BacktestingProcessor 加固（+5）
```

### 6.3 工时估算

| 批次    | 估算工时 | 依赖                                 |
| ------- | -------- | ------------------------------------ |
| Batch A | 0.5-1 天 | 无                                   |
| Batch B | 0.5-1 天 | Batch A（可并行）                    |
| Batch C | 0.5 天   | 无                                   |
| Batch D | 0.5-1 天 | 无                                   |
| Batch E | 0.5 天   | 无                                   |
| **总计** | **2-4 天** | Batch A-E 可大幅并行，最短 2 天     |

---

## 七、测试基础设施需求

### 7.1 现有可复用的工具

| 工具                     | 文件路径                      | 用途                           |
| ------------------------ | ----------------------------- | ------------------------------ |
| `createMockPrismaService()` | test/helpers/prisma-mock.ts  | Prisma 全模型 mock             |
| `createMockRedis()`      | test/helpers/redis-mock.ts    | Redis 操作 mock                |
| `createTestApp()`        | test/helpers/create-test-app.ts | Controller 集成测试工厂       |
| 全局 setup               | test/setup.ts                 | Logger 静默 + 10s 超时         |

### 7.2 本阶段需新增的辅助工具

#### (a) makeExecutionContext — Guard/Interceptor 测试用上下文工厂

```typescript
// test/helpers/execution-context.ts
export function makeExecutionContext(overrides: {
  url?: string
  method?: string
  body?: Record<string, unknown>
  user?: Record<string, unknown>
  statusCode?: number
  route?: { path: string }
}): {
  context: ExecutionContext
  request: Record<string, unknown>
  response: Record<string, unknown>
}
```

说明：统一创建 `ExecutionContext` mock，避免各 spec 重复手写 `switchToHttp().getRequest()` 模式。JwtAuthGuard、RolesGuard、LoggingInterceptor、HttpMetricsInterceptor 均可复用。

#### (b) makeCallHandlerWithError — Interceptor error 路径测试

```typescript
// test/helpers/call-handler.ts
export function makeCallHandler(returnValue: unknown): CallHandler
export function makeCallHandlerWithError(error: Error): CallHandler
```

说明：统一创建 `CallHandler` mock，用于 TransformInterceptor、LoggingInterceptor、HttpMetricsInterceptor 的错误路径测试。

---

## 八、验收标准

### 8.1 功能验收

| 指标                                | 目标值                      |
| ----------------------------------- | --------------------------- |
| Lifecycle spec 文件数               | 15（从 6 增加到 15）         |
| Lifecycle 用例总数                  | ≥ 129（从 54 增加）         |
| 有安全边界测试（`SEC`）的 spec      | ≥ 8 / 15                   |
| 有错误处理测试（`ERR`）的 spec      | ≥ 8 / 15                   |
| 标注 `[BUG]` 的用例数               | ≥ 10                       |
| 所有新增/修改用例通过               | `pnpm test` 全绿            |

### 8.2 质量验收

- 每个 `[BUG]` 标注包含：当前行为 + 正确行为 + Bug ID
- 断言强度：禁止出现裸 `toBeDefined()` 或无参 `toHaveBeenCalled()`
- 期望值来自独立推导（业务规则、接口契约），非代码运行结果反推
- 新增 spec 文件放置在模块的 `test/` 子目录下

### 8.3 CI 集成

- 所有新增测试纳入现有 `pnpm test` 命令
- 不引入新的外部依赖
- 测试运行时间增量 < 5 秒

---

## 附录 A：Bug 优先级与处理建议

| Bug ID  | 严重度 | 建议处理方式                                                                       |
| ------- | :----: | ---------------------------------------------------------------------------------- |
| P5-B1   |   S1   | Phase 5 实施时修复：对非 Error 异常增加 `instanceof Error` 保护                     |
| P5-B2   |   S1   | 低优先级：当前 ErrorEnum 格式正确，可添加防御性 `?? '服务繁忙'` fallback            |
| P5-B3   |   S2   | 可选修复：sanitizeBody 改为递归或 JSON.stringify 替换                               |
| P5-B4   |   S3   | 暂不修复：当前无 `/health*` 冲突路径                                                |
| P5-B5   |   S3   | 暂不修复：PostgreSQL 自增 ID 不会为 0                                               |
| P5-B6   |   S2   | 建议修复：改用精确匹配 `url === p` 或 `url.startsWith(p + '/')` 或 `url === p + '?...'` |
| P5-B7   |   S3   | 有意设计，不修复，测试中记录行为                                                    |
| P5-B8   |   S2   | 建议修复：回退路由加 `'UNKNOWN'` 兜底避免基数爆炸                                   |
| P5-B9   |   S3   | 同 P5-B4，暂不修复                                                                  |
| P5-B10  |   S3   | 建议修复：增加 try-catch 包装，友好错误提示                                          |
| P5-B11  |   S3   | 可接受行为，不修复                                                                   |
| P5-B12  |   S2   | 建议修复：`job.id ?? 'unknown'` 替代非空断言                                        |
| P5-B13  |   S3   | 建议修复：onFailed 中区分 job.name，使用对应的 DB 表更新                             |
| P5-B14  |   S2   | 建议修复：`err instanceof Error ? err.message : String(err)`                        |
| P5-B15  |   S3   | 设计层面问题，建议后续改为 `jwtService.verify()`                                     |
| P5-B16  |   S3   | 配置层面，建议通过环境变量控制 WS CORS origin                                        |
