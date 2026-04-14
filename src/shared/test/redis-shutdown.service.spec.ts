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

  it('quit() 抛出字符串异常 → 日志记录原始字符串（已修复 P5-B14）', async () => {
    // 修复后：err instanceof Error ? err.message : String(err)
    // 'connection reset' 不是 Error 实例 → String('connection reset') = 'connection reset'
    // logger.error 收到完整错误信息而非 undefined
    const logger = makeLogger()
    const redis = makeRedis({ isOpen: true, quit: jest.fn().mockRejectedValue('connection reset') })
    const service = new RedisShutdownService(redis, logger)

    await expect(service.onApplicationShutdown('SIGTERM')).resolves.not.toThrow()

    // 修复后行为：第二个参数为 'connection reset' 而非 undefined
    expect(logger.error).toHaveBeenCalledWith(
      'Error closing Redis connection',
      'connection reset',
      'RedisShutdownService',
    )
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
