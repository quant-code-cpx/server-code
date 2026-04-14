# 测试重构 Phase 1 — 设计方案

> **范围**：测试重构总纲 §三（P0 优先级模块）：Auth 认证、Backtest Engine 回测引擎、Portfolio 组合管理
> **原则**：SKILL.md §15 — 期望值从业务规则独立推导，代码视为可疑对象，用 `[BUG]` 标签标记当前行为偏差
> **目标**：~66 个新增/重写用例（超出总纲初始估算 ~50 个，因审计发现更多边界场景），至少发现 3 个现有代码 Bug
> **前置**：无（Phase 1 为首个阶段）

---

## 一、源码审计 Bug 清单

### 1.1 严重度标准

| 等级   | 含义                                 | 举例                       |
| :----: | ------------------------------------ | -------------------------- |
| **S1** | 安全风险或数据损坏                   | 竞态导致锁机制失效、资金计算错误 |
| **S2** | 计算结果错误，影响用户决策           | Sharpe 公式偏差、成本价精度丢失 |
| **S3** | 边界条件异常或语义歧义，不影响主流程 | 空持仓 NaN、闰年日期偏移   |

### 1.2 Bug 清单

| Bug ID    | 严重度 | 模块            | 位置                                    | 描述 |
| --------- | :----: | --------------- | --------------------------------------- | ---- |
| **P1-B1** |   S1   | Auth            | `handleLoginFail()` INCR + EXPIRE       | `INCR` 与 `EXPIRE` 之间不是原子操作。首次失败后若 `EXPIRE` 前进程崩溃/超时，fail key 将无 TTL，永远不过期。攻击者可利用此特性使计数器在 5 分钟窗口过期后仍然存在，无限延迟锁定触发。 |
| **P1-B2** |   S2   | Auth            | `login()` 不存在用户无 bcrypt 调用      | 不存在账户直接返回 `false`（~0ms），存在账户需 bcrypt.compare（~10ms）。虽然 bcrypt 本身抗时间攻击，但存在/不存在账户的响应时间差可用于账户枚举。当前为已知设计权衡。 |
| **P1-B3** |   S2   | Auth            | `refreshToken()` 宽限期多设备竞态       | 客户端 A 刷新 → RT 标记为 `'used'`。10 秒内客户端 B 用旧 RT 刷新 → 看到 `'grace'` 状态 → 获得新 AT（不含新 RT）。攻击者截获旧 RT 后可在宽限期内获取新 AT。 |
| **P1-B4** |   S2   | Backtest Engine | `computePositionValueWithAdjFactor()`   | 当某股票无当日行情（停牌/退市/数据缺失）时，回退使用 `costPrice` 代替市场价。若 costPrice < 上一日收盘价则 NAV 偏低，反之偏高。计算出的收益率、夏普、最大回撤均不准确。 |
| **P1-B5** |   S2   | Backtest Metrics| Sharpe/Sortino/Beta/IR 方差计算         | 所有方差/标准差计算均使用**总体方差**（除以 n）而非**样本方差**（除以 n-1）。对 n 较小的回测（如 20 个交易日），Sharpe 被系统性高估约 2.5%。 |
| **P1-B6** |   S1   | Backtest Exec   | `executeBuySignals()` 资金检查          | `portfolio.cash < amount` 仅检查股价×数量，未计入佣金和滑点。当现金刚好等于股票成交额时，扣除佣金后现金变负，属于资金数据损坏。 |
| **P1-B7** |   S2   | Backtest Engine | `annualizedReturn` 极端亏损             | `Math.pow(1 + totalReturn, 1 / years)`：当 `totalReturn < -1`（理论上不应出现但无保护）时，底数为负，奇数幂根返回 NaN，污染所有下游指标。 |
| **P1-B8** |   S2   | Portfolio       | `addHolding()` 加权平均成本精度丢失     | `Number(existing.avgCost)` 将 Prisma `Decimal` 转为 JS `Number`（IEEE 754 双精度），对高精度金额存在精度丢失。多次加仓后累积误差可达 ±0.01 元（分级别）。 |
| **P1-B9** |   S2   | Portfolio       | `calcPnlToday()` 除零风险              | `totalPnl / (totalMv - totalPnl)`：若 `totalPnl ≈ totalMv`（当日涨幅接近 100%），分母趋近零，返回 Infinity 或极大值。 |
| **P1-B10**|   S3   | Risk Check      | `checkMaxDrawdown()` 闰年日期偏移       | `start.setFullYear(year - 1)`：若 latestDate 为 2月29日（闰年），前推一年得到 2月28日→自动偏移为 3月1日，日期范围差 1-2 天。 |
| **P1-B11**|   S3   | Risk Check      | `checkMaxDrawdown()` NAV 默认值         | `costBasis > 0 ? mv / cb : 1`：成本为零时 NAV 默认为 1（完全错误），新建空组合不应有 NAV=1。 |
| **P1-B12**|   S3   | Risk Check      | `checkSinglePosition()` 空持仓          | `result.positions[0]` 可能为 `undefined`，`topPos?.stockName ?? ''` 返回空字符串。用户看到"占比 X%"但无股票名。 |
| **P1-B13**|   S3   | Risk Check      | `checkIndustryWeight()` null 权重       | `maxIndustry.weight ?? 0`：若所有行业权重为 `null`，`maxWeight = 0`，规则永远不触发。 |
| **P1-B14**|   S3   | Risk Check      | WebSocket 发送无 try-catch              | `eventsGateway.emitToUser()` 未包裹异常处理，若 WS 连接断开，整个 `runCheck()` 调用失败，违规记录虽已写入 DB 但用户不知。 |
| **P1-B15**|   S2   | Portfolio Perf  | Sharpe 缺少无风险利率                   | `annualizedReturn / annualizedVolatility` 未减去无风险利率，与 BacktestMetrics 的 Sharpe 定义不一致（后者使用 2% 无风险利率）。同一用户看到两个不同的 Sharpe。 |
| **P1-B16**|   S3   | Portfolio Perf  | `lastKnownPrice` 初始化为 avgCost       | 首日无行情时使用 `avgCost` 作为市价，若买入价与首日收盘价差距大，首日 NAV 偏差明显。 |
| **P1-B17**|   —    | Backtest Metrics| `maxDrawdown` 空序列                    | ⚠️ **非 Bug，需验证行为**：`Math.min(...navRecords.map(r => r.drawdown), 0)`：空数组时 `Math.min(0) = 0`（安全），但 `navRecords.map(r => r.drawdown)` 返回空数组，`Math.min(...[], 0) = 0`（正确）。 |

