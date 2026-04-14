# 测试重构 Phase 6 — E2E 测试详细设计

> **范围**：测试重构总纲 §八（P5 优先级）：端到端 API 流程测试，覆盖 6 条核心业务链路
> **原则**：SKILL.md §15 — 期望值从业务规则独立推导，测试必须验证跨模块的数据状态传递而非单独调用
> **前置**：Phase 1（P0 安全与核心计算）、Phase 2（P1 核心业务逻辑）、Phase 4（P3 Controller 层重构）已完成
> **技术基础**：`test/helpers/create-test-app.ts` + `test/jest-e2e.json` 已就绪

---

## 一、E2E 测试基础设施设计

### 1.1 测试环境隔离策略

E2E 测试需要真实的数据库与 Redis 实例，但必须与生产/开发数据完全隔离。

| 资源              | 隔离方式                                     | 配置来源                                  |
| ----------------- | -------------------------------------------- | ----------------------------------------- |
| PostgreSQL        | 独立 Schema：`test_e2e`（非 `public`）       | `E2E_DATABASE_URL` 环境变量               |
| Redis             | 独立 DB 编号：`db=15`                        | `E2E_REDIS_DB=15` 环境变量                |
| Tushare API       | 完全 mock（fixture JSON 文件）               | Jest `moduleNameMapper` 或 jest.mock      |
| BullMQ Queue      | 内联处理（`isGlobal: false`，不启动 worker） | 测试模块不导入 `QueueModule`              |
| NestJS Cron       | 禁用（`ScheduleModule.forRoot({})` 不加载） | 测试 AppModule 不导入 `ScheduleModule`   |

### 1.2 测试 AppModule 设计

E2E 测试不直接引导完整的 `AppModule`（避免启动 Tushare sync、cron、socket.io 等副作用），而是按业务链路组装最小化的测试模块。

```typescript
// test/helpers/e2e-module-factory.ts

import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ConfigModule } from '@nestjs/config'
import configs from 'src/config'
import { SharedModule } from 'src/shared/shared.module'
import { TransformInterceptor } from 'src/lifecycle/interceptors/transform.interceptor'
import { GlobalExceptionsFilter } from 'src/lifecycle/filters/global.exception'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { APP_GUARD } from '@nestjs/core'

/**
 * 创建用于 E2E 测试的 NestJS 应用。
 * 与单元测试不同，此处使用真实 Prisma（连接 test_e2e Schema）和真实 Redis（db=15）。
 * 但排除 TushareModule、QueueModule、ScheduleModule 等有外部副作用的模块。
 */
export async function createE2eApp(featureModules: any[]): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        envFilePath: ['.env.test', '.env'],
        isGlobal: true,
        load: [...Object.values(configs)],
      }),
      SharedModule,
      ...featureModules,
    ],
    providers: [
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile()

  const app = moduleRef.createNestApplication()
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  app.useGlobalInterceptors(new TransformInterceptor())
  app.useGlobalFilters(new GlobalExceptionsFilter(false))
  app.setGlobalPrefix('api')

  await app.init()
  return app
}
```

### 1.3 测试数据库初始化

E2E 测试必须在每个测试套件前清理所有相关表，保证测试幂等性。

```typescript
// test/helpers/e2e-db-cleaner.ts

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.E2E_DATABASE_URL } },
})

/**
 * 按流程清理相关表（顺序与外键依赖反向）。
 * 每个 E2E 套件的 beforeAll/beforeEach 调用对应清理方法。
 */
export const E2eDbCleaner = {
  async cleanAuth() {
    await prisma.auditLog.deleteMany()
    await prisma.user.deleteMany()
  },

  async cleanStrategy() {
    await prisma.strategyVersion.deleteMany()
    await prisma.strategy.deleteMany()
  },

  async cleanBacktest() {
    await prisma.backtestTrade.deleteMany()
    await prisma.backtestPosition.deleteMany()
    await prisma.backtestRun.deleteMany()
  },

  async cleanPortfolio() {
    await prisma.riskViolation.deleteMany()
    await prisma.riskRule.deleteMany()
    await prisma.portfolioNav.deleteMany()
    await prisma.portfolioHolding.deleteMany()
    await prisma.portfolio.deleteMany()
  },

  async cleanAll() {
    await E2eDbCleaner.cleanBacktest()
    await E2eDbCleaner.cleanPortfolio()
    await E2eDbCleaner.cleanStrategy()
    await E2eDbCleaner.cleanAuth()
  },
}
```

### 1.4 Tushare 数据 Fixture

E2E 测试中因子筛选、回测引擎等需要行情数据，通过 Prisma seed 写入 `test_e2e` Schema 的只读表（`stock_daily_prices` 等）。Fixture 数据要求：
- 包含至少 60 个交易日的行情数据（保证 MA20、MACD 等指标可计算）
- 至少 3 只股票：`000001.SZ`（平安银行）、`600519.SH`（贵州茅台）、`000858.SZ`（五粮液）
- 交易日历覆盖 `20240101`—`20240630`

```typescript
// test/fixtures/e2e-market-data.seed.ts
// 此文件在 CI 环境下由 jest globalSetup 调用一次
export async function seedMarketData(prisma: PrismaClient) {
  // 写入 stock_basic_profiles、stock_daily_prices、stock_daily_valuation_metrics
  // 数据为合理的历史价格（来自公开历史行情，非真实 API 调用）
}
```

### 1.5 测试 Redis 隔离

