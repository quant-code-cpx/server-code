import { buildPrismaDatasourceUrl, readPositiveIntegerEnv } from '../prisma.service'
import { LoggerService } from '../logger/logger.service'

// ── buildPrismaDatasourceUrl ──────────────────────────────────────────────────

describe('buildPrismaDatasourceUrl()', () => {
  it('[BIZ] 标准 URL → 追加默认 connection_limit/pool_timeout/connect_timeout 参数', () => {
    const result = buildPrismaDatasourceUrl('postgresql://user:pass@localhost:5432/mydb')

    expect(result).toBeDefined()
    const url = new URL(result!)
    // 默认值：connection_limit=15, pool_timeout=20, connect_timeout=10
    expect(url.searchParams.get('connection_limit')).toBe('15')
    expect(url.searchParams.get('pool_timeout')).toBe('20')
    expect(url.searchParams.get('connect_timeout')).toBe('10')
  })

  it('[EDGE] URL 已包含 connection_limit → 不覆盖，保留原值', () => {
    const result = buildPrismaDatasourceUrl('postgresql://user:pass@localhost:5432/mydb?connection_limit=5')

    expect(result).toBeDefined()
    const url = new URL(result!)
    // 原有值 5 不被覆盖
    expect(url.searchParams.get('connection_limit')).toBe('5')
    // 其他参数正常追加
    expect(url.searchParams.get('pool_timeout')).toBe('20')
    expect(url.searchParams.get('connect_timeout')).toBe('10')
  })

  it('[EDGE] databaseUrl 为 undefined → 返回 undefined', () => {
    expect(buildPrismaDatasourceUrl(undefined)).toBeUndefined()
  })

  it('[EDGE] databaseUrl 为空字符串 → 返回 undefined', () => {
    // empty string is falsy → early return undefined
    expect(buildPrismaDatasourceUrl('')).toBeUndefined()
  })

  it('[BUG P5-B10] databaseUrl 不是有效 URL（缺少协议头）→ 抛出 TypeError（当前行为）', () => {
    // new URL('not-a-url') → throws TypeError: Invalid URL
    // 当前行为：异常冒泡到 PrismaService 构造函数 → 应用启动失败，错误信息不友好
    // 建议修复：增加 try-catch 包装，抛出友好的 ConfigurationError
    expect(() => buildPrismaDatasourceUrl('not-a-valid-url')).toThrow(/Invalid URL/)
  })

  it('[BIZ] 多个参数已存在时全部保留，不重复追加', () => {
    const input = 'postgresql://user:pass@host:5432/db?connection_limit=3&pool_timeout=5&connect_timeout=8'
    const result = buildPrismaDatasourceUrl(input)

    const url = new URL(result!)
    expect(url.searchParams.get('connection_limit')).toBe('3')
    expect(url.searchParams.get('pool_timeout')).toBe('5')
    expect(url.searchParams.get('connect_timeout')).toBe('8')
  })
})

// ── readPositiveIntegerEnv ────────────────────────────────────────────────────