---

## 二、测试基础设施增强

### 2.1 新增测试辅助工具

Phase 1 需要以下测试辅助工具来支撑高质量测试编写。所有工具放在 `test/helpers/` 目录。

#### 2.1.1 金融计算参考值工具 — `test/helpers/financial-calc.ts`

```typescript
/**
 * 独立于被测代码的金融计算参考实现，用于交叉验证。
 * 所有公式使用样本方差（n-1），与标准金融学定义一致。
 */
export class FinancialCalc {
  /**
   * 手动计算 Sharpe Ratio（样本标准差版本）
   * @param dailyReturns 日收益率序列
   * @param riskFreeRate 年化无风险利率（默认 0.02）
   * @param tradingDays 年交易日数（默认 252）
   */
  static sharpeRatio(dailyReturns: number[], riskFreeRate = 0.02, tradingDays = 252): number

  /**
   * 手动计算 Sortino Ratio（样本下行标准差）
   */
  static sortinoRatio(dailyReturns: number[], riskFreeRate = 0.02, tradingDays = 252): number

  /**
   * 手动计算最大回撤（从 NAV 序列）
   */
  static maxDrawdown(navSeries: number[]): number

  /**
   * 手动计算 Beta（样本协方差 / 样本方差）
   */
  static beta(portfolioReturns: number[], benchmarkReturns: number[]): number

  /**
   * 手动计算加权平均成本（精确 Decimal 运算）
   * @returns string 格式，精确到 6 位小数
   */
  static weightedAvgCost(
    existingQty: number, existingCost: number,
    addQty: number, addCost: number
  ): string

  /**
   * 手动计算日盈亏：yesterdayMV × pctChg / 100
   */
  static todayPnl(close: number, pctChg: number, quantity: number): number

  /**
   * 手动计算年化收益率
   */
  static annualizedReturn(totalReturn: number, tradingDays: number, daysPerYear?: number): number
}
```

#### 2.1.2 并发测试辅助 — `test/helpers/concurrency.ts`

```typescript
/**
 * 并发执行辅助：同时发起 N 个异步操作，收集结果和异常。
 */
export async function runConcurrent<T>(
  tasks: Array<() => Promise<T>>,
): Promise<Array<{ result?: T; error?: Error }>>

/**
 * 竞态条件检测器：多次运行同一操作对，检查结果是否一致。
 */
export async function detectRace<T>(
  operation: () => Promise<T>,
  times: number,
): Promise<{ results: T[]; isConsistent: boolean }>
```

#### 2.1.3 Mock 增强 — `test/helpers/redis-mock-enhanced.ts`

```typescript
/**
 * 增强版 Redis Mock：支持 TTL 模拟和原子操作验证。
 * 与现有 buildRedisMock() 兼容，但增加 TTL 行为模拟。
 */
export function buildRedisMockWithTTL(): EnhancedRedisMock

interface EnhancedRedisMock {
  // 基础操作
  get: jest.Mock
  set: jest.Mock
  del: jest.Mock
  getDel: jest.Mock
  exists: jest.Mock
  incr: jest.Mock
  expire: jest.Mock

  // TTL 模拟
  _store: Map<string, { value: string; ttl?: number; createdAt: number }>
  _advanceTime(seconds: number): void  // 模拟时间前进
  _getWithTTL(key: string): { value: string | null; remainingTTL: number }
}
```

---

## 三、Auth 模块测试重构

### 3.1 auth.service.spec.ts — 现有 38 个用例，需新增 ~15 个

**文件**：`src/apps/auth/test/auth.service.spec.ts`
**现状**：已覆盖基本 CAPTCHA / 登录 / 刷新 / 登出流程，安全边界测试不足。

#### 3.1.1 账户锁定机制测试

```
describe('handleLoginFail() — 账户锁定')

  it('[BIZ] 连续 4 次失败后不锁定，第 5 次失败才锁定')
    // LOGIN_MAX_FAIL = 5
    // 模拟 redis.incr 返回 4 → 不触发 lock
    // 模拟 redis.incr 返回 5 → 触发 set lock key + del fail key
    mock: redis.incr → 4
    expect: redis.set 未被调用（lock key 不存在）
    mock: redis.incr → 5
    expect: redis.set 被调用，key 为 'auth:login:lock:{account}'，TTL = 600

  it('[BIZ] 成功登录后失败计数器应被清除')
    // 连续失败 3 次后，正确登录
    // 验证 redis.del('auth:login:fail:{account}') 被调用
    mock: 用户存在，密码正确，状态 ACTIVE
    expect: redis.del 被调用，参数包含 failKey

  it('[SEC] 账户锁定后使用正确密码仍应拒绝')
    // lock key 存在 → 无论密码是否正确，都返回 INVALID_USERNAME_PASSWORD
    mock: redis.exists(lockKey) → 1
    expect: throw BusinessException(INVALID_USERNAME_PASSWORD)
    expect: 不调用 bcrypt.compare（不执行密码验证）
    expect: 不调用 prisma.user.findUnique（不查数据库）

  it('[BUG P1-B1] INCR 和 EXPIRE 之间非原子操作：首次失败后若 EXPIRE 未执行，failKey 无 TTL')
    // 模拟 redis.incr 返回 1（首次失败）
    // 正常流程应执行 redis.expire(failKey, 300)
    // 记录当前行为：INCR 成功后 EXPIRE 被调用
    mock: redis.incr → 1
    expect: redis.expire 被调用，参数为 (failKey, 300)
    // 当前行为正确，但不是原子操作
    // [BUG] 若 INCR 后 EXPIRE 前服务崩溃，failKey 将永不过期
    // 修复方案：使用 Lua 脚本实现原子 INCR + EXPIRE

  it('[BUG P1-B1 补充] EXPIRE 调用失败时 failKey 无 TTL — 锁定机制被绕过')
    // 模拟 redis.incr 返回 1（首次失败）
    // 模拟 redis.expire 抛出异常（网络超时）
    mock: redis.incr → 1
    mock: redis.expire → throw Error('connection timeout')
    // 当前代码：EXPIRE 失败是否被 catch？
    // 如果无 catch → handleLoginFail 抛异常，但 fail key 已存在且无 TTL
    // 结果：fail key 永不过期，后续 INCR 累加但永远基于旧 key
    expect: 验证当前异常传播行为
    // [BUG] 修复方案同上：Lua 脚本或 SET NX EX 替代 INCR + EXPIRE

  it('[EDGE] 失败计数恰好为 LOGIN_MAX_FAIL - 1 时不触发锁定')
    mock: redis.incr → 4 (LOGIN_MAX_FAIL - 1)
    expect: redis.set(lockKey) 未被调用
    expect: redis.del(failKey) 未被调用

  it('[EDGE] 失败计数 > LOGIN_MAX_FAIL 时仍触发锁定（>= 判断）')
    // 并发场景：多个请求同时 INCR 可能使 count > 5
    mock: redis.incr → 7
    expect: redis.set(lockKey) 被调用
    expect: redis.del(failKey) 被调用
```