E2E 测试使用 Redis `SELECT 15`，所有键名自动带测试前缀 `e2e:`（通过 SharedModule 配置覆盖）。每个套件的 `afterAll` 执行 `redis.flushDb()` 清理 db=15。

### 1.6 Mock Tushare Client

```typescript
// test/mocks/tushare-client.mock.ts
// 返回 test/fixtures/tushare/ 目录下的 JSON fixture 文件
export const mockTushareClient = {
  post: jest.fn().mockImplementation((apiName: string) => {
    const fixture = require(`../fixtures/tushare/${apiName}.json`)
    return Promise.resolve(fixture)
  }),
}
```

---

## 二、E2E 源码审计 Bug 清单

E2E 测试发现的 bug 通常跨越多个模块边界，单元测试无法覆盖。以下为代码审计中发现的跨模块 bug。

### 2.1 严重度标准

|  等级  | 含义                               |
| :----: | ---------------------------------- |
| **S1** | 安全风险或数据损坏                 |
| **S2** | 跨模块数据传递错误，影响用户决策   |
| **S3** | 边界条件异常，不影响主流程         |

### 2.2 Bug 清单

| Bug ID    | 严重度 | 涉及流程       | 描述                                                                                                                                        |
| --------- | :----: | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **E2E-B1** | S2    | Flow 2         | `strategy.run()` 发起回测后，回测状态初始为 `PENDING`，但 `BacktestController.createRun()` 直接触发同步引擎执行而非通过队列。在 E2E 环境（不启动 QueueModule worker）下，若仍有队列依赖，回测将永远停留在 `PENDING` 状态。 |
| **E2E-B2** | S2    | Flow 3         | `portfolio.addHolding()` 写入持仓后，`getPnlToday()` 需要查询最新交易日行情。若 `stock_daily_prices` 中无该日数据，方法返回 `null` 而非报错，但调用方在 `totalPnl` 累加时未处理 `null`，导致 `NaN`。 |
| **E2E-B3** | S1    | Flow 1         | 登出端点（`POST /auth/logout`）将 access token 写入 Redis 黑名单，但 TTL 取自 access token 剩余有效期。若 token 已过期（剩余时间 ≤ 0），`SET EX 0` 会导致 Redis 立即删除键，黑名单无效，过期 token 实际上变成"永远有效"直到 JWT 过期时间。 |
| **E2E-B4** | S3    | Flow 2         | `strategy.run()` 与 `backtest.createRun()` 均接受 `dateRange`，但两者对 `startDate`/`endDate` 的格式要求不同：Strategy 侧期望 `YYYYMMDD`，BacktestRun 侧期望 `YYYY-MM-DD`。跨模块调用时格式不一致可能导致日期解析偏差。 |
| **E2E-B5** | S2    | Flow 5         | `applyBacktest()` 将回测持仓导入组合时，传入的 `mode: 'REPLACE'` 会先删除所有现有持仓再插入。若事务失败（如新持仓的股票代码不存在），现有持仓被删除但新持仓未写入，组合变为空持仓。需确认事务原子性。 |
| **E2E-B6** | S3    | Flow 6         | `alert.scanPriceRules()` 使用 `new Date().toISOString().slice(0,10)` 确定扫描日期。与 P3-B6 同模式：UTC+8 凌晨触发时产生前一天的扫描日期，导致数据缺失或重复扫描。 |

---

## 三、Flow 1 — 完整认证生命周期

**涉及模块**：`AuthModule`、`UserModule`
**文件**：`test/e2e/flow-auth.e2e-spec.ts`
**验收标准**：注册→登录→Token 刷新→登出→验证失效，全链路 ≤ 10 步

### 3.1 场景设计

#### 3.1.1 正常登录与登出全流程

```
前置：数据库中存在用户 { account: 'e2e_user', password: bcrypt(123456) }
```

| # | 步骤                                    | HTTP 请求                                                                   | 期望响应                                               | 业务验证点                                             |
| - | --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| 1 | 获取验证码                              | `POST /api/auth/captcha`                                                    | `{ code:0, data:{ captchaId, svgContent } }`           | captchaId 已写入 Redis，TTL 约 60s                     |
| 2 | 登录（正确验证码）                      | `POST /api/auth/login` `{ account, password, captchaId, captchaCode }`      | `{ code:0, data:{ accessToken } }`，Cookie 含 rf_token | accessToken 可 jwt.decode，userId 正确；验证码已从 Redis 删除 |
| 3 | 携带 AccessToken 访问受保护端点         | `POST /api/user/profile`，Header: `Authorization: Bearer <accessToken>`     | `{ code:0, data:{ id, account } }`                     | TokenPayload 正确注入 `request.user`                   |
| 4 | 刷新 Token（Cookie 自动携带）           | `POST /api/auth/refresh`，Cookie: `rf_token=<refreshToken>`                 | `{ code:0, data:{ accessToken } }`，Cookie 更新        | 旧 refreshToken 已从 Redis 删除；新 accessToken 可用   |
| 5 | 使用旧 refreshToken 刷新（重放攻击）    | `POST /api/auth/refresh`，手动设置旧 rf_token Cookie                         | 401                                                    | [BIZ] 宽限期外重用旧 refreshToken 应失败               |
| 6 | 登出                                    | `POST /api/auth/logout`，Header: `Authorization: Bearer <accessToken>`      | `{ code:0 }`                                           | accessToken 写入 Redis 黑名单；refreshToken 从 Redis 删除 |
| 7 | 用已登出的 AccessToken 访问受保护端点   | `POST /api/user/profile`，Header: `Authorization: Bearer <原accessToken>`   | 401                                                    | [SEC] 黑名单生效                                       |

