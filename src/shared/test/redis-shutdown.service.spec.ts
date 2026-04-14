import { RedisShutdownService } from '../redis-shutdown.service'
import { LoggerService } from '../logger/logger.service'

function makeLogger() {
  return {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<LoggerService>
}

function makeRedis(overrides: { isOpen?: boolean; quit?: jest.Mock } = {}) {
  return {
    isOpen: overrides.isOpen ?? true,
    quit: overrides.quit ?? jest.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof import('redis')['createClient']>
}

describe('RedisShutdownService', () => {
  afterEach(() => jest.clearAllMocks())

  it('[BIZ] Redis 打开状态（isOpen=true）→ 调用 quit() 优雅关闭', async () => {
    const logger = makeLogger()
    const redis = makeRedis({ isOpen: true })
    const service = new RedisShutdownService(redis, logger)

    await service.onApplicationShutdown('SIGTERM')

    expect(redis.quit).toHaveBeenCalledTimes(1)
  })

  it('[EDGE] Redis 已关闭（isOpen=false）→ 不调用 quit()', async () => {
    const logger = makeLogger()
    const redis = makeRedis({ isOpen: false })
    const service = new RedisShutdownService(redis, logger)

    await service.onApplicationShutdown('SIGTERM')

    expect(redis.quit).not.toHaveBeenCalled()
  })

  it('[EDGE] redis 为 null → 不崩溃', async () => {
    const logger = makeLogger()
    const service = new RedisShutdownService(null as unknown as ReturnType<typeof import('redis')['createClient']>, logger)

    await expect(service.onApplicationShutdown('SIGTERM')).resolves.not.toThrow()
  })

  it('[ERR] quit() 抛出 Error → 记录错误日志但不崩溃', async () => {
    const logger = makeLogger()
    const redis = makeRedis({ isOpen: true, quit: jest.fn().mockRejectedValue(new Error('timeout')) })
    const service = new RedisShutdownService(redis, logger)

    await expect(service.onApplicationShutdown('SIGTERM')).resolves.not.toThrow()

    expect(logger.error).toHaveBeenCalledWith(
      'Error closing Redis connection',
      'timeout',
      'RedisShutdownService',
    )
  })

  it('[BUG P5-B14] quit() 抛出字符串异常 → err?.message 为 undefined，日志记录 undefined', async () => {
    // err = 'connection reset'（字符串，无 .message 属性）
    // err?.message = undefined
    // 当前行为：logger.error('Error closing Redis connection', undefined, 'RedisShutdownService')
    const logger = makeLogger()
    const redis = makeRedis({ isOpen: true, quit: jest.fn().mockRejectedValue('connection reset') })
    const service = new RedisShutdownService(redis, logger)

    await expect(service.onApplicationShutdown('SIGTERM')).resolves.not.toThrow()

    // 记录当前（有缺陷的）行为：第二个参数为 undefined 而非 'connection reset'
    expect(logger.error).toHaveBeenCalledWith(
      'Error closing Redis connection',
      undefined, // 'connection reset'?.message = undefined
      'RedisShutdownService',
    )
    // 修复后应改为：expect(logger.error).toHaveBeenCalledWith(..., 'connection reset', ...)
  })

  it('[BIZ] 日志包含信号名称', async () => {
    const logger = makeLogger()
    const redis = makeRedis({ isOpen: false })
    const service = new RedisShutdownService(redis, logger)

    await service.onApplicationShutdown('SIGINT')

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('SIGINT'),
      'RedisShutdownService',
    )
  })

  it('[BIZ] 信号为 undefined → 日志包含 "unknown"', async () => {
    const logger = makeLogger()
    const redis = makeRedis({ isOpen: false })
    const service = new RedisShutdownService(redis, logger)

    await service.onApplicationShutdown(undefined)

    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('unknown'),
      'RedisShutdownService',
    )
  })
})