#### 3.1.2 Token 刷新安全测试

```
describe('refreshToken() — 安全边界')

  it('[SEC] 已禁用用户在宽限期内刷新应被拒绝')
    // RT 有效（Redis 值 = 'grace'），但用户已被禁用
    mock: tokenService.verifyRefreshToken → { userId, jti }
    mock: tokenService.isRefreshTokenValid → 'grace'
    mock: prisma.user.findUnique → { status: 'DISABLED' }
    expect: throw BusinessException(USER_DISABLED)

  it('[SEC] 已删除用户刷新应被拒绝')
    mock: tokenService.verifyRefreshToken → { userId, jti }
    mock: tokenService.isRefreshTokenValid → 'valid'
    mock: prisma.user.findUnique → null
    expect: throw BusinessException(USER_DISABLED)

  it('[BUG P1-B3] 宽限期内多设备刷新：第二个设备获得新 AT 但无新 RT')
    // 客户端 A 已完成正常刷新（RT 状态变为 'used'）
    // 客户端 B 在 10 秒内用旧 RT 刷新
    mock: tokenService.isRefreshTokenValid → 'grace'
    mock: prisma.user.findUnique → { status: 'ACTIVE' }
    expect: 返回 { accessToken: 新值, refreshToken: null }
    // 记录当前行为：宽限期内返回新 AT + null RT
    // [BUG] 攻击者截获旧 RT 可在宽限期内获取新 AT

  it('[BIZ] 正常轮换：首次使用 RT → 获得新 AT + 新 RT')
    mock: tokenService.isRefreshTokenValid → 'valid'
    mock: prisma.user.findUnique → { status: 'ACTIVE', role: 'USER' }
    expect: tokenService.revokeRefreshToken 被调用（标记旧 RT）
    expect: tokenService.generateTokens 被调用（生成新对）
    expect: 返回 { accessToken: 新值, refreshToken: 新值 }

  it('[EDGE] RT 已超过宽限期（Redis 返回 invalid）')
    mock: tokenService.isRefreshTokenValid → 'invalid'
    expect: throw BusinessException(INVALID_REFRESH_TOKEN)
    expect: 不查询数据库（节省 DB 调用）
```

#### 3.1.3 登出机制测试

```
describe('logout() — 安全边界')

  it('[SEC] 已过期的 AT 登出不应报错')
    // AT 过期 → blacklistAccessToken 内部捕获异常
    // 结果：不写黑名单（已自然过期，无需处理）
    mock: tokenService.blacklistAccessToken → 不抛异常（内部 try-catch）
    expect: 调用 blacklistAccessToken，方法正常返回

  it('[SEC] 空 AT 字符串登出应静默成功')
    // 控制器在无 Authorization header 时传 ''
    call: authService.logout('', undefined)
    expect: blacklistAccessToken('') 被调用
    expect: 不抛异常

  it('[SEC] 有效 AT + 无效 RT 登出：AT 正常黑名单，RT 静默跳过')
    mock: tokenService.blacklistAccessToken → void
    mock: tokenService.verifyRefreshToken → throw Error('invalid')
    call: authService.logout(validAT, invalidRT)
    expect: blacklistAccessToken 被调用
    expect: deleteRefreshToken 未被调用（RT 验证失败被 catch）

  it('[BIZ] 登出后 AT 被加入黑名单，JwtAuthGuard 应拒绝后续请求')
    // 集成验证：blacklistAccessToken 写入 Redis
    // isAccessTokenBlacklisted 读取 Redis → true
    mock: redis.set → void（写入黑名单）
    mock: redis.exists → 1（黑名单中存在）
    expect: isAccessTokenBlacklisted(jti) 返回 true
```

#### 3.1.4 输入校验边界测试

```
describe('login() — 输入边界')

  it('[EDGE] 密码含前后空格时不应 trim')
    // readLoginField(dto.password) 不 trim
    // 密码 "  abc  " 应保持原样进行 bcrypt 比较
    mock: dto.password = '  secret  '
    expect: bcrypt.compare 调用参数为 '  secret  '（含空格）

  it('[EDGE] account 含前后空格时应 trim')
    mock: dto.account = '  admin  '
    expect: prisma.user.findUnique 调用参数为 { account: 'admin' }

  it('[EDGE] 全空格的 account 应返回 INVALID_USERNAME_PASSWORD')
    mock: dto.account = '   '
    // readLoginField trim 后为空 → 返回 null → 触发异常
    expect: throw BusinessException(INVALID_USERNAME_PASSWORD)

  it('[EDGE] captchaCode 大小写不敏感')
    // generateCaptcha 存储小写，validateCaptcha 比较时转小写
    mock: redis.getDel → 'abcd'（存储时已小写）
    call: validateCaptcha('captcha-id', 'AbCd')
    expect: 不抛异常（'abcd' === 'abcd'）
```

### 3.2 auth.controller.spec.ts — 现有 9 个用例，需新增 ~4 个

**文件**：`src/apps/auth/test/auth.controller.spec.ts`
**现状**：仅覆盖 happy path。

使用 `test/helpers/create-test-app.ts` 的 `createTestApp()` 构建带 ValidationPipe 的测试应用。