#### 3.1.2 验证码安全场景

| # | 类别   | 测试场景                                               | 期望                                   | 对应 Bug   |
| - | ------ | ------------------------------------------------------ | -------------------------------------- | ---------- |
| 1 | `RACE` | 同一 captchaId 并发提交两次登录请求                    | 仅第一个成功（Redis GETDEL 原子性）    | —          |
| 2 | `SEC`  | 验证码 TTL 过期后使用                                  | 401 + 验证码已过期                     | —          |
| 3 | `SEC`  | 正确密码 + 错误验证码连续 5 次后账户锁定               | 第 6 次（正确验证码）也返回 401 + 锁定 | Phase 1 B1 |
| 4 | `BIZ`  | 成功登录后再次使用同一 captchaId                       | 401（验证码已消费）                    | —          |

#### 3.1.3 [BUG E2E-B3] 已过期 AccessToken 的黑名单 TTL

```
场景：
  1. 登录获得 accessToken（TTL 30 分钟）
  2. 修改系统时钟（或等待 30+ 分钟后），让 token 过期
  3. 登出（此时 token 已过期，剩余有效期 ≤ 0）

当前行为：
  - authService.logout() 计算 ttl = jwtPayload.exp - now ≤ 0
  - redis.SET(blacklistKey, '1', { EX: 0 }) → Redis 立即删除键或返回错误
  - 黑名单实际上未写入

正确行为：
  - 过期 token 的黑名单 TTL 应使用最小值（如 1 秒）或直接跳过黑名单写入（过期 token 自然无效）
  - 建议：if (ttl <= 0) return; // 已过期的 token 无需加黑名单

E2E 测试标注：
  it('[BUG E2E-B3] 已过期 Token 登出后重用应返回 401（黑名单 TTL 边界）', ...)
  // 注意：需 mock jwt 时间，不要真实等待 30 分钟
```

---

## 四、Flow 2 — 策略→回测全链路

**涉及模块**：`StrategyModule`、`BacktestModule`
**文件**：`test/e2e/flow-strategy-backtest.e2e-spec.ts`
**验收标准**：创建策略→发起回测→回测完成→查询结果，数值可验证

### 4.1 Fixture 数据要求

- 股票宇宙：`000001.SZ`、`600519.SH`
- 行情范围：`20240101`—`20240630`（120 交易日）
- MA_CROSS_SINGLE 策略：短均线 5 日，长均线 20 日

### 4.2 场景设计

#### 4.2.1 正常创建与回测流程

| # | 步骤                  | HTTP 请求                                                            | 期望响应                                    | 验证点                                                         |
| - | --------------------- | -------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| 1 | 创建策略              | `POST /api/strategy/create` `{ name, strategyType: 'MA_CROSS_SINGLE', config: {...} }` | `{ code:0, data:{ id, name, userId } }`     | id 为 UUID；同一用户数据库中存在                               |
| 2 | 获取策略详情          | `POST /api/strategy/detail` `{ id }`                                 | `{ code:0, data: strategyObj }`             | config 字段与创建时一致                                        |
| 3 | 发起回测              | `POST /api/backtest/runs` `{ strategyId, dateRange: { startDate: '20240101', endDate: '20240630' }, initialCash: 100000 }` | `{ code:0, data:{ runId, status: 'COMPLETED'\|'PENDING' } }` | runId 为 UUID；状态最终达到 COMPLETED |
| 4 | 查询回测汇总          | `POST /api/backtest/runs/detail` `{ runId }`                        | `{ code:0, data:{ totalReturn, sharpeRatio, maxDrawdown } }` | 手算验证：已知行情下 totalReturn ≥ -100%；maxDrawdown ≤ 0 |
| 5 | 查询权益曲线          | `POST /api/backtest/runs/equity` `{ runId }`                        | 包含 `{ date, nav }` 的时间序列数组          | 首日 nav ≈ 1.0；序列长度与交易日数匹配                         |
| 6 | 查询交易记录          | `POST /api/backtest/runs/trades` `{ runId, page: 1, pageSize: 20 }` | 包含 `{ tsCode, action, price, quantity }` 的列表 | 每笔交易的 `price * quantity` 不超过初始资金                  |
| 7 | 查询持仓记录          | `POST /api/backtest/runs/positions` `{ runId, date: '20240630' }`   | 最终日持仓列表                               | 持仓市值之和 ≤ 初始资金 × (1 + totalReturn)                    |

#### 4.2.2 策略上限与边界

| # | 类别   | 测试场景                                    | 期望                               |
| - | ------ | ------------------------------------------- | ---------------------------------- |
| 1 | `BIZ`  | 策略数量达到 50 时创建第 51 个             | 400 + 明确上限提示                 |
| 2 | `BIZ`  | 克隆策略：名称自动生成不冲突               | `{ name: '原名-copy-2' }`          |
| 3 | `SEC`  | 用户 A 访问用户 B 的策略 detail            | 403（非 404，不泄露存在性可按设计） |
| 4 | `BIZ`  | 删除有进行中回测的策略                     | 400 或 202（级联取消）             |

#### 4.2.3 [BUG E2E-B1] E2E 环境中回测状态流转

