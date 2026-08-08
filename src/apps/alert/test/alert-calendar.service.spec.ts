import { NotFoundException } from '@nestjs/common'
import { EventStudyService } from 'src/apps/event-study/event-study.service'
import { PrismaService } from 'src/shared/prisma.service'
import { AlertCalendarService } from '../alert-calendar.service'
import { CalendarEventType, CalendarScope, MarketCapBucket } from '../dto/calendar-query.dto'

const RANGE_DATE = new Date('2026-08-08T00:00:00.000Z')

function buildPrismaMock() {
  return {
    disclosureDate: {
      findMany: jest.fn(async () => [
        { tsCode: '000001.SZ', endDate: RANGE_DATE, actualDate: RANGE_DATE, preDate: RANGE_DATE },
      ]),
    },
    shareFloat: {
      findMany: jest.fn(async () => [{ tsCode: '000002.SZ', floatDate: '20260808', floatRatio: 5, floatShare: 1000 }]),
    },
    dividend: {
      findMany: jest.fn(async () => [
        { tsCode: '000003.SZ', exDate: RANGE_DATE, cashDiv: 0.1, stkDiv: 0, stkBoRate: 0 },
      ]),
    },
    forecast: {
      findMany: jest.fn(async () => [
        { tsCode: '000004.SZ', annDate: RANGE_DATE, type: '预增', pChangeMin: 20, pChangeMax: 30 },
      ]),
    },
    stockBasic: {
      findMany: jest.fn(async (args: { where?: { listDate?: unknown } }) =>
        args.where?.listDate
          ? [
              {
                tsCode: '000005.SZ',
                name: '新股样本',
                listDate: RANGE_DATE,
                market: '主板',
                exchange: 'SZSE',
              },
            ]
          : ['000001.SZ', '000002.SZ', '000003.SZ', '000004.SZ', '000007.SZ'].map((tsCode) => ({
              tsCode,
              name: `股票${tsCode}`,
            })),
      ),
    },
    cbBasic: {
      findMany: jest.fn(async () => [
        {
          tsCode: '123001.SZ',
          stkCode: '000006.SZ',
          stkShortName: '转债正股',
          bondShortName: '测试转债',
          listDate: RANGE_DATE,
          issueSize: 10,
          issueRating: 'AA',
        },
      ]),
    },
    stkHolderTrade: {
      findMany: jest.fn(async () => [
        {
          tsCode: '000007.SZ',
          annDate: RANGE_DATE,
          holderName: '测试股东',
          holderType: 'G',
          inDe: 'IN',
          changeVol: 100,
          changeRatio: 2,
          avgPrice: 10,
        },
      ]),
    },
    watchlist: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    portfolio: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    dailyBasic: { findMany: jest.fn(async () => []) },
  }
}

function createService(prisma = buildPrismaMock()) {
  const eventStudy = { analyze: jest.fn(async () => ({ topSamples: [] })) }
  return new AlertCalendarService(prisma as unknown as PrismaService, eventStudy as unknown as EventStudyService)
}

