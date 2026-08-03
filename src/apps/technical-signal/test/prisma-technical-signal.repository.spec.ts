import { ConflictException } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import {
  LoadTechnicalSignalTimelineInput,
  PrismaTechnicalSignalRepository,
} from '../repositories/prisma-technical-signal.repository'

type PrismaMethod = jest.Mock<Promise<unknown>, [unknown]>

interface PrismaMock {
  stockBasic: { findUnique: PrismaMethod }
  daily: { findFirst: PrismaMethod; findMany: PrismaMethod }
  adjFactor: { findFirst: PrismaMethod; findMany: PrismaMethod }
  tradeCal: { findFirst: PrismaMethod; findMany: PrismaMethod }
  suspendD: { findFirst: PrismaMethod; findMany: PrismaMethod }
}

const versionAt = new Date('2024-01-05T00:00:00.000Z')

function utcDate(value: string): Date {
  return new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`)
}

function createPrismaMock(options?: {
  exchange?: 'SSE' | 'SZSE' | 'BSE'
  calendarDates?: string[]
  dailyRows?: Array<{ tradeDate: Date; open: number; high: number; low: number; close: number; vol: number }>
  adjFactorRows?: Array<{ tradeDate: Date; adjFactor: number }>
  suspendedDates?: string[]
  dailyWatermark?: string
  adjFactorWatermark?: string
}): PrismaMock {
  const calendarDates = options?.calendarDates ?? ['20240102', '20240103', '20240104']
  const dailyRows =
    options?.dailyRows ??
    ['20240102', '20240103'].map((tradeDate, index) => ({
      tradeDate: utcDate(tradeDate),
      open: 10 + index,
      high: 11 + index,
      low: 9 + index,
      close: 10.5 + index,
      vol: 1000 + index,
    }))
  const adjFactorRows =
    options?.adjFactorRows ??
    dailyRows.map((row) => ({
      tradeDate: row.tradeDate,
      adjFactor: 1,
    }))
  const suspendedDates = options?.suspendedDates ?? []

  return {
    stockBasic: {
      findUnique: jest.fn().mockResolvedValue({
        tsCode: '430047.BJ',
        name: '测试股票',
        exchange: options?.exchange ?? 'BSE',
        listDate: utcDate('20240102'),
        delistDate: null,
      }),
    },
    daily: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({ tradeDate: utcDate(options?.dailyWatermark ?? '20240103') })
        .mockResolvedValueOnce({ syncedAt: versionAt }),
      findMany: jest.fn().mockResolvedValue(dailyRows),
    },
    adjFactor: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({ tradeDate: utcDate(options?.adjFactorWatermark ?? '20240103') })
        .mockResolvedValueOnce({ syncedAt: versionAt }),
      findMany: jest.fn().mockResolvedValue(adjFactorRows),
    },
    tradeCal: {
      findFirst: jest.fn().mockResolvedValue({ syncedAt: versionAt }),
      findMany: jest.fn().mockResolvedValue(calendarDates.map((calDate) => ({ calDate: utcDate(calDate) }))),
    },
    suspendD: {
      findFirst: jest.fn().mockResolvedValue({ syncedAt: versionAt }),
      findMany: jest.fn().mockResolvedValue(suspendedDates.map((tradeDate) => ({ tradeDate }))),
    },
  }
}

function createInput(overrides?: Partial<LoadTechnicalSignalTimelineInput>): LoadTechnicalSignalTimelineInput {
  return {
    tsCode: '430047.BJ',
    requestedAsOf: '20240103',
    maxHorizon: 1,
    includeBenchmark: false,
    benchmarkTsCode: null,
    ...overrides,
  }
}

async function expectConflict(promise: Promise<unknown>, message: string): Promise<void> {
  try {
    await promise
    fail('预期抛出 ConflictException')
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException)
    expect((error as ConflictException).getStatus()).toBe(409)
    expect((error as Error).message).toContain(message)
  }
}

describe('PrismaTechnicalSignalRepository', () => {
  it('请求基准超额收益时立即拒绝，且不发起任何数据库查询', async () => {
    const prisma = createPrismaMock()
    const repository = new PrismaTechnicalSignalRepository(prisma as unknown as PrismaService)

    await expectConflict(
      repository.loadTimeline(createInput({ includeBenchmark: true, benchmarkTsCode: '000300.SH' })),
      'TECHNICAL_SIGNAL_BENCHMARK_NOT_READY',
    )

    expect(prisma.stockBasic.findUnique).not.toHaveBeenCalled()
    expect(prisma.daily.findFirst).not.toHaveBeenCalled()
    expect(prisma.daily.findMany).not.toHaveBeenCalled()
    expect(prisma.adjFactor.findFirst).not.toHaveBeenCalled()
    expect(prisma.adjFactor.findMany).not.toHaveBeenCalled()
    expect(prisma.tradeCal.findFirst).not.toHaveBeenCalled()
    expect(prisma.tradeCal.findMany).not.toHaveBeenCalled()
    expect(prisma.suspendD.findFirst).not.toHaveBeenCalled()
    expect(prisma.suspendD.findMany).not.toHaveBeenCalled()
  })

  it('.BJ 股票固定使用 SSE 交易日历，不查询 BSE 日历', async () => {
    const prisma = createPrismaMock({ exchange: 'BSE' })
    const repository = new PrismaTechnicalSignalRepository(prisma as unknown as PrismaService)

    const result = await repository.loadTimeline(createInput())

    expect(result.calendarExchange).toBe('SSE')
    expect(prisma.tradeCal.findFirst.mock.calls[0]?.[0]).toMatchObject({ where: { exchange: 'SSE' } })
    expect(prisma.tradeCal.findMany.mock.calls[0]?.[0]).toMatchObject({ where: { exchange: 'SSE' } })
  })

  it('开市日缺日线但存在停牌事实时允许返回', async () => {
    const prisma = createPrismaMock({
      dailyRows: [
        {
          tradeDate: utcDate('20240102'),
          open: 10,
          high: 11,
          low: 9,
          close: 10.5,
          vol: 1000,
        },
      ],
      adjFactorRows: [{ tradeDate: utcDate('20240102'), adjFactor: 1 }],
      suspendedDates: ['20240103'],
    })
    const repository = new PrismaTechnicalSignalRepository(prisma as unknown as PrismaService)

    const result = await repository.loadTimeline(createInput())

    expect(result.bars.map((bar) => bar.tradeDate)).toEqual(['20240102'])
    expect(result.suspendedDates.has('20240103')).toBe(true)
  })

  it('开市日缺日线且无停牌事实时拒绝返回不完整序列', async () => {
    const prisma = createPrismaMock({
      dailyRows: [
        {
          tradeDate: utcDate('20240102'),
          open: 10,
          high: 11,
          low: 9,
          close: 10.5,
          vol: 1000,
        },
      ],
      adjFactorRows: [{ tradeDate: utcDate('20240102'), adjFactor: 1 }],
    })
    const repository = new PrismaTechnicalSignalRepository(prisma as unknown as PrismaService)

    await expectConflict(repository.loadTimeline(createInput()), '20240103 缺日线且无停牌事实')
  })

  it('请求日期超过日线与复权因子共同水位时拒绝，避免混入未来数据', async () => {
    const prisma = createPrismaMock({ dailyWatermark: '20240103', adjFactorWatermark: '20240102' })
    const repository = new PrismaTechnicalSignalRepository(prisma as unknown as PrismaService)

    await expectConflict(repository.loadTimeline(createInput()), '请求日期超过共同水位 20240102')

    expect(prisma.tradeCal.findMany).not.toHaveBeenCalled()
    expect(prisma.daily.findMany).not.toHaveBeenCalled()
    expect(prisma.adjFactor.findMany).not.toHaveBeenCalled()
    expect(prisma.suspendD.findMany).not.toHaveBeenCalled()
  })

  it('未来交易日不足 maxHorizon 时拒绝，且不读取日线、复权或停牌明细', async () => {
    const prisma = createPrismaMock({ calendarDates: ['20240102', '20240103'] })
    const repository = new PrismaTechnicalSignalRepository(prisma as unknown as PrismaService)

    await expectConflict(repository.loadTimeline(createInput()), '交易日历未来 horizon 覆盖不足')

    expect(prisma.daily.findMany).not.toHaveBeenCalled()
    expect(prisma.adjFactor.findMany).not.toHaveBeenCalled()
    expect(prisma.suspendD.findMany).not.toHaveBeenCalled()
  })
})