```
问题：
  BacktestController.createRun() 在 POST /api/backtest/runs 时：
  - 生产环境：将任务推入 BullMQ 队列，worker 异步执行
  - 单元测试：Queue 被 mock，createRun 同步返回 status='PENDING'
  - E2E 测试：若不启动真实 worker，任务永远停留在 PENDING

解决方案（本文档不实施代码，仅记录 E2E 测试注意事项）：
  - 方案 A：E2E 测试中导入 QueueModule 并启动内联 worker（bullmq 支持 inline processing）
  - 方案 B：E2E 测试对 BacktestProcessor 手动调用 processJob()，绕过队列直接执行
  - 推荐方案 B：更简单，不需要 Redis 队列基础设施

E2E 测试步骤 3 应等待状态变为 COMPLETED（轮询 + 超时 30s）：
  const runId = createRes.body.data.runId
  await waitForBacktestCompletion(app, runId, 30_000)

  async function waitForBacktestCompletion(app, runId, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const res = await request(app).post('/api/backtest/runs/detail').send({ runId })
      if (res.body.data.status === 'COMPLETED') return
      if (res.body.data.status === 'FAILED') throw new Error('回测失败')
      await new Promise(r => setTimeout(r, 500))
    }
    throw new Error('回测超时')
  }
```

#### 4.2.4 回测数值手算验证

```
测试数据构造（确定性数据，避免随机性）：
  初始资金：100,000 元
  股票：000001.SZ
  策略：MA_CROSS_SINGLE，short=5，long=20
  时间：20240101—20240131（约 20 交易日）
  行情：人工构造（确保特定日期出现金叉/死叉）

期望结果：
  - 权益曲线：首日 nav=1.0，最终 nav 手算得出
  - 至少触发 1 次买入和 1 次卖出
  - 无负现金（资金不足时跳过买入）

验证方式：
  // 用确定性 fixture 数据，手算出具体的 nav 序列
  expect(equity[0].nav).toBeCloseTo(1.0, 4)
  expect(equity[equity.length - 1].nav).toBeGreaterThan(0)
  expect(trades.length).toBeGreaterThanOrEqual(2) // 至少 1 买 1 卖
```

---

## 五、Flow 3 — 组合管理→风控全流程

**涉及模块**：`PortfolioModule`（含 `PortfolioRiskService`、`RiskCheckService`）
**文件**：`test/e2e/flow-portfolio-risk.e2e-spec.ts`
**验收标准**：创建组合→添加持仓→查看 P&L→风控检查→违规告警

### 5.1 场景设计

#### 5.1.1 组合 CRUD 与持仓管理

| # | 步骤                   | HTTP 请求                                                                                    | 期望                                        | 验证点                                                          |
| - | ---------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| 1 | 创建组合               | `POST /api/portfolio/create` `{ name: 'E2E组合', initialCash: 500000 }`                     | `{ code:0, data:{ id, initialCash } }`      | initialCash=500000；holdings 为空                               |
| 2 | 添加持仓（000001.SZ）  | `POST /api/portfolio/holding/add` `{ portfolioId, tsCode: '000001.SZ', quantity: 1000, avgCost: 10.50 }` | `{ code:0, data: holdingObj }`              | holdingValue = 1000 × 10.50 = 10,500                            |
| 3 | 添加持仓（600519.SH）  | `POST /api/portfolio/holding/add` `{ portfolioId, tsCode: '600519.SH', quantity: 10, avgCost: 1800 }` | `{ code:0, data: holdingObj }`              | holdingValue = 10 × 1800 = 18,000                               |
| 4 | 查看组合详情           | `POST /api/portfolio/detail` `{ portfolioId }`                                               | 包含 holdings 列表 + 汇总                   | holdings 数量 = 2；totalCost = 10,500 + 18,000 = 28,500         |
| 5 | 加仓（000001.SZ）      | `POST /api/portfolio/holding/add` `{ portfolioId, tsCode: '000001.SZ', quantity: 500, avgCost: 11.00 }` | `{ code:0, data:{ avgCost } }`              | 加权平均成本 = (1000×10.50 + 500×11.00) / 1500 = 10.667（手算） |
| 6 | 减仓（000001.SZ）      | `POST /api/portfolio/holding/update` `{ holdingId, quantity: 500 }`                         | `{ code:0 }`                                | 减仓不改变成本价（avgCost 仍为 10.667）                         |
| 7 | 查看今日 P&L           | `POST /api/portfolio/pnl/today` `{ portfolioId }`                                            | `{ totalPnl, totalPnlPct }`                 | 数值基于 fixture 行情计算，与手算一致                            |
| 8 | 清空持仓（000001.SZ）  | `POST /api/portfolio/holding/remove` `{ holdingId }`                                        | `{ code:0 }`                                | 组合只剩 600519.SH 一只持仓                                     |

#### 5.1.2 [BUG E2E-B2] P&L 计算中的 null 传播

```
场景：
  1. 添加持仓 000001.SZ 和 999999.ZZ（不存在的股票代码）
  2. 查看今日 P&L

当前行为（待验证）：
  - 000001.SZ 有行情数据 → pnl = (currentPrice - avgCost) * quantity（正常计算）
  - 999999.ZZ 无行情数据 → pnl = null
  - totalPnl = 正常值 + null = NaN（JS 的 number + null = NaN）

正确行为：
  - 对单只持仓返回 pnl: null
  - totalPnl 应跳过 null 值，仅统计有数据的持仓

E2E 测试：
  it('[BUG E2E-B2] 无行情数据的持仓不应污染 totalPnl', async () => {
    // 添加一只真实股票 + 一只无行情数据的股票
    // 期望：真实股票的 pnl 正确计算；totalPnl 不为 NaN
    // 当前行为：totalPnl 可能为 NaN（标注 [BUG]，待修复后反转断言）
  })
```

