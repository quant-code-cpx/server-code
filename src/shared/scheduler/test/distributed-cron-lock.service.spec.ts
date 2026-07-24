import { DistributedCronLockService } from '../distributed-cron-lock.service'

function buildRedis() {
  const entries = new Map<string, string>()
  return {
    entries,
    set: jest.fn(async (key: string, value: string, options: { NX?: boolean }) => {
      if (options.NX && entries.has(key)) return null
      entries.set(key, value)
      return 'OK'
    }),
    eval: jest.fn(async (script: string, options: { keys: string[]; arguments: string[] }) => {
      const [key] = options.keys
      const [token] = options.arguments
      if (entries.get(key) !== token) return 0
      if (script.includes('PEXPIRE')) return 1
      entries.delete(key)
      return 1
    }),
  }
}

function buildService(redis = buildRedis()) {
  const logger = { warn: jest.fn(), error: jest.fn() }
  const service = new DistributedCronLockService(
    redis as never,
    { prefix: 'test:cron', ttlMs: 5_000 } as never,
    { schedulerEnabled: true } as never,
    logger as never,
  )
  return { service, redis, logger }
}

describe('DistributedCronLockService', () => {
  it('[BIZ] 同一任务并发竞争时仅一个 owner 可执行', async () => {
    const { service } = buildService()
    let executions = 0
    let releaseTask!: () => void
    const taskDone = new Promise<void>((resolve) => {
      releaseTask = resolve
    })

    const first = service.runWithLease('price-alert:daily', async () => {
      executions += 1
      await taskDone
    })
    await new Promise((resolve) => setImmediate(resolve))
    await expect(
      service.runWithLease('price-alert:daily', async () => {
        executions += 1
      }),
    ).resolves.toBe('skipped')

    releaseTask()
    await expect(first).resolves.toBe('executed')
    expect(executions).toBe(1)
  })

  it('[SEC] 非 owner 不能续租或释放他人 lease', async () => {
    const { service, redis } = buildService()
    const owner = await service.acquire('tushare:sync')
    expect(owner).not.toBeNull()
    const intruder = { ...owner!, token: 'different-owner-token' }

    await expect(service.renew(intruder)).resolves.toBe(false)
    await expect(service.release(intruder)).resolves.toBe(false)
    expect(redis.entries.get(owner!.key)).toBe(owner!.token)
    await expect(service.release(owner!)).resolves.toBe(true)
  })

  it('[BIZ] 任务抛错后释放 lease，后续调度可接管', async () => {
    const { service } = buildService()

    await expect(
      service.runWithLease('scheduled-research:scan', async () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom')
    await expect(service.runWithLease('scheduled-research:scan', async () => undefined)).resolves.toBe('executed')
  })

  it('[SEC] 非 scheduler 角色不触碰 Redis lease 或业务任务', async () => {
    const redis = buildRedis()
    const logger = { warn: jest.fn(), error: jest.fn() }
    const service = new DistributedCronLockService(
      redis as never,
      { prefix: 'test:cron', ttlMs: 5_000 } as never,
      { schedulerEnabled: false } as never,
      logger as never,
    )
    const task = jest.fn(async () => undefined)

    await expect(service.runIfScheduler('price-alert:daily', task)).resolves.toBe('skipped')
    expect(task).not.toHaveBeenCalled()
    expect(redis.set).not.toHaveBeenCalled()
  })
})
