/**
 * PortfolioTradeLogService — 单元测试
 *
 * 覆盖要点：
 * - log: 正常写入交易日志
 * - query: ownership check 失败时抛异常；正常分页查询
 * - summary: ownership check 失败时抛异常；正常分组汇总
 */

import { PortfolioTradeLogService } from '../services/portfolio-trade-log.service'
import { TradeLogQueryDto, TradeLogSummaryDto } from '../dto/trade-log.dto'

function buildPrismaMock() {
  return {
    portfolioTradeLog: {
      create: jest.fn(async () => ({})),
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
      groupBy: jest.fn(async () => []),
    },
    portfolio: {
      findFirstOrThrow: jest.fn(),
    },
  }
}

function createService(prismaMock = buildPrismaMock()) {
  return new PortfolioTradeLogService(prismaMock as any)
}

describe('PortfolioTradeLogService', () => {
  // ─── log ────────────────────────────────────────────────────────────────────

  describe('log()', () => {
    it('should create a trade log entry', async () => {
      const prisma = buildPrismaMock()
      const svc = createService(prisma)

      await svc.log({
        portfolioId: 'p-1',
        userId: 1,
        tsCode: '000001.SZ',
        stockName: '平安银行',
        action: 'ADD',
        quantity: 100,
        price: 15.5,
        reason: 'MANUAL',
      })

      expect(prisma.portfolioTradeLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          portfolioId: 'p-1',
          userId: 1,
          tsCode: '000001.SZ',
          action: 'ADD',
          reason: 'MANUAL',
          quantity: 100,
        }),
      })
    })

    it('should pass detail as JSON', async () => {
      const prisma = buildPrismaMock()
      const svc = createService(prisma)

      await svc.log({
        portfolioId: 'p-1',
        userId: 1,
        tsCode: '000001.SZ',
        action: 'BUY',
        quantity: 200,
        reason: 'BACKTEST_IMPORT',
        detail: { backtestRunId: 'run-123', mode: 'REPLACE' },
      })

      expect(prisma.portfolioTradeLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          detail: { backtestRunId: 'run-123', mode: 'REPLACE' },
        }),
      })
    })
  })

  // ─── query ──────────────────────────────────────────────────────────────────

  describe('query()', () => {
    it('should throw if portfolio not owned by user', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findFirstOrThrow.mockRejectedValue(new Error('Not found'))
      const svc = createService(prisma)

      await expect(svc.query({ portfolioId: 'p-999' } as TradeLogQueryDto, 99)).rejects.toThrow()
    })

    it('should return paginated results', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findFirstOrThrow.mockResolvedValue({ id: 'p-1', userId: 1 })
      prisma.portfolioTradeLog.count.mockResolvedValue(3)
      prisma.portfolioTradeLog.findMany.mockResolvedValue([
        { id: 'log-1', action: 'ADD', tsCode: '000001.SZ' },
        { id: 'log-2', action: 'ADJUST', tsCode: '000001.SZ' },
        { id: 'log-3', action: 'REMOVE', tsCode: '000001.SZ' },
      ])
      const svc = createService(prisma)

      const result = await svc.query({ portfolioId: 'p-1', page: 1, pageSize: 20 } as TradeLogQueryDto, 1)

      expect(result.total).toBe(3)
      expect(result.items).toHaveLength(3)
      expect(result.page).toBe(1)
    })

    it('should apply date filters when provided', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findFirstOrThrow.mockResolvedValue({ id: 'p-1', userId: 1 })
      prisma.portfolioTradeLog.count.mockResolvedValue(0)
      prisma.portfolioTradeLog.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.query({ portfolioId: 'p-1', startDate: '2024-01-01', endDate: '2024-12-31' } as TradeLogQueryDto, 1)

      expect(prisma.portfolioTradeLog.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({ gte: expect.any(Date), lte: expect.any(Date) }),
          }),
        }),
      )
    })
  })

  // ─── summary ────────────────────────────────────────────────────────────────

  describe('summary()', () => {
    it('should throw if portfolio not owned by user', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findFirstOrThrow.mockRejectedValue(new Error('Not found'))
      const svc = createService(prisma)

      await expect(svc.summary({ portfolioId: 'p-999' } as TradeLogSummaryDto, 99)).rejects.toThrow()
    })

    it('should call groupBy and return rows', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findFirstOrThrow.mockResolvedValue({ id: 'p-1', userId: 1 })
      const mockRows = [
        { action: 'ADD', reason: 'MANUAL', tsCode: '000001.SZ', stockName: '平安银行', _count: { id: 5 } },
      ]
      prisma.portfolioTradeLog.groupBy.mockResolvedValue(mockRows)
      const svc = createService(prisma)

      const result = await svc.summary({ portfolioId: 'p-1' } as TradeLogSummaryDto, 1)

      expect(result).toEqual(mockRows)
      expect(prisma.portfolioTradeLog.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['action', 'reason', 'tsCode', 'stockName'] }),
      )
    })
  })
})