#### 5.1.3 风控规则检查

| # | 类别   | 测试场景                                          | 期望                                               | 验证点                                                  |
| - | ------ | ------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------- |
| 1 | `BIZ`  | 配置集中度规则（单股 < 30%），600519.SH 超过 30%  | `POST /api/portfolio/risk/check` 返回违规列表       | 违规项包含 tsCode、currentWeight、threshold              |
| 2 | `BIZ`  | 修复持仓（减仓至 30% 以下）后风控检查              | 无违规项                                           | isViolating = false                                     |
| 3 | `BIZ`  | 禁用风控规则后检查                                | 被禁用的规则不出现在结果中                          | 禁用逻辑生效                                            |
| 4 | `EDGE` | 组合无持仓时执行风控检查                          | 返回空违规列表，不报错                              | 空持仓边界                                              |

#### 5.1.4 [BUG E2E-B5] 回测导入组合的事务原子性

```
验证点（在 Flow 5 中详细测试，此处记录）：
  applyBacktest(mode: 'REPLACE') 的操作顺序：
  1. BEGIN TRANSACTION
  2. DELETE FROM portfolio_holdings WHERE portfolioId = ?
  3. INSERT INTO portfolio_holdings (新持仓)
  4. COMMIT

  问题：若步骤 3 失败（如股票代码不合法），步骤 2 的删除已执行，
  组合持仓被清空但无新持仓写入。

  期望行为：整个操作在单个数据库事务中，任意步骤失败则完整回滚。
```

---

## 六、Flow 4 — 因子筛选→保存策略→发起回测

**涉及模块**：`FactorModule`、`StrategyModule`、`BacktestModule`
**文件**：`test/e2e/flow-factor-strategy-backtest.e2e-spec.ts`
**验收标准**：因子筛选出股票池→保存为 FACTOR_SCREENING_ROTATION 策略→回测验证因子权重

### 6.1 场景设计

#### 6.1.1 因子筛选与保存策略

| # | 步骤                   | HTTP 请求                                                                                     | 期望                                      | 验证点                                                      |
| - | ---------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| 1 | 查询因子库             | `POST /api/factor/library`                                                                    | 包含内置因子列表（momentum、pb 等）        | 至少包含 `momentum_1m`、`pe_inv`                            |
| 2 | 执行因子筛选           | `POST /api/factor/screening` `{ factorCode: 'pe_inv', tradeDate: '20240630', topN: 5, universe: 'HS300' }` | `{ code:0, data: [{ tsCode, factorValue }] }` | 返回 5 只股票；factorValue 均大于 0（pe_inv = 1/PE > 0） |
| 3 | 将筛选条件保存为策略   | `POST /api/factor/backtest/save-as-strategy` `{ name: 'E2E因子策略', factorCode: 'pe_inv', topN: 5, ... }` | `{ code:0, data:{ strategyId } }`         | strategyType = `FACTOR_SCREENING_ROTATION`                  |
| 4 | 验证策略 config 完整性 | `POST /api/strategy/detail` `{ id: strategyId }`                                             | config 包含 factorCode、topN 等完整字段   | config 字段映射正确，无丢失                                 |
| 5 | 基于此策略发起回测     | `POST /api/backtest/runs` `{ strategyId, dateRange: {...}, initialCash: 100000 }`            | 回测正常完成（status = COMPLETED）         | 策略 config 到回测引擎的传递路径无损失                      |
| 6 | 验证回测持仓与因子一致 | `POST /api/backtest/runs/positions` `{ runId, date: '20240630' }`                            | 持仓的 tsCode 集合 ⊆ 因子筛选的股票集合   | 因子筛选结果被正确传递给回测引擎                            |

#### 6.1.2 因子筛选边界场景

| # | 类别   | 测试场景                                                      | 期望                           |
| - | ------ | ------------------------------------------------------------- | ------------------------------ |
| 1 | `EDGE` | universe 参数为空（筛选全市场）                               | 返回 topN 支股票，不报错       |
| 2 | `EDGE` | topN > 全市场股票数                                          | 返回实际所有股票，不报错       |
| 3 | `SEC`  | universe 参数包含 SQL 注入字符 `"HS300'; DROP TABLE--"`      | 400 + 校验错误，不执行 SQL     |
| 4 | `BIZ`  | 保存的策略 config 后续可通过 /strategy/schemas 校验通过      | validate 端点返回 isValid=true |

---

## 七、Flow 5 — 回测结果→导入组合→生成调仓单

**涉及模块**：`BacktestModule`、`PortfolioModule`
**文件**：`test/e2e/flow-backtest-to-portfolio.e2e-spec.ts`
**验收标准**：已完成的回测→一键导入组合→生成调仓计划，数量计算可验证

### 7.1 场景设计

#### 7.1.1 回测导入组合

前置：Flow 2 的回测已完成，runId 已知，最终持仓 `{ 000001.SZ: 1000股, 600519.SH: 10股 }`。