```
describe('AuthController — 集成测试')

  it('[VAL] POST /auth/login 空 body → 400')
    // LoginDto 缺少 @IsNotEmpty()（BUG P4-B1），但当前 @Allow() 允许空 body
    // 记录当前行为：空 body 通过 DTO 校验，进入 Service 层
    send: {}
    expect: Service 层抛出异常（account/password 为空）

  it('[ERR] POST /auth/login Service 抛 UnauthorizedException → 401')
    mock: authService.login → throw UnauthorizedException
    send: { account: 'test', password: '123', captchaId: 'x', captchaCode: 'y' }
    expect: 401

  it('[ERR] POST /auth/refresh 无 Cookie → 触发 Service 异常')
    // Controller 从 req.cookies 读取 refresh_token
    // 无 Cookie 时为 undefined，传入 Service
    send: POST /auth/refresh（无 Cookie）
    expect: Service 因 undefined token 抛出 INVALID_REFRESH_TOKEN

  it('[BIZ] POST /auth/logout 响应不应包含 token 相关敏感信息')
    mock: authService.logout → void
    send: POST /auth/logout（携带有效 Authorization）
    expect: 响应 body 中不含 accessToken/refreshToken 字段
```

---

## 四、回测引擎测试重构

### 4.1 backtest-engine.service.spec.ts — 现有 38 个用例，需新增 ~12 个

**文件**：`src/apps/backtest/test/backtest-engine.service.spec.ts`

#### 4.1.1 NAV 计算核心测试

```
describe('NAV 计算 — 端到端验证')

  it('[BIZ] 简单买入持有：100 万本金买入 1000 股 @100，次日涨 5% → NAV 变化')
    // 手算：
    // Day 0: 买入 1000 股 × 100 = 100,000，佣金 = max(100000 × 0.0002, 5) = 20
    //         滑点 = 100000 × 5 / 10000 = 50
    //         实际支出 = 100,000 + 20 + 50 = 100,070
    //         cash = 1,000,000 - 100,070 = 899,930
    //         posValue = 1000 × 100 = 100,000
    //         NAV = 899,930 + 100,000 = 999,930
    // Day 1: 股价 105，posValue = 1000 × 105 = 105,000
    //         NAV = 899,930 + 105,000 = 1,004,930
    //         dailyReturn = 1,004,930 / 999,930 - 1 ≈ 0.005002
    expect: Day 0 NAV ≈ 999,930
    expect: Day 1 NAV ≈ 1,004,930
    expect: Day 1 dailyReturn ≈ 0.005002

  it('[BUG P1-B4] 停牌日无行情时回退到 costPrice — NAV 计算错误')
    // 股票 A：买入 100 股 @50 = 5,000（costPrice = 50）
    // Day 1: 股价涨到 60 → posValue = 6,000
    // Day 2: 停牌，无行情 → 当前代码回退到 costPrice = 50
    //         posValue = 100 × 50 = 5,000（而非上一日的 6,000）
    //         NAV 偏低 1,000（costPrice < 上一日收盘价时偏低，反之偏高）
    // 正确行为：应使用上一交易日收盘价 60，即 posValue = 6,000
    mock: Day 2 bars 不含该股票
    expect（当前行为）: posValue = 5,000（使用 costPrice）
    // [BUG] 正确应为 posValue = 6,000（使用上一日收盘价）

  it('[EDGE] 空持仓 + 零现金 → NAV 应为 0')
    mock: portfolio = { cash: 0, positions: [] }
    expect: NAV = 0
    expect: drawdown = 0（不应除零）

  it('[EDGE] 首日无基准行情 → benchmarkBase 应安全初始化')
    mock: benchmarkBars 首日为空
    expect: benchmarkReturn = 0（非 NaN）
    expect: 后续日基准计算正常
```

#### 4.1.2 交易执行测试

```
describe('executeBuySignals() — 资金和成本')

  it('[BUG P1-B6] 现金恰好等于股价×数量时，扣除佣金后现金变负')
    // cash = 10,000，买入 100 股 @100 = 10,000
    // 佣金 = max(10000 × 0.0002, 5) = 5
    // 滑点 = 10000 × 5 / 10000 = 5
    // 总支出 = 10,000 + 5 + 5 = 10,010
    // cash 检查：10,000 < 10,000 → false（通过检查！）
    // 扣款后：cash = 10,000 - 10,010 = -10（负现金！）
    mock: portfolio.cash = 10000, execPrice = 100, rawQty = 100
    expect（当前行为）: cash = -10（负值）
    // [BUG] 资金检查应包含佣金和滑点

  it('[BIZ] T+1 限制：今日卖出的股票不能当日买入')
    // config.enableT1Restriction = true
    // 先执行 SELL 600456
    // 再尝试 BUY 600456 → 应被跳过
    mock: soldToday = Set(['600456.SH'])
    expect: 不执行 600456 的买入

  it('[BIZ] 印花税仅在卖出时收取（A 股规则）')
    // 卖出成交额 50,000
    // stampDuty = 50000 × 0.001 = 50
    // 买入不收印花税
    mock: config.stampDutyRate = 0.001
    expect（卖出）: stampDuty = 50
    expect（买入）: stampDuty = 0

  it('[EDGE] 买入后合并持仓的加权平均成本（含滑点）')
    // 已有 100 股 @50，买入 200 股 @60（含滑点后 actualPrice = 60.03）
    // 新 avgCost = (100 × 50 + 200 × 60.03) / 300 = 17,006 / 300 ≈ 56.687
    mock: existing pos = { qty: 100, costPrice: 50 }
    mock: buy 200 股, actualPrice = 60.03
    expect: costPrice ≈ 56.687
```

#### 4.1.3 调仓日判定测试

```
describe('checkRebalanceDay() — 跨周/月/年边界')

  it('[BIZ] WEEKLY：周五到下周一应触发调仓')
    // 2025-01-03（周五）→ 2025-01-06（周一）
    // ISO week: 1 → 2（跨周）
    mock: prevDate = new Date('2025-01-03'), currDate = new Date('2025-01-06')
    expect: true

  it('[EDGE] MONTHLY：1月31日 → 2月1日应触发')
    mock: prevDate = new Date('2025-01-31'), currDate = new Date('2025-02-01')
    expect: true

  it('[EDGE] MONTHLY：2月28日 → 3月1日（非闰年）应触发')
    mock: prevDate = new Date('2025-02-28'), currDate = new Date('2025-03-01')
    expect: true

  it('[EDGE] YEARLY：12月31日 → 1月2日（跨年+元旦休市）应触发')
    mock: prevDate = new Date('2025-12-31'), currDate = new Date('2026-01-02')
    expect: true

  it('[BIZ] WEEKLY：首个交易日（idx=0）始终触发')
    mock: idx = 0, frequency = 'WEEKLY'
    expect: true
```

