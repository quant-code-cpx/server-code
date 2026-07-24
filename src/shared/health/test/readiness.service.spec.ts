import { ReadinessService } from '../readiness.service'
import { LoggerService } from '../../logger/logger.service'

function createService(graceMs = 0) {
  const logger = { log: jest.fn() } as unknown as jest.Mocked<LoggerService>
  return { service: new ReadinessService({ graceMs }, logger), logger }
}

describe('ReadinessService', () => {
  it('[BIZ] 初始接受流量；开始摘流后就绪状态关闭', () => {
    const { service } = createService()

    expect(service.isAcceptingTraffic()).toBe(true)
    service.beginDraining('SIGTERM')
    expect(service.isAcceptingTraffic()).toBe(false)
  })

  it('[EDGE] 重复关闭信号保持幂等，只记录一次摘流事件', () => {
    const { service, logger } = createService()

    service.beginDraining('SIGTERM')
    service.beginDraining('SIGINT')

    expect(logger.log).toHaveBeenCalledTimes(1)
    expect(logger.log).toHaveBeenCalledWith(
      { operation: 'shutdown.drainStarted', signal: 'SIGTERM', graceMs: 0 },
      ReadinessService.name,
    )
  })

  it('[BIZ] 未开始摘流时不等待关闭宽限期', async () => {
    const { service, logger } = createService(10_000)

    await expect(service.waitForDrainGracePeriod()).resolves.toBeUndefined()
    expect(logger.log).not.toHaveBeenCalled()
  })

  it('[BIZ] 零宽限期摘流完成后记录完成事件', async () => {
    const { service, logger } = createService()
    service.beginDraining('SIGTERM')

    await service.waitForDrainGracePeriod()

    expect(logger.log).toHaveBeenLastCalledWith({ operation: 'shutdown.drainCompleted' }, ReadinessService.name)
  })
})
