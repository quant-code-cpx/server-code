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