| # | 步骤                    | HTTP 请求                                                                                                     | 期望                                          | 验证点                                                           |
| - | ----------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------- |
| 1 | 创建目标组合            | `POST /api/portfolio/create` `{ name: '回测导入测试', initialCash: 100000 }`                                  | `{ code:0, data:{ id: portfolioId } }`        | 组合初始为空持仓                                                 |
| 2 | 使用 REPLACE 模式导入   | `POST /api/portfolio/apply-backtest` `{ runId, portfolioId, mode: 'REPLACE' }`                               | `{ code:0 }`                                  | 组合持仓 = 回测最终持仓；avgCost = 回测成本价                    |
| 3 | 验证导入后持仓          | `POST /api/portfolio/detail` `{ portfolioId }`                                                               | holdings 包含 000001.SZ 和 600519.SH          | 数量与回测最终持仓一致                                           |
| 4 | 再次 REPLACE（更新组合）| 先修改组合持仓，再次 `apply-backtest` 以不同 runId（持仓不同）                                               | 组合持仓替换为新回测的持仓                     | 旧持仓被删除，新持仓写入                                        |
| 5 | MERGE 模式导入          | `POST /api/portfolio/apply-backtest` `{ runId, portfolioId, mode: 'MERGE' }`                                  | 回测持仓与现有持仓合并，数量累加               | 000001.SZ 数量 = 现有 + 回测；avgCost = 加权平均                 |

#### 7.1.2 [BUG E2E-B5] REPLACE 模式事务原子性验证

```
测试步骤：
  1. 创建组合并添加持仓（A: 1000股, B: 500股）
  2. 准备一个含有无效股票代码（999999.ZZ）的 runId（通过 mock backtestRun）
  3. 调用 apply-backtest(mode: 'REPLACE')

期望行为（正确）：
  - 事务回滚，原有持仓 A 和 B 保留
  - 返回 400 或 500 错误

当前行为（待验证，可能存在 bug）：
  - 若无事务保护：A 和 B 被删除，无新持仓写入，组合变为空持仓

E2E 测试标注：
  it('[BUG E2E-B5] REPLACE 模式失败时应回滚原有持仓', async () => {
    // ...
  })
```

#### 7.1.3 生成调仓清单

| # | 步骤              | HTTP 请求                                                                                                             | 期望                                | 验证点                                                            |
| - | ----------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------- |
| 1 | 查询当前持仓市值  | `POST /api/portfolio/detail` `{ portfolioId }`                                                                       | 各持仓 currentValue（需最新行情）   | 基于 fixture 行情手算持仓市值                                     |
| 2 | 生成调仓计划      | `POST /api/portfolio/rebalance-plan` `{ portfolioId, targetWeights: { '000001.SZ': 0.6, '600519.SH': 0.4 } }`       | 调仓清单含 `{ tsCode, action, targetQuantity, currentQuantity }` | 手算：目标市值 = totalValue × 0.6，目标数量 = 目标市值 / 当前价格（取整手） |
| 3 | 验证调仓数量精度  | —                                                                                                                     | targetQuantity 为 100 的整数倍（整手） | A 股交易以 100 股为一手，不足一手四舍五入到整百                  |
| 4 | 停牌股票处理      | 将 000001.SZ 的当日行情标记为停牌（is_trade=0）                                                                      | 调仓计划中 000001.SZ 的 action = 'SKIP'，附注"当日停牌" | 停牌股票不生成调仓指令                                        |

---

## 八、Flow 6 — 预警规则→盘后扫描→触发通知

**涉及模块**：`AlertModule`、`SignalModule`
**文件**：`test/e2e/flow-alert-signal.e2e-spec.ts`
**验收标准**：创建价格预警规则→触发扫描→验证告警生成→WebSocket 通知（mock）

### 8.1 场景设计

#### 8.1.1 价格预警规则 CRUD 与触发

| # | 步骤                      | HTTP 请求                                                                                                               | 期望                                         | 验证点                                                 |
| - | ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| 1 | 创建价格预警规则          | `POST /api/alert/price-rules` `{ tsCode: '000001.SZ', conditionType: 'PRICE_ABOVE', threshold: 10.0 }`                | `{ code:0, data:{ ruleId, isEnabled: true } }` | 规则写入数据库，isEnabled=true                         |
| 2 | 触发扫描（模拟盘后）      | `POST /api/alert/price-rules/scan` `{ tradeDate: '20240630' }`（ADMIN 权限）                                            | `{ code:0, data:{ triggered, skipped } }`    | fixture 中 000001.SZ 在 20240630 收盘价 > 10.0 → triggered=1 |
| 3 | 查询触发的预警事件日历    | `POST /api/alert/calendar/list` `{ startDate: '20240630', endDate: '20240630' }`                                       | 包含 000001.SZ 的触发记录                    | 触发时间、股票代码、实际价格均正确                     |
| 4 | 禁用规则后再次扫描        | 先 `update` 将 isEnabled=false，再触发扫描                                                                             | triggered=0（被禁用规则不参与扫描）           | 禁用逻辑生效                                           |
| 5 | 修改阈值后扫描            | 将 threshold 改为 999（不可能触发），再扫描                                                                             | triggered=0                                  | 阈值修改后正确生效                                     |

#### 8.1.2 信号引擎联动