describe('AlertCalendarService v3', () => {
  it('CAL-B01: all seven event types return real source fixtures', async () => {
    const result = await createService().getCalendar({ startDate: '20260808', endDate: '20260808' })

    expect(new Set(result.events.map((event) => event.type))).toEqual(new Set(Object.values(CalendarEventType)))
  })

  it('CAL-B02: owned watchlist scope narrows the result set', async () => {
    const prisma = buildPrismaMock()
    prisma.watchlist.findFirst.mockResolvedValue({ stocks: [{ tsCode: '000005.SZ' }] })

    const result = await createService(prisma).getCalendar(
      {
        startDate: '20260808',
        endDate: '20260808',
        scope: CalendarScope.WATCHLIST,
        watchlistId: 7,
      },
      1,
    )

    expect(result.events.map((event) => event.tsCode)).toEqual(['000005.SZ'])
    expect(prisma.watchlist.findFirst).toHaveBeenCalledWith({
      where: { id: 7, userId: 1 },
      select: { stocks: { select: { tsCode: true } } },
    })
  })

  it('CAL-B02: foreign group identifiers fail closed', async () => {
    await expect(
      createService().getCalendar(
        {
          startDate: '20260808',
          endDate: '20260808',
          scope: CalendarScope.PORTFOLIO,
          portfolioId: 'foreign-portfolio',
        },
        1,
      ),
    ).rejects.toThrow(NotFoundException)
  })

  it('CAL-B03: backend buckets preserve exact 100/500-yi boundaries for the UI mapper', async () => {
    const prisma = buildPrismaMock()
    prisma.stockBasic.findMany.mockResolvedValue([
      { tsCode: 'A', name: '99.99亿', listDate: RANGE_DATE, market: '主板', exchange: 'SSE' },
      { tsCode: 'B', name: '100亿', listDate: RANGE_DATE, market: '主板', exchange: 'SSE' },
      { tsCode: 'C', name: '499.99亿', listDate: RANGE_DATE, market: '主板', exchange: 'SSE' },
      { tsCode: 'D', name: '500亿', listDate: RANGE_DATE, market: '主板', exchange: 'SSE' },
    ])
    prisma.dailyBasic.findMany.mockResolvedValue([
      { tsCode: 'A', totalMv: 999_900 },
      { tsCode: 'B', totalMv: 1_000_000 },
      { tsCode: 'C', totalMv: 4_999_900 },
      { tsCode: 'D', totalMv: 5_000_000 },
    ])
    const service = createService(prisma)

    const small = await service.getCalendar({
      startDate: '20260808',
      endDate: '20260808',
      types: [CalendarEventType.IPO],
      marketCapBuckets: [MarketCapBucket.SMALL, MarketCapBucket.MID],
    })
    const mid = await service.getCalendar({
      startDate: '20260808',
      endDate: '20260808',
      types: [CalendarEventType.IPO],
      marketCapBuckets: [MarketCapBucket.LARGE],
    })
    const large = await service.getCalendar({
      startDate: '20260808',
      endDate: '20260808',
      types: [CalendarEventType.IPO],
      marketCapBuckets: [MarketCapBucket.MEGA],
    })

    expect(small.events.map((event) => event.tsCode)).toEqual(['A'])
    expect(mid.events.map((event) => event.tsCode)).toEqual(['B', 'C'])
    expect(large.events.map((event) => event.tsCode)).toEqual(['D'])
  })

  it('CAL-B08: keyword searches event titles as promised by the client', async () => {
    const result = await createService().getCalendar({
      startDate: '20260808',
      endDate: '20260808',
      types: [CalendarEventType.IPO],
      keyword: '新股上市',
    })

    expect(result.events).toHaveLength(1)
    expect(result.events[0].type).toBe(CalendarEventType.IPO)
  })

  it('CAL-B07: disclosure emits the in-range preDate when actualDate is outside the request', async () => {
    const prisma = buildPrismaMock()
    prisma.disclosureDate.findMany.mockResolvedValue([
      {
        tsCode: '000001.SZ',
        endDate: RANGE_DATE,
        actualDate: new Date('2026-08-07T00:00:00.000Z'),
        preDate: RANGE_DATE,
      },
    ])

    const result = await createService(prisma).getCalendar({
      startDate: '20260808',
      endDate: '20260808',
      types: [CalendarEventType.DISCLOSURE],
    })

    expect(result.events[0]).toMatchObject({
      date: '20260808',
      title: '财报披露（预计）',
    })
    expect(prisma.disclosureDate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ actualDate: { gte: RANGE_DATE, lte: RANGE_DATE } }, { preDate: { gte: RANGE_DATE, lte: RANGE_DATE } }],
        }),
      }),
    )
  })
})