#### 4.1.4 复权因子测试

```
describe('computePositionValueWithAdjFactor() — 送转/配股')

  it('[BIZ] 10 送 10：adjFactor 从 10 变为 5 → 数量 ×2，成本 ×0.5')
    // 原始：100 股，adjFactor = 10
    // 送转后：adjFactor = 5，ratio = 10 / 5 = 2
    // 新数量 = Math.round(100 × 2) = 200
    // 新成本 = costPrice / 2
    mock: prevAdjFactor = 10, currAdjFactor = 5
    expect: quantity = 200, costPrice = 原来一半

  it('[EDGE] 连续 3 次 10 送 10 的累积精度')
    // 100 股 → 200 → 400 → 800
    // adjFactor: 10 → 5 → 2.5 → 1.25
    // 每次 Math.round 不会累积误差（整数倍）
    expect: 最终 quantity = 800

  it('[EDGE] adjFactor = 0 或负值（数据质量问题）')
    // adjFactor ≤ 0 → ratio = 0 或负
    // 当前代码：可能导致 quantity = 0 或负
    mock: adjFactor = 0
    expect: 应有保护机制（默认 ratio = 1 或抛异常）
```

### 4.2 backtest-metrics.service.spec.ts — 现有 32 个用例，需新增 ~10 个

**文件**：`src/apps/backtest/test/backtest-metrics.service.spec.ts`

#### 4.2.1 Sharpe Ratio 手算交叉验证

```
describe('computeMetrics() — Sharpe Ratio 精确验证')

  it('[BIZ] 已知 5 日收益序列的 Sharpe Ratio 手算值')
    // 日收益率：[0.01, -0.005, 0.02, 0.005, -0.002]
    // RISK_FREE_RATE = 0.02, TRADING_DAYS = 252
    // dailyRfRate = 0.02 / 252 ≈ 0.00007937
    // excessReturns = [0.00992, -0.00508, 0.01992, 0.00492, -0.00208]
    // mean = 0.00554
    // 总体方差（当前代码）= Σ(r-mean)² / 5 = 0.0000805
    // 总体 stdDev = 0.00897
    // 年化总体 stdDev = 0.00897 × √252 = 0.14237
    // totalReturn = (1.01 × 0.995 × 1.02 × 1.005 × 0.998) - 1 = 0.02795
    // years = 5 / 252
    // annualizedReturn = (1.02795)^(252/5) - 1 ≈ 3.296
    // Sharpe（当前代码）= (3.296 - 0.02) / 0.14237 ≈ 23.01
    input: navRecords 从收益率序列构造
    expect: sharpeRatio ≈ 23.01（使用 toBeCloseTo(23.01, 0)）

  it('[BUG P1-B5] 总体方差 vs 样本方差的偏差验证')
    // 同一组数据，用 FinancialCalc.sharpeRatio（样本方差）计算
    // 样本方差 = Σ(r-mean)² / (5-1) = 0.000101
    // 样本 stdDev = 0.01003
    // 年化样本 stdDev = 0.01003 × √252 = 0.15921
    // Sharpe（样本方差）= (3.296 - 0.02) / 0.15921 ≈ 20.59
    // 偏差 = (23.01 - 20.59) / 20.59 ≈ 11.7%（n=5 时偏差显著！）
    expect（当前代码）: sharpeRatio ≈ 23.01
    // [BUG] 应使用样本方差，正确值 ≈ 20.59

  it('[EDGE] 单个交易日 → Sharpe 应为 0')
    input: 仅 1 个 navRecord
    expect: sharpeRatio = 0

  it('[EDGE] 所有日收益率完全相同（零波动）→ Sharpe 应为 0')
    input: 5 日收益率全为 0.01
    // stdDev = 0 → annualizedStd = 0 → 1e-8 阈值 → Sharpe = 0
    expect: sharpeRatio = 0

  it('[EDGE] 所有日收益率为 0 → Sharpe 应为负（超额收益为负）')
    // excessReturns 全为 -dailyRfRate
    // mean = -dailyRfRate, stdDev ≈ 0 → Sharpe = 0（因阈值保护）
    expect: sharpeRatio = 0
```

#### 4.2.2 Max Drawdown 手算验证

```
describe('computeMetrics() — Max Drawdown 精确验证')

  it('[BIZ] 已知 NAV 序列的最大回撤手算值')
    // NAV: [100, 105, 103, 110, 95, 108]
    // HWM: [100, 105, 105, 110, 110, 110]
    // DD:  [0,   0,  -1.90%, 0, -13.64%, -1.82%]
    // maxDD = -13.64%
    input: navRecords 从 NAV 序列构造
    expect: maxDrawdown ≈ -0.1364

  it('[EDGE] NAV 单调递增 → maxDrawdown = 0')
    input: NAV = [100, 101, 102, 103, 104]
    expect: maxDrawdown = 0

  it('[EDGE] NAV 单调递减 → maxDrawdown = (首日 - 末日) / 首日')
    input: NAV = [100, 95, 90, 85, 80]
    // maxDD = (100 - 80) / 100 = -20%
    expect: maxDrawdown ≈ -0.20
```

#### 4.2.3 年化收益率边界测试

```
describe('computeMetrics() — 年化收益率边界')

  it('[BUG P1-B7] totalReturn < -1 时 annualizedReturn 返回 NaN')
    // 理论上不应出现，但无保护
    // Math.pow(1 + (-1.5), 1/years) = Math.pow(-0.5, ...) → NaN
    // 需验证当前行为
    input: navRecords 使 totalReturn = -1.5（构造极端场景）
    expect: annualizedReturn 为 NaN 或被保护为 -1

  it('[EDGE] 恰好 252 个交易日 → years = 1 → 年化收益 = 总收益')
    input: 252 个 navRecords, totalReturn = 0.15
    expect: annualizedReturn ≈ 0.15

  it('[EDGE] 仅 2 个交易日 → 年化放大效应')
    input: 2 个 navRecords, totalReturn = 0.01
    // years = 2/252, annualized = (1.01)^(252/2) - 1 = (1.01)^126 - 1 ≈ 2.52
    expect: annualizedReturn ≈ 2.52（验证公式正确性）
```