| # | 类别   | 测试场景                                                             | 期望                                    |
| - | ------ | -------------------------------------------------------------------- | --------------------------------------- |
| 1 | `BIZ`  | 激活信号策略后，盘后扫描产生 BUY/SELL 信号                          | `POST /api/signal/latest` 返回最新信号  |
| 2 | `BIZ`  | 停用信号策略后，扫描不产生信号                                      | 信号列表不新增记录                      |
| 3 | `BIZ`  | 同一股票同一交易日不产生重复信号（skipDuplicates 生效）             | 重复调用 scan 后信号条数不变            |

#### 8.1.3 [BUG E2E-B6] 扫描日期时区问题

```
场景（复现 P3-B6 的 E2E 版本）：
  scanPriceRules() 内部使用 new Date().toISOString().slice(0,10).replace(/-/g,'')
  确定当天扫描日期。

  在 CI 服务器（UTC 时区）上：
  - 触发时间：UTC 2024-06-30T20:00:00Z（对应 Asia/Shanghai 2024-07-01T04:00:00）
  - 解析日期：UTC → '20240630'（正确）
  - 但若触发时间为 UTC 2024-06-30T15:00:00Z（Asia/Shanghai 2024-06-30T23:00:00）
  - 解析日期：UTC → '20240630'（正确）

  潜在问题场景：
  - 触发时间：UTC 2024-06-29T17:00:00Z（Asia/Shanghai 2024-06-30T01:00:00）
  - UTC 解析日期：'20240629'（偏移一天，但当地时间已是 30 日）

建议修复：
  - 统一使用 dayjs().tz('Asia/Shanghai').format('YYYYMMDD') 确定当天日期

E2E 测试：
  it('[BUG E2E-B6] 使用跨日UTC时间时扫描日期应以Asia/Shanghai为准', ...)
  // 通过 mock Date 或 dayjs 固定时间验证
```

---

## 九、测试基础设施增强

### 9.1 E2E 专用 jest 配置增强

```json
// test/jest-e2e.json（更新版）
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": {
    "^.+\\.(t|j)s$": ["ts-jest", { "tsconfig": "tsconfig.json" }]
  },
  "moduleNameMapper": {
    "^src/(.*)$": "<rootDir>/src/$1"
  },
  "setupFilesAfterEnv": ["<rootDir>/test/setup.ts"],
  "globalSetup": "<rootDir>/test/e2e/global-setup.ts",
  "globalTeardown": "<rootDir>/test/e2e/global-teardown.ts",
  "testTimeout": 60000
}
```

### 9.2 globalSetup 与 globalTeardown

```typescript
// test/e2e/global-setup.ts
export default async function() {
  // 1. 确认 E2E_DATABASE_URL 已配置
  // 2. 运行 Prisma migrate deploy（创建 test_e2e schema）
  // 3. 写入 Fixture 市场数据（只运行一次）
  // 4. 确认 Redis db=15 可连接
}

// test/e2e/global-teardown.ts
export default async function() {
  // 1. 清理测试数据库所有测试数据
  // 2. flushDb() Redis db=15
}
```

### 9.3 E2E 请求辅助函数

```typescript
// test/helpers/e2e-request.ts

import request from 'supertest'
import { INestApplication } from '@nestjs/common'

export class E2eClient {
  private accessToken: string | null = null
  private agent: ReturnType<typeof request>

  constructor(app: INestApplication) {
    this.agent = request(app.getHttpServer())
  }

  async login(account: string, password: string): Promise<void> {
    // 1. 获取验证码
    // 2. 登录
    // 3. 保存 accessToken
  }

  post(path: string) {
    const req = this.agent.post(path)
    if (this.accessToken) {
      req.set('Authorization', `Bearer ${this.accessToken}`)
    }
    return req
  }

  async waitForBacktestCompletion(runId: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const res = await this.post('/api/backtest/runs/detail').send({ runId })
      if (res.body.data?.status === 'COMPLETED') return
      if (res.body.data?.status === 'FAILED') throw new Error(`回测失败: ${runId}`)
      await new Promise(r => setTimeout(r, 500))
    }
    throw new Error(`回测超时（${timeoutMs}ms）: ${runId}`)
  }
}
```

### 9.4 `.env.test` 配置模板

```env
# E2E 测试专用环境变量（不提交到版本控制）
E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/quant_test
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_DB=15
JWT_SECRET=e2e-test-secret-minimum-32-characters-long
NODE_ENV=test
```

---

## 十、CI 集成方案

### 10.1 CI workflow 增强

在现有 `.github/workflows/ci.yml` 基础上增加 E2E 测试阶段：

```yaml
# 在 ci.yml 中新增 e2e 阶段（在 unit-test 之后）
e2e-test:
  name: E2E Tests
  runs-on: ubuntu-latest
  needs: [test]   # 依赖 unit test 通过
  services:
    postgres:
      image: postgres:17
      env:
        POSTGRES_DB: quant_test
        POSTGRES_USER: postgres
        POSTGRES_PASSWORD: postgres
      ports: ['5432:5432']
      options: >-
        --health-cmd pg_isready
        --health-interval 10s
        --health-timeout 5s
        --health-retries 5
    redis:
      image: redis:7
      ports: ['6379:6379']
  env:
    E2E_DATABASE_URL: postgresql://postgres:postgres@localhost:5432/quant_test
    REDIS_HOST: localhost
    REDIS_PORT: 6379
    REDIS_DB: 15
    JWT_SECRET: e2e-test-secret-minimum-32-characters-long-for-ci
    NODE_ENV: test
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'pnpm'
    - run: pnpm install --frozen-lockfile
    - run: pnpm prisma migrate deploy
      env:
        DATABASE_URL: ${{ env.E2E_DATABASE_URL }}
    - run: pnpm test:e2e
      timeout-minutes: 10
```