describe('readPositiveIntegerEnv()', () => {
  const ENV_KEY = 'TEST_READ_POSITIVE_INT_' + Math.random().toString(36).slice(2)

  afterEach(() => {
    delete process.env[ENV_KEY]
  })

  it('[BIZ] 有效正整数 → 返回解析值', () => {
    process.env[ENV_KEY] = '20'
    expect(readPositiveIntegerEnv(ENV_KEY, 10)).toBe(20)
  })

  it('[EDGE] 环境变量不存在（undefined）→ 返回 fallback', () => {
    delete process.env[ENV_KEY]
    expect(readPositiveIntegerEnv(ENV_KEY, 10)).toBe(10)
  })

  it('[EDGE] 环境变量为空字符串 → 返回 fallback', () => {
    process.env[ENV_KEY] = ''
    // empty string is falsy → fallback
    expect(readPositiveIntegerEnv(ENV_KEY, 10)).toBe(10)
  })

  it('[EDGE] 负数（-5）→ -5 > 0 = false → 返回 fallback', () => {
    process.env[ENV_KEY] = '-5'
    expect(readPositiveIntegerEnv(ENV_KEY, 10)).toBe(10)
  })

  it('[EDGE] 零（0）→ 0 > 0 = false → 返回 fallback', () => {
    process.env[ENV_KEY] = '0'
    expect(readPositiveIntegerEnv(ENV_KEY, 10)).toBe(10)
  })

  it('[EDGE] 浮点数字符串 "1.5" → parseInt 截断为 1 → Number.isInteger(1) && 1 > 0 → 返回 1', () => {
    // parseInt('1.5', 10) = 1; Number.isInteger(1) = true; 1 > 0 = true → 返回 1
    // 注：P5-B11 指出此行为可接受但不符合"正整数"严格语义
    process.env[ENV_KEY] = '1.5'
    expect(readPositiveIntegerEnv(ENV_KEY, 10)).toBe(1)
  })

  it('[EDGE] 非数字字符串 "abc" → parseInt 返回 NaN → Number.isInteger(NaN)=false → 返回 fallback', () => {
    process.env[ENV_KEY] = 'abc'
    expect(readPositiveIntegerEnv(ENV_KEY, 10)).toBe(10)
  })

  it('[EDGE] 数字字符串前缀的混合值 "15abc" → parseInt("15abc")=15 → 返回 15', () => {
    // parseInt 从头解析到第一个非数字字符
    process.env[ENV_KEY] = '15abc'
    expect(readPositiveIntegerEnv(ENV_KEY, 10)).toBe(15)
  })
})

// ── recordQueryMetrics (via service instance) ─────────────────────────────────

describe('PrismaService.recordQueryMetrics()', () => {
  let mockLogger: jest.Mocked<LoggerService>
  let mockHistogram: { observe: jest.Mock }
  let mockCounter: { inc: jest.Mock }
  // Dynamic import to get a fresh PrismaService instance
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaService } = require('../prisma.service') as typeof import('../prisma.service')

  beforeEach(() => {
    mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() } as unknown as jest.Mocked<LoggerService>
    mockHistogram = { observe: jest.fn() }
    mockCounter = { inc: jest.fn() }
  })

  it('[BIZ] 慢查询（duration > 500ms）→ 记录 histogram + counter + warn 日志', () => {
    const service = new PrismaService(mockLogger, mockHistogram as never, mockCounter as never)

    // 直接调用私有方法（测试场景）
    ;(service as unknown as { recordQueryMetrics(d: number): void }).recordQueryMetrics(600)

    expect(mockHistogram.observe).toHaveBeenCalledWith(0.6)
    expect(mockCounter.inc).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('600.0ms'),
        durationMs: 600,
      }),
      'PrismaSlowQuery',
    )
  })

  it('[BIZ] 正常查询（duration <= 500ms）→ 记录 histogram + counter，不记录 warn', () => {
    const service = new PrismaService(mockLogger, mockHistogram as never, mockCounter as never)

    ;(service as unknown as { recordQueryMetrics(d: number): void }).recordQueryMetrics(100)

    expect(mockHistogram.observe).toHaveBeenCalledWith(0.1)
    expect(mockCounter.inc).toHaveBeenCalledTimes(1)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  it('[EDGE] duration 恰好 500ms（临界值）→ 不记录 warn（> 而非 >=）', () => {
    const service = new PrismaService(mockLogger, mockHistogram as never, mockCounter as never)

    ;(service as unknown as { recordQueryMetrics(d: number): void }).recordQueryMetrics(500)

    expect(mockLogger.warn).not.toHaveBeenCalled()
    expect(mockHistogram.observe).toHaveBeenCalledWith(0.5)
  })

  it('[BIZ] 无 histogram/counter（仅 logger）→ 慢查询仍记录 warn 日志', () => {
    const service = new PrismaService(mockLogger, undefined, undefined)

    ;(service as unknown as { recordQueryMetrics(d: number): void }).recordQueryMetrics(700)

    // histogram/counter 为 undefined，observe/inc 不应调用
    expect(mockHistogram.observe).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('700.0ms') }),
      'PrismaSlowQuery',
    )
  })
})