#### 4.2.4 Alpha/Beta 手算验证

```
describe('computeMetrics() — Alpha & Beta')

  it('[BIZ] 已知组合与基准收益序列的 Beta 手算值')
    // portfolioReturns: [0.01, -0.005, 0.02, 0.005, -0.002]
    // benchmarkReturns: [0.008, -0.003, 0.015, 0.002, 0.001]
    // 手算 Beta（总体方差版本，当前代码使用）:
    //   covariance = 0.0000570, bmVariance = 0.0000534
    //   Beta = 1.067
    expect: beta ≈ 1.067

  it('[EDGE] 基准收益率全为 0 → Beta 应为 0（避免除零）')
    input: benchmarkReturns 全为 0
    // bmVariance = 0 → 应有保护
    expect: beta = 0
```

---

## 五、组合管理测试重构

### 5.1 portfolio.service.spec.ts — 现有 19 个用例，需新增 ~12 个

**文件**：`src/apps/portfolio/test/portfolio.service.spec.ts`

#### 5.1.1 加权平均成本核心测试

```
describe('addHolding() — 加权平均成本计算')

  it('[BIZ] 首次加仓：100 股 @10 → avgCost = 10')
    mock: 无现有持仓
    input: { quantity: 100, avgCost: 10 }
    expect: prisma.portfolioHolding.create 参数中 avgCost = 10

  it('[BIZ] 加仓：已有 100 股 @10，加 200 股 @15 → avgCost = 13.333')
    // 手算：(100 × 10 + 200 × 15) / 300 = 4000 / 300 ≈ 13.333
    mock: existing = { quantity: 100, avgCost: Decimal(10) }
    input: { quantity: 200, avgCost: 15 }
    expect: avgCost ≈ 13.333（toBeCloseTo(13.333, 3)）

  it('[BUG P1-B8] 多次加仓后浮点精度累积验证')
    // 10 次加仓，每次 100 股 @(10 + 0.001 × i)
    // 手算精确值：总成本 = Σ(100 × (10 + 0.001i)) for i=0..9
    //            = 100 × (10 × 10 + 0.001 × 45) = 100 × 100.045 = 10004.5
    //            总数量 = 1000
    //            精确 avgCost = 10004.5 / 1000 = 10.0045
    // 使用 FinancialCalc.weightedAvgCost 逐步计算参考值
    // 验证 JS Number 精度误差是否在可接受范围内
    // 业务容忍度：±0.01 元（1 分钱），对应股价精度为小数点后两位
    expect: avgCost 与精确值偏差 < 0.01（即 ±1 分钱以内）

  it('[EDGE] dto.quantity = 0 → 不应除零')
    // newQty = existing.quantity + 0 = existing.quantity
    // newAvgCost = (existing.quantity × existing.avgCost + 0 × anything) / existing.quantity
    //           = existing.avgCost（不变）
    mock: existing = { quantity: 100, avgCost: Decimal(10) }
    input: { quantity: 0, avgCost: 15 }
    expect: avgCost 仍为 10（或应拒绝 quantity=0 的请求）
```

#### 5.1.2 P&L 计算测试

```
describe('calcPnlToday() — 日盈亏计算')

  it('[BIZ] 单只持仓的日盈亏独立推导')
    // close = 11, pctChg = 10(%), quantity = 100
    // 当前代码公式：todayPnl = mv / (1 + pctChg/100) × (pctChg/100)
    //   = (11 × 100) / (1 + 0.1) × 0.1
    //   = 1100 / 1.1 × 0.1
    //   = 1000 × 0.1 = 100
    // 含义：昨日市值 = 1000，今日涨 10% = 100
    expect: todayPnl = 100 ✓（公式正确）

  it('[BUG P1-B9] 当日涨幅接近 100% 时 todayPnlPct 趋近 Infinity')
    // close = 200, pctChg = 99.9(%), quantity = 100
    // totalMv = 200 × 100 = 20,000
    // totalPnl = 20000 / (1 + 0.999) × 0.999 = 10005 × 0.999 ≈ 9995
    // totalPnlPct = 9995 / (20000 - 9995) = 9995 / 10005 ≈ 0.999
    // 如果 pctChg = 100%:
    //   totalPnl = 20000 / 2 × 1 = 10000
    //   totalPnlPct = 10000 / (20000 - 10000) = 10000 / 10000 = 1.0
    // 极端：pctChg = 200%（理论不可能但无保护）:
    //   totalPnl = 20000 / 3 × 2 ≈ 13333
    //   totalPnlPct = 13333 / (20000 - 13333) = 13333 / 6667 ≈ 2.0
    // 更极端：totalMv ≈ totalPnl → 分母趋近 0
    expect: 验证 pctChg = 99.9% 时的计算正确性
    // [BUG] 分母 (totalMv - totalPnl) 可能趋近零

  it('[EDGE] 所有持仓当日停牌（无 pctChg 数据）→ todayPnl 应全为 null')
    mock: daily 查询返回空（所有股票无当日行情）
    expect: holdings 中 todayPnl 全为 null
    expect: totalPnl = null（非 0）
    expect: todayPnlPct = null（非 0）

  it('[EDGE] 部分持仓有价格，部分无 → 有价格的正常计算')
    mock: 3 只持仓，其中 1 只无当日行情
    expect: 有价格的 2 只 todayPnl 为数值
    expect: 无价格的 1 只 todayPnl 为 null
    expect: totalPnl 仅含有价格持仓的盈亏之和
```

#### 5.1.3 权限检查测试

