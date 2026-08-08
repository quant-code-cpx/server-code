import { NewsCoverageService } from '../news-coverage.service'
import type { NewsFeedCapability } from '../domain/news.types'

type FeedKey = { providerKey: string; feedKey: string }
type FeedHealthWrite = Record<string, unknown>
type FeedHealthFindArgs = { where: { providerKey_feedKey: FeedKey } }
type FeedHealthUpsertArgs = FeedHealthFindArgs & {
  create: FeedHealthWrite
  update: FeedHealthWrite
}

describe('NEWS-BIZ-011: coverage/FeedHealth 确定性派生', () => {
  const required: NewsFeedCapability = {
    providerKey: 'FAKE',
    providerDisplayName: 'Fake',
    feedKey: 'fake.required',
    feedDisplayName: 'Required',
    sourceType: 'MEDIA',
    contentTypes: ['NEWS'],
    scheduleMode: 'SCHEDULED',
    expectedIntervalSeconds: 60,
    requiredForCompleteness: true,
    enabled: true,
  }
  const optionalDisabled: NewsFeedCapability = {
    providerKey: 'OPTIONAL',
    providerDisplayName: 'Optional',
    feedKey: 'optional.feed',
    feedDisplayName: 'Optional',
    sourceType: 'AGGREGATOR',
    contentTypes: ['NEWS'],
    scheduleMode: 'SCHEDULED',
    expectedIntervalSeconds: 60,
    requiredForCompleteness: false,
    enabled: false,
  }
  let now = new Date('2026-08-06T04:00:00.000Z')
  const health = new Map<string, Record<string, unknown>>()
  const prisma = {
    newsFeedHealth: {
      findUnique: jest.fn(async ({ where }: FeedHealthFindArgs) => health.get(key(where.providerKey_feedKey)) ?? null),
      upsert: jest.fn(async ({ where, create, update }: FeedHealthUpsertArgs) => {
        const healthKey = key(where.providerKey_feedKey)
        const current = health.get(healthKey)
        const value = current ? { ...current, ...update } : { ...create }
        health.set(healthKey, value)
        return value
      }),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
  }
  const registry = { relevantCapabilities: jest.fn(() => [required, optionalDisabled]) }
  const config = { enabled: true, freshnessGraceMultiplier: 3 }
  const clock = { now: () => new Date(now) }
  const service = new NewsCoverageService(prisma as never, registry as never, config as never, clock)

  beforeEach(() => {
    health.clear()
    jest.clearAllMocks()
    registry.relevantCapabilities.mockReturnValue([required, optionalDisabled])
    now = new Date('2026-08-06T04:00:00.000Z')
  })

  it('Q-004/Q-012: 没有相关 required feed 时 COVERAGE_UNKNOWN 活动时间稳定', async () => {
    registry.relevantCapabilities.mockReturnValue([])
    const first = await service.getCoverage({ sourceTypes: ['REGULATOR'] })
    now = new Date('2026-08-06T04:05:00.000Z')
    const second = await service.getCoverage({ sourceTypes: ['REGULATOR'] })

    expect(first.partial).toBe(true)
    expect(first.dataThrough).toBeNull()
    expect(first.warnings).toEqual([expect.objectContaining({ code: 'COVERAGE_UNKNOWN' })])
    expect(second.warnings[0].observedAt).toBe(first.warnings[0].observedAt)
  })

  it('无成功同步产生 completeness warning；活动期 warningId/observedAt 稳定', async () => {
    const first = await service.getCoverage()
    now = new Date('2026-08-06T04:05:00.000Z')
    const second = await service.getCoverage()
    const firstWarning = first.warnings.find((warning) => warning.feedKey === required.feedKey)!
    const secondWarning = second.warnings.find((warning) => warning.feedKey === required.feedKey)!
    expect(first.partial).toBe(true)
    expect(first.dataThrough).toBeNull()
    expect(firstWarning.code).toBe('NO_SUCCESSFUL_SYNC')
    expect(secondWarning.warningId).toBe(firstWarning.warningId)
    expect(secondWarning.observedAt).toBe(firstWarning.observedAt)
  })

  it('NEWS-DATA-COVERAGE-READONLY: coverage/list 共用投影连续读取不写库，同一证据告警标识稳定', async () => {
    const first = await service.getCoverage()
    now = new Date('2026-08-06T04:05:00.000Z')
    const second = await service.getCoverage()
    const firstWarning = first.warnings.find((warning) => warning.feedKey === required.feedKey)!
    const secondWarning = second.warnings.find((warning) => warning.feedKey === required.feedKey)!

    expect(secondWarning.warningId).toBe(firstWarning.warningId)
    expect(secondWarning.observedAt).toBe(firstWarning.observedAt)
    expect(prisma.newsFeedHealth.upsert).not.toHaveBeenCalled()
    expect(prisma.newsFeedHealth.update).not.toHaveBeenCalled()
    expect(prisma.newsFeedHealth.updateMany).not.toHaveBeenCalled()
    expect(prisma.newsFeedHealth.create).not.toHaveBeenCalled()
    expect(prisma.newsFeedHealth.createMany).not.toHaveBeenCalled()
    expect(prisma.newsFeedHealth.delete).not.toHaveBeenCalled()
    expect(prisma.newsFeedHealth.deleteMany).not.toHaveBeenCalled()
  })

  it('required READY + optional DISABLED 不制造 partial，后续过期才降级', async () => {
    health.set('FAKE/fake.required', {
      providerKey: 'FAKE',
      feedKey: 'fake.required',
      lastSuccessfulAt: new Date('2026-08-06T03:59:30.000Z'),
      dataThrough: new Date('2026-08-06T03:59:30.000Z'),
      consecutiveFailures: 0,
      lastRunStatus: 'SUCCEEDED',
      potentiallyTruncated: false,
      circuitState: 'CLOSED',
      warningSince: {},
    })
    const ready = await service.getCoverage()
    expect(ready.partial).toBe(false)
    expect(ready.overallStatus).toBe('READY')
    expect(ready.warnings.find((warning) => warning.feedKey === optionalDisabled.feedKey)).toEqual(
      expect.objectContaining({ code: 'FEED_DISABLED', affectsCompleteness: false, severity: 'INFO' }),
    )

    now = new Date('2026-08-06T04:04:00.001Z')
    const stale = await service.getCoverage()
    expect(stale.partial).toBe(true)
    expect(stale.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FEED_STALE' })]))
  })

  it('NEWS-DATA-COVERAGE-MULTI: 同一 required feed 的 stale、截断与部分入库告警必须同时保留', async () => {
    registry.relevantCapabilities.mockReturnValue([required])
    health.set('FAKE/fake.required', {
      providerKey: 'FAKE',
      feedKey: 'fake.required',
      lastSuccessfulAt: new Date('2026-08-06T03:55:00.000Z'),
      dataThrough: new Date('2026-08-06T03:55:00.000Z'),
      consecutiveFailures: 0,
      lastRunStatus: 'PARTIAL',
      potentiallyTruncated: true,
      circuitState: 'CLOSED',
      warningSince: {
        FEED_STALE: '2026-08-06T03:58:00.000Z',
        POTENTIALLY_TRUNCATED: '2026-08-06T03:56:00.000Z',
        PARTIAL_INGESTION: '2026-08-06T03:56:00.000Z',
      },
    })

    const coverage = await service.getCoverage()

    expect({
      warningCodes: coverage.warnings
        .filter((warning) => warning.feedKey === required.feedKey)
        .map((warning) => warning.code)
        .sort(),
      partial: coverage.partial,
      feedStatus: coverage.feeds[0]?.status,
      feedReasonCode: coverage.feeds[0]?.reasonCode,
    }).toEqual({
      warningCodes: ['FEED_STALE', 'PARTIAL_INGESTION', 'POTENTIALLY_TRUNCATED'].sort(),
      partial: true,
      feedStatus: 'DEGRADED',
      feedReasonCode: 'FEED_STALE',
    })
  })

  it('连续失败达到 3 次降级，2 次仍按最近成功状态判断', async () => {
    health.set('FAKE/fake.required', {
      providerKey: 'FAKE',
      feedKey: 'fake.required',
      lastSuccessfulAt: new Date('2026-08-06T03:59:30.000Z'),
      dataThrough: new Date('2026-08-06T03:59:30.000Z'),
      consecutiveFailures: 2,
      lastRunStatus: 'FAILED',
      potentiallyTruncated: false,
      circuitState: 'CLOSED',
      warningSince: {},
    })
    expect((await service.getCoverage()).feeds[0].status).toBe('READY')
    health.set('FAKE/fake.required', { ...health.get('FAKE/fake.required')!, consecutiveFailures: 3 })
    expect((await service.getCoverage()).warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'FEED_UNAVAILABLE' })]),
    )
  })
})

function key(value: { providerKey: string; feedKey: string }): string {
  return `${value.providerKey}/${value.feedKey}`
}
