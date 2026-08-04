import { AlertLimitService } from '../alert-limit.service'
import { PrismaService } from 'src/shared/prisma.service'

function buildPrismaMock() {
  return {
    limitListD: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    daily: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
  }
}

function createService(prisma = buildPrismaMock()): AlertLimitService {
  return new AlertLimitService(prisma as unknown as PrismaService)
}

function limitRow(index: number) {
  return {
    tradeDate: new Date(Date.UTC(2026, 4, 22)),
    tsCode: `${String(index).padStart(6, '0')}.SZ`,
    industry: '测试行业',
    name: `测试股票${index}`,
    close: 10,
    pctChg: 10,
    amount: 1000,
    limitAmount: null,
    floatMv: 1,
    totalMv: 2,
    turnoverRatio: 3,
    fdAmount: 100,
    firstTime: '092500',
    lastTime: '150000',
    openTimes: 0,
    strth: null,
    limit: 'U',
    upStat: '1/1',
    limitTimes: 1,
    connected: true,
    syncedAt: new Date(),
  }
}

describe('AlertLimitService', () => {
  afterEach(() => jest.clearAllMocks())

  it('returns fixed board heights and distinguishes a broken board from a limit-down stock', async () => {
    const prisma = buildPrismaMock()
    const service = createService(prisma)
    const tradeDate = new Date(Date.UTC(2026, 6, 31))

    prisma.limitListD.findFirst.mockResolvedValue({ tradeDate })
    prisma.limitListD.findMany.mockResolvedValue([
      {
        ...limitRow(1),
        tradeDate,
        tsCode: '600588.SH',
        name: '用友网络',
        pctChg: 9.99,
      },
      {
        ...limitRow(2),
        tradeDate,
        tsCode: '300378.SZ',
        name: '鼎捷数智',
        pctChg: 16.84,
        limit: 'Z',
        limitTimes: null,
        upStat: null,
        openTimes: 6,
      },
      {
        ...limitRow(3),
        tradeDate,
        tsCode: '920130.BJ',
        name: '立方控股',
        pctChg: 29.98,
      },
    ])
    prisma.$queryRaw.mockResolvedValue([])

    const result = await service.list({ tradeDate: '20260731' })

    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tsCode: '600588.SH',
          limitType: 'UP',
          pctChg: 9.99,
          pctChgLimit: 10,
          sealPattern: 'ONE_LINE',
          streakStatus: 'FIRST_LIMIT',
        }),
        expect.objectContaining({
          tsCode: '300378.SZ',
          limitType: 'BROKEN',
          pctChg: 16.84,
          pctChgLimit: 20,
          streakDays: 0,
          sealPattern: 'REOPENED',
          streakStatus: 'FLUSH',
        }),
        expect.objectContaining({
          tsCode: '920130.BJ',
          limitType: 'UP',
          pctChg: 29.98,
          pctChgLimit: 30,
        }),
      ]),
    )
  })

  it('maps a broken-board filter to the source Z flag', async () => {
    const prisma = buildPrismaMock()
    const service = createService(prisma)
    const tradeDate = new Date(Date.UTC(2026, 6, 31))

    prisma.limitListD.findFirst.mockResolvedValue({ tradeDate })
    prisma.limitListD.findMany.mockResolvedValue([])
    prisma.$queryRaw.mockResolvedValue([])

    await service.list({ tradeDate: '20260731', limitType: 'BROKEN' })

    expect(prisma.limitListD.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ limit: 'Z' }),
    })
  })

  it('nextDayPerf 使用全量涨跌停池，不受列表 pageSize=200 限制', async () => {
    const prisma = buildPrismaMock()
    const service = createService(prisma)
    const baseRows = Array.from({ length: 201 }, (_, i) => limitRow(i + 1))

    prisma.limitListD.findFirst.mockResolvedValue({ tradeDate: new Date(Date.UTC(2026, 4, 22)) })
    prisma.limitListD.findMany.mockResolvedValue(baseRows)
    prisma.$queryRaw.mockResolvedValue([])
    prisma.daily.findFirst.mockResolvedValue({ tradeDate: new Date(Date.UTC(2026, 4, 25)) })
    prisma.daily.findMany.mockResolvedValue([
      { tsCode: '000001.SZ', close: 11, pctChg: 5 },
      { tsCode: '000002.SZ', close: 9.9, pctChg: -1 },
    ])

    const result = await service.nextDayPerf({ tradeDate: '20260522', limitType: 'UP' })

    expect(result.total).toBe(201)
    expect(result.items).toHaveLength(201)
    expect(result.nextTradeDate).toBe('20260525')
    expect(result.avgPctChg).toBe(2)
    expect(result.upRatio).toBe(0.5)
    expect(result.items[0]).toMatchObject({ tsCode: '000001.SZ', nextClose: 11, nextPctChg: 5 })
    expect(result.items[1]).toMatchObject({ tsCode: '000002.SZ', nextClose: 9.9, nextPctChg: -1 })
    expect(result.items[2]).toMatchObject({ tsCode: '000003.SZ', nextClose: null, nextPctChg: null })

    const dailyQuery = prisma.daily.findMany.mock.calls[0][0]
    expect(dailyQuery.where.tsCode.in).toHaveLength(201)
    expect(dailyQuery.where.tradeDate).toEqual(new Date(Date.UTC(2026, 4, 25)))
  })
})