```
describe('assertOwner() — 越权防护')

  it('[SEC] 不存在的组合 ID → NotFoundException')
    mock: prisma.portfolio.findUnique → null
    expect: throw NotFoundException('组合不存在')

  it('[SEC] 存在但非本人组合 → ForbiddenException')
    mock: prisma.portfolio.findUnique → { userId: 999 }
    call: assertOwner(portfolioId, 1)  // userId=1 ≠ 999
    expect: throw ForbiddenException('无权访问该组合')

  it('[SEC] 404 和 403 的区分可能泄露组合存在性（已知权衡）')
    // 不存在 → NotFoundException(404)
    // 存在但越权 → ForbiddenException(403)
    // ⚠️ 攻击者可通过 404 vs 403 推断组合是否存在
    // 当前为已知设计权衡：若统一返回 403/404 会降低可调试性
    // 记录当前行为供安全评审参考
    expect: 不存在 → 404
    expect: 越权 → 403
```

#### 5.1.4 缓存一致性测试

```
describe('缓存失效 — 操作后一致性')

  it('[DATA] addHolding 后缓存被正确失效')
    call: addHolding(...)
    expect: cacheService.invalidateByPrefixes 被调用
    expect: 参数包含 PORTFOLIO_DETAIL, PORTFOLIO_PNL_TODAY, PORTFOLIO_RISK 等前缀

  it('[DATA] removeHolding 后缓存被正确失效')
    call: removeHolding(...)
    expect: 同上，缓存前缀被失效
```

### 5.2 risk-check.service.spec.ts — 现有 26 个用例，需新增 ~8 个

**文件**：`src/apps/portfolio/test/risk-check.service.spec.ts`

#### 5.2.1 单只持仓集中度测试

```
describe('checkSinglePosition() — 阈值边界')

  it('[BIZ] 权重恰好等于阈值 → 不触发违规')
    // threshold = 30%，top1Weight = 30%
    // if (topWeight > threshold) — 不含等号
    mock: riskService.getPositionConcentration → { positions: [{ weight: 30 }] }
    mock: rule.threshold = 30
    expect: 返回 null（无违规）

  it('[BIZ] 权重刚好超过阈值 0.01% → 触发违规')
    mock: positions: [{ weight: 30.01, stockName: '贵州茅台' }]
    mock: rule.threshold = 30
    expect: 返回违规记录，detail 含 '贵州茅台' 和 '30.01%'

  it('[BUG P1-B12] 空持仓时 positions[0] 为 undefined')
    mock: riskService.getPositionConcentration → { positions: [] }
    expect: 不报错，返回 null（无违规）
    // [BUG] 当前代码 positions[0] → undefined → topPos?.weight → undefined
    // undefined > threshold → false → 不触发
    // 结果正确但逻辑脆弱
```

#### 5.2.2 行业集中度测试

```
describe('checkIndustryWeight() — 阈值边界')

  it('[BIZ] 两个行业权重完全相同（并列最大）')
    mock: industries = [
      { industry: '银行', weight: 35 },
      { industry: '保险', weight: 35 },
      { industry: '医药', weight: 30 }
    ]
    mock: rule.threshold = 30
    // sort 后取 [0]，sort 不稳定 → 可能是银行也可能是保险
    expect: 触发违规（权重 35% > 30%）
    expect: 违规详情中包含某个行业名称

  it('[BUG P1-B13] 所有行业权重为 null → 规则永不触发')
    mock: industries = [{ industry: '银行', weight: null }]
    // maxWeight = null ?? 0 = 0
    // 0 > threshold → false
    expect: 返回 null
    // [BUG] 应该在数据不可用时抛异常或返回 'data_unavailable'
```

#### 5.2.3 最大回撤测试

```
describe('checkMaxDrawdown() — 计算验证')

  it('[BIZ] NAV 从 1.0 跌到 0.8 再回到 0.9 → maxDD = 20%')
    // NAV 序列：[1.0, 0.95, 0.8, 0.85, 0.9]
    // peak: [1.0, 1.0, 1.0, 1.0, 1.0]
    // DD: [0, -5%, -20%, -15%, -10%]
    // maxDD = 20%
    mock: SQL 返回 NAV 序列
    mock: rule.threshold = 15
    expect: 触发违规（20% > 15%）

  it('[BUG P1-B10] latestDate 为 2月29日闰年 → 前推一年日期偏移')
    // 2024-02-29（闰年）→ setFullYear(2023) → 2023-03-01（非闰年自动偏移）
    // 应该是 2023-02-28
    mock: latestDate = new Date('2024-02-29')
    expect（当前行为）: startDate = '20230301'
    // [BUG] 正确应为 '20230228' 或 '20230301'（取决于业务定义）

  it('[BUG P1-B11] costBasis = 0 → NAV 默认为 1（错误）')
    mock: SQL 返回 rows 中 cost_basis = 0
    // 当前代码：cb > 0 ? mv / cb : 1
    expect（当前行为）: NAV = 1
    // [BUG] 新建空组合不应有 NAV = 1，应为 null 或跳过

  it('[EDGE] 历史数据不足 2 天 → 不检查回撤')
    mock: SQL 返回 1 行
    expect: 返回 null（无违规，非报错）

  it('[EDGE] 新建组合（无持仓历史）→ 回撤检查应跳过')
    mock: SQL 返回 0 行
    expect: 返回 null
```

#### 5.2.4 WebSocket 通知测试

```
describe('runCheck() — 违规通知')

  it('[BIZ] 有违规时同时写入 DB 和推送 WebSocket')
    mock: 规则触发 1 条违规
    expect: prisma.riskViolationLog.create 被调用
    expect: eventsGateway.emitToUser 被调用
    expect: 推送内容含 { portfolioId, violations, checkedAt }

  it('[BUG P1-B14] WebSocket 推送失败不应影响违规记录写入')
    // 当前代码无 try-catch 包裹 emitToUser
    mock: eventsGateway.emitToUser → throw Error('connection lost')
    expect（当前行为）: 整个 runCheck 调用抛出异常
    // [BUG] 应 catch WS 异常，确保 DB 写入成功

  it('[BIZ] 无违规时不写 DB 也不推送')
    mock: 所有规则检查均返回 null
    expect: prisma.riskViolationLog.create 未被调用
    expect: eventsGateway.emitToUser 未被调用
```

---

## 六、Portfolio Performance 测试补充

### 6.1 portfolio-performance.service.spec.ts — 现有 10 个用例，需新增 ~5 个

**文件**：`src/apps/portfolio/test/portfolio-performance.service.spec.ts`