### 10.2 分级测试策略

| 触发条件                | 运行范围               | 估计耗时 |
| ----------------------- | ---------------------- | -------- |
| feature 分支 push       | 仅 unit test           | 2-3 分钟 |
| PR to main              | unit test + E2E test   | 8-12 分钟|
| main 分支 push          | unit test + E2E test   | 8-12 分钟|
| 每周定时（周一 02:00）  | 全量（unit + E2E）     | 10-15 分钟|

---

## 十一、验收标准

### 11.1 Phase 6 验收要求

| 维度                     | 要求                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| **流程覆盖**             | 6 条核心业务链路全部有对应 E2E 测试文件                         |
| **用例数量**             | ≥ 30 个 E2E 用例（含正常路径、边界、安全场景）                  |
| **CI 自动化**            | E2E 测试可在 PR to main 时自动运行                               |
| **幂等性**               | 每次 E2E 测试运行前清理数据，多次运行结果一致                    |
| **可维护性**             | 使用 `E2eClient` 辅助类消除重复的认证/请求代码                   |
| **Bug 覆盖**             | E2E-B1 至 E2E-B6 均有对应测试用例（含 [BUG] 标注）              |
| **数值验证**             | Flow 2（回测结果）、Flow 3（持仓加权成本）、Flow 5（调仓数量）均有手算交叉验证 |

### 11.2 最终指标目标

| 指标                         | Phase 5 后    | Phase 6 目标  |
| ---------------------------- | ------------- | ------------- |
| 测试用例总数                 | ~900+         | ~930+         |
| E2E 测试文件数               | 0             | 5-6           |
| E2E 用例数                   | 0             | ~30           |
| 核心业务链路 E2E 覆盖        | 0%            | 100%（6/6）  |
| CI 自动化 E2E                | ❌            | ✅            |
| 发现的跨模块 Bug             | 0             | 6（E2E-B1~B6）|

---

## 十二、文件清单

### 12.1 新建文件

| 文件                                       | 说明                                |
| ------------------------------------------ | ----------------------------------- |
| `test/e2e/global-setup.ts`                 | Jest globalSetup（DB migrate + seed） |
| `test/e2e/global-teardown.ts`              | Jest globalTeardown（清理测试数据） |
| `test/helpers/e2e-module-factory.ts`       | 创建 E2E 测试 NestJS 应用的工厂函数 |
| `test/helpers/e2e-db-cleaner.ts`           | 按业务流程清理测试数据库             |
| `test/helpers/e2e-request.ts`              | E2eClient 辅助类（认证 + 请求封装） |
| `test/fixtures/e2e-market-data.seed.ts`    | E2E 用行情数据 Fixture（60 交易日） |
| `test/e2e/flow-auth.e2e-spec.ts`           | Flow 1：完整认证生命周期 E2E 测试    |
| `test/e2e/flow-strategy-backtest.e2e-spec.ts` | Flow 2：策略→回测全链路 E2E 测试    |
| `test/e2e/flow-portfolio-risk.e2e-spec.ts`| Flow 3：组合管理→风控全流程 E2E 测试 |
| `test/e2e/flow-factor-strategy-backtest.e2e-spec.ts` | Flow 4：因子筛选→策略→回测 E2E 测试 |
| `test/e2e/flow-backtest-to-portfolio.e2e-spec.ts` | Flow 5：回测→导入组合→调仓单 E2E 测试 |
| `test/e2e/flow-alert-signal.e2e-spec.ts`  | Flow 6：预警规则→扫描→通知 E2E 测试  |
| `.env.test.example`                        | E2E 环境变量模板（加入版本控制）     |

### 12.2 修改文件

| 文件                            | 变更说明                                       |
| ------------------------------- | ---------------------------------------------- |
| `test/jest-e2e.json`            | 增加 globalSetup/globalTeardown，设置 testTimeout=60000 |
| `.github/workflows/ci.yml`      | 新增 e2e-test 阶段（含 PostgreSQL + Redis 服务容器） |

---

## 附录 A：E2E Bug 清单汇总

| Bug ID    | 严重度 | 流程   | 描述                                            | 修复建议                                          |
| --------- | :----: | ------ | ----------------------------------------------- | ------------------------------------------------- |
| E2E-B1   | S2    | Flow 2 | E2E 环境回测永停 PENDING（BullMQ worker 未启动） | 使用内联 BacktestProcessor 绕过队列执行           |
| E2E-B2   | S2    | Flow 3 | null 持仓 pnl 导致 totalPnl = NaN               | 累加时过滤 null 值                                |
| E2E-B3   | S1    | Flow 1 | 已过期 Token 黑名单 TTL ≤ 0，黑名单失效         | `if (ttl <= 0) return;`                           |
| E2E-B4   | S3    | Flow 2 | strategy.run vs backtest.createRun 日期格式不一致| 统一为 `YYYYMMDD` 或 `YYYY-MM-DD`，并在入口做转换  |
| E2E-B5   | S2    | Flow 5 | REPLACE 模式无事务保护，失败时组合变空持仓       | 整个 apply-backtest 操作包裹在 `prisma.$transaction` 中 |
| E2E-B6   | S3    | Flow 6 | 扫描日期使用 UTC，跨日时偏移一天                 | 改为 `dayjs().tz('Asia/Shanghai').format('YYYYMMDD')` |
