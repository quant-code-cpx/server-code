/**
 * TushareMarketDataProvider — 单元测试
 *
 * 覆盖要点：
 * - getTradingDays() 查询交易日历并返回日期数组
 * - getDailyBars() 查询日线数据并正确转换 Decimal 类型
 * - getAdjustmentFactors() 查询复权因子
 * - getLimitPrices() 查询涨跌停价格
 * - getSuspendData() 查询停牌信息
 * - 空 tsCodes 数组直接返回空数组
 */

import { TushareMarketDataProvider } from '../tushare-market-data.provider'
import { PrismaService } from 'src/shared/prisma.service'

// ── mock PrismaService ──────────────────────────────────────────────────────

function createMockPrisma(): PrismaService {
  return {
    tradeCal: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    daily: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    adjFactor: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    stkLimit: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    suspendD: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as unknown as PrismaService
}

describe('TushareMarketDataProvider', () => {
  let provider: TushareMarketDataProvider
  let prisma: PrismaService

  beforeEach(() => {
    prisma = createMockPrisma()
    provider = new TushareMarketDataProvider(prisma)
  })

  it('should have providerId "tushare-prisma"', () => {
    expect(provider.providerId).toBe('tushare-prisma')
  })

  // ── getTradingDays ──────────────────────────────────────────────────────

  describe('getTradingDays', () => {
    it('should query SSE trading calendar and return dates', async () => {
      const mockDates = [
        { calDate: new Date('2026-01-02') },
        { calDate: new Date('2026-01-05') },
      ]
      ;(prisma.tradeCal.findMany as jest.Mock).mockResolvedValue(mockDates)

      const start = new Date('2026-01-01')
      const end = new Date('2026-01-10')
      const result = await provider.getTradingDays(start, end)

      expect(result).toEqual([new Date('2026-01-02'), new Date('2026-01-05')])
      expect(prisma.tradeCal.findMany).toHaveBeenCalledWith({
        where: {
          exchange: 'SSE',
          calDate: { gte: start, lte: end },
          isOpen: '1',
        },
        orderBy: { calDate: 'asc' },
        select: { calDate: true },
      })
    })
  })

  // ── getDailyBars ────────────────────────────────────────────────────────

  describe('getDailyBars', () => {
    it('should return empty array for empty tsCodes', async () => {
      const result = await provider.getDailyBars([], new Date(), new Date())
      expect(result).toEqual([])
      expect(prisma.daily.findMany).not.toHaveBeenCalled()
    })

    it('should query and convert Decimal fields to numbers', async () => {
      const mockRow = {
        tsCode: '000001.SZ',
        tradeDate: new Date('2026-01-02'),
        open: 10.5,
        high: 11.0,
        low: 10.2,
        close: 10.8,
        preClose: 10.3,
        vol: 1000000,
        amount: 5000000,
      }
      ;(prisma.daily.findMany as jest.Mock).mockResolvedValue([mockRow])

      const result = await provider.getDailyBars(
        ['000001.SZ'],
        new Date('2026-01-01'),
        new Date('2026-01-10'),
      )

      expect(result).toHaveLength(1)
      expect(result[0].tsCode).toBe('000001.SZ')
      expect(typeof result[0].open).toBe('number')
      expect(typeof result[0].close).toBe('number')
    })

    it('should handle null values', async () => {
      const mockRow = {
        tsCode: '000001.SZ',
        tradeDate: new Date('2026-01-02'),
        open: null,
        high: null,
        low: null,
        close: null,
        preClose: null,
        vol: null,
        amount: null,
      }
      ;(prisma.daily.findMany as jest.Mock).mockResolvedValue([mockRow])

      const result = await provider.getDailyBars(
        ['000001.SZ'],
        new Date('2026-01-01'),
        new Date('2026-01-10'),
      )

      expect(result[0].open).toBeNull()
      expect(result[0].close).toBeNull()
      expect(result[0].vol).toBeNull()
    })
  })

  // ── getAdjustmentFactors ────────────────────────────────────────────────

  describe('getAdjustmentFactors', () => {
    it('should return empty array for empty tsCodes', async () => {
      const result = await provider.getAdjustmentFactors([], new Date(), new Date())
      expect(result).toEqual([])
    })

    it('should query and return adjustment factors', async () => {
      const mockRow = {
        tsCode: '000001.SZ',
        tradeDate: new Date('2026-01-02'),
        adjFactor: 120.5,
      }
      ;(prisma.adjFactor.findMany as jest.Mock).mockResolvedValue([mockRow])

      const result = await provider.getAdjustmentFactors(
        ['000001.SZ'],
        new Date('2026-01-01'),
        new Date('2026-01-10'),
      )

      expect(result).toHaveLength(1)
      expect(result[0].adjFactor).toBe(120.5)
    })

    it('should default adjFactor to 1 when null', async () => {
      const mockRow = {
        tsCode: '000001.SZ',
        tradeDate: new Date('2026-01-02'),
        adjFactor: null,
      }
      ;(prisma.adjFactor.findMany as jest.Mock).mockResolvedValue([mockRow])

      const result = await provider.getAdjustmentFactors(
        ['000001.SZ'],
        new Date('2026-01-01'),
        new Date('2026-01-10'),
      )

      expect(result[0].adjFactor).toBe(1)
    })
  })

  // ── getLimitPrices ──────────────────────────────────────────────────────

  describe('getLimitPrices', () => {
    it('should return empty array for empty tsCodes', async () => {
      const result = await provider.getLimitPrices([], new Date(), new Date())
      expect(result).toEqual([])
    })

    it('should query and return limit prices', async () => {
      const mockRow = {
        tsCode: '000001.SZ',
        tradeDate: '20260102',
        upLimit: 11.88,
        downLimit: 9.72,
      }
      ;(prisma.stkLimit.findMany as jest.Mock).mockResolvedValue([mockRow])

      const result = await provider.getLimitPrices(
        ['000001.SZ'],
        new Date('2026-01-01'),
        new Date('2026-01-10'),
      )

      expect(result).toHaveLength(1)
      expect(result[0].upLimit).toBe(11.88)
      expect(result[0].downLimit).toBe(9.72)
    })
  })

  // ── getSuspendData ──────────────────────────────────────────────────────

  describe('getSuspendData', () => {
    it('should return empty array for empty tsCodes', async () => {
      const result = await provider.getSuspendData([], new Date(), new Date())
      expect(result).toEqual([])
    })

    it('should query and return suspend data', async () => {
      const mockRow = {
        tsCode: '000001.SZ',
        tradeDate: '20260102',
        suspendTiming: 'A',
      }
      ;(prisma.suspendD.findMany as jest.Mock).mockResolvedValue([mockRow])

      const result = await provider.getSuspendData(
        ['000001.SZ'],
        new Date('2026-01-01'),
        new Date('2026-01-10'),
      )

      expect(result).toHaveLength(1)
      expect(result[0].suspendTiming).toBe('A')
    })

    it('should handle null suspendTiming', async () => {
      const mockRow = {
        tsCode: '000001.SZ',
        tradeDate: '20260102',
        suspendTiming: undefined,
      }
      ;(prisma.suspendD.findMany as jest.Mock).mockResolvedValue([mockRow])

      const result = await provider.getSuspendData(
        ['000001.SZ'],
        new Date('2026-01-01'),
        new Date('2026-01-10'),
      )

      expect(result[0].suspendTiming).toBeNull()
    })
  })
})