```
describe('calcPerformance() — 绩效指标验证')

  it('[BUG P1-B15] Sharpe Ratio 缺少无风险利率 vs BacktestMetrics 不一致')
    // portfolio-performance: Sharpe = annualizedReturn / volatility（无 rf）
    // backtest-metrics: Sharpe = (annualizedReturn - 0.02) / volatility（rf=2%）
    // 同一数据产生不同 Sharpe 值
    input: 10 日收益率序列
    expect: portfolioPerf.sharpeRatio ≠ backtestMetrics.sharpeRatio
    // [BUG] 两处 Sharpe 定义不一致

  it('[BUG P1-B16] lastKnownPrice 初始化为 avgCost → 首日 NAV 偏差')
    // 股票 A：avgCost = 50，首日收盘 = 55
    // 如果首日行情存在 → lastKnownPrice 更新为 55 ✓
    // 如果首日行情缺失 → 使用 avgCost = 50，偏差 10%
    mock: 首日无行情数据
    expect: 使用 avgCost 作为价格（非最新市价）
    // [BUG] 应用上一个已知收盘价，而非成本价

  it('[EDGE] benchmarkBase 为 null 或 0 → 不应除零')
    mock: benchmarkRows 为空或首日 close = null
    // 当前代码：benchmarkBase = benchmarkRows[0].close ?? 1
    expect: benchmarkBase = 1（安全默认值）
    expect: benchmarkNav = close / 1 = close

  it('[EDGE] 仅 1 日数据 → 指标全为 0 或 null')
    mock: 1 个交易日的数据
    expect: totalReturn = 0
    expect: annualizedReturn = 0
    expect: maxDrawdown = 0
    expect: sharpeRatio = 0

  it('[DATA] 样本方差（n-1）验证 — volatility 计算')
    // 当前代码使用 / (arr.length - 1)（样本方差）→ 正确
    // 与 backtest-metrics 使用 / n（总体方差）不一致
    input: 5 日收益率 [0.01, -0.005, 0.02, 0.005, -0.002]
    // 样本 variance = Σ(r - mean)² / 4
    expect: volatility 使用样本标准差
```

---

## 七、测试执行计划

### 7.1 文件清单

| 序号 | 文件路径 | 操作 | 用例变化 |
| ---- | -------- | ---- | -------- |
| 1 | `test/helpers/financial-calc.ts` | 新建 | — |
| 2 | `test/helpers/concurrency.ts` | 新建 | — |
| 3 | `test/helpers/redis-mock-enhanced.ts` | 新建 | — |
| 4 | `src/apps/auth/test/auth.service.spec.ts` | 追加 | +15 |
| 5 | `src/apps/auth/test/auth.controller.spec.ts` | 追加 | +4 |
| 6 | `src/apps/backtest/test/backtest-engine.service.spec.ts` | 追加 | +12 |
| 7 | `src/apps/backtest/test/backtest-metrics.service.spec.ts` | 追加 | +10 |
| 8 | `src/apps/portfolio/test/portfolio.service.spec.ts` | 追加 | +12 |
| 9 | `src/apps/portfolio/test/risk-check.service.spec.ts` | 追加 | +8 |
| 10 | `src/apps/portfolio/test/portfolio-performance.service.spec.ts` | 追加 | +5 |

**总计**：~66 个新增用例（超过总纲 Phase 1 目标的 50 个）

### 7.2 落地顺序

```
Step 1: 新建测试辅助工具（financial-calc.ts, concurrency.ts, redis-mock-enhanced.ts）
  ↓
Step 2: Auth.service 安全边界测试（15 用例）
  → 编译 + 运行 → 确认全绿 → 记录发现的 Bug
  ↓
Step 3: Auth.controller 集成测试（4 用例）
  → 使用 createTestApp + ValidationPipe
  ↓
Step 4: Backtest Engine 核心测试（12 用例）
  → NAV 手算验证 + 交易执行边界
  ↓
Step 5: Backtest Metrics 手算交叉验证（10 用例）
  → Sharpe / MaxDD / Alpha-Beta 精确验证
  ↓
Step 6: Portfolio.service 加仓成本 + P&L 测试（12 用例）
  → 精度验证 + 越权测试
  ↓
Step 7: RiskCheck.service 规则边界测试（8 用例）
  → 阈值边界 + 闰年 + WebSocket
  ↓
Step 8: Portfolio Performance 补充（5 用例）
  → Sharpe 不一致验证 + 基准基数边界
```

### 7.3 验收标准

| 标准 | 要求 |
| ---- | ---- |
| 测试全绿 | 所有新增用例 + 现有 793 个用例全部通过 |
| Bug 发现 | 至少标记 3 个 `[BUG]` 用例（实际已识别 17 个潜在 Bug） |
| 断言强度 | 新增用例中 95% 以上使用强断言（具体值 / toBeCloseTo / objectContaining） |
| 手算覆盖 | Sharpe / MaxDD / 加权平均成本 / P&L 均有独立手算交叉验证 |
| 安全覆盖 | Auth 模块至少 5 个 `[SEC]` 类别用例 |
| 边界覆盖 | 至少 10 个 `[EDGE]` 类别用例 |

---

## 附录 A：Phase 1 Bug 严重度分布

| 严重度 | 数量 | 涉及模块 | 典型影响 |
| :----: | :--: | -------- | -------- |
| **S1** | 2 | Auth（P1-B1）、Backtest（P1-B6） | 锁定机制可被绕过、资金计算变负 |
| **S2** | 8 | Auth（2）、Backtest（3）、Portfolio（3） | 计算偏差、指标不一致 |
| **S3** | 6 | Risk（5）、Portfolio（1） | 边界条件异常、语义歧义 |
| **需验证** | 1 | Backtest（P1-B17） | 行为确认，非 Bug |
| **总计** | **17** | | 含 1 个需验证项 |

## 附录 B：与 Phase 3 / Phase 4 的接口约定

- Phase 1 新建的 `test/helpers/financial-calc.ts` 将在 Phase 3（Stock Analysis IR/波动率验证）和 Phase 4（Controller 集成测试）中复用。
- Phase 1 新建的 `test/helpers/concurrency.ts` 将在 Phase 2（Factor 快照竞态）和 Phase 3（Event Signal 并发扫描）中复用。
- Phase 1 的 `[BUG]` 标记用例在修复后需翻转断言，由修复 PR 负责更新测试。
