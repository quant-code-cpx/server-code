/**
 * PriceAlertService — 单元测试（OPT-4.3 告警增强）
 *
 * 覆盖要点：
 * - createRule: 无 tsCode/watchlistId/portfolioId 时抛 BadRequestException
 * - createRule: 单股模式正常创建
 * - createRule: 关联自选股组时验证归属，找不到时抛 NotFoundException
 * - createRule: 关联组合时验证归属，找不到时抛 NotFoundException
 * - expandRulesToEntries (via runScan): 有 watchlistId 时展开为多条目标
 * - runScan: 展开后有命中时正确触发 emit 并更新规则
 * - runScan: 无活跃规则时直接返回 triggered=0
 */

import { BadRequestException, NotFoundException } from '@nestjs/common'
import { PriceAlertRuleStatus, PriceAlertRuleType } from '@prisma/client'
import { PriceAlertService } from '../price-alert.service'
import { CreatePriceAlertRuleDto } from '../dto/price-alert-rule.dto'

function buildPrismaMock() {
  return {
    stockBasic: { findUnique: jest.fn(async () => null) },
    watchlist: { findFirst: jest.fn(async () => null) },
    portfolio: { findFirst: jest.fn(async () => null) },
    priceAlertRule: {
      create: jest.fn(async () => ({ id: 1 })),
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      update: jest.fn(async () => ({})),
    },
    watchlistStock: { findMany: jest.fn(async () => []) },
    portfolioHolding: { findMany: jest.fn(async () => []) },
    daily: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    stkLimit: { findMany: jest.fn(async () => []) },
  }
}

function buildGatewayMock() {
  return { emitToUser: jest.fn() }
}

function createService(prismaMock = buildPrismaMock(), gatewayMock = buildGatewayMock()) {
  return new PriceAlertService(prismaMock as any, gatewayMock as any)
}

describe('PriceAlertService (OPT-4.3)', () => {
  // ─── createRule ─────────────────────────────────────────────────────────────

  describe('createRule()', () => {
    it('should throw BadRequestException if no source is provided', async () => {
      const svc = createService()
      await expect(
        svc.createRule(1, { ruleType: PriceAlertRuleType.PRICE_ABOVE, threshold: 10 } as CreatePriceAlertRuleDto),
      ).rejects.toThrow(BadRequestException)
    })

    it('should create rule for single tsCode', async () => {
      const prisma = buildPrismaMock()
      prisma.stockBasic.findUnique.mockResolvedValue({ name: '平安银行' })
      const svc = createService(prisma)

      await svc.createRule(1, {
        tsCode: '000001.SZ',
        ruleType: PriceAlertRuleType.PRICE_ABOVE,
        threshold: 20,
      } as CreatePriceAlertRuleDto)

      expect(prisma.priceAlertRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tsCode: '000001.SZ', stockName: '平安银行' }),
      })
    })

    it('should throw NotFoundException if watchlist not found or not owned', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(
        svc.createRule(1, {
          watchlistId: 999,
          ruleType: PriceAlertRuleType.LIMIT_UP,
        } as CreatePriceAlertRuleDto),
      ).rejects.toThrow(NotFoundException)
    })

    it('should create rule with watchlistId and populate sourceName', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue({ name: '科技股组合' })
      const svc = createService(prisma)

      await svc.createRule(1, {
        watchlistId: 5,
        ruleType: PriceAlertRuleType.LIMIT_UP,
      } as CreatePriceAlertRuleDto)

      expect(prisma.priceAlertRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ watchlistId: 5, sourceName: '科技股组合' }),
      })
    })

    it('should throw NotFoundException if portfolio not found or not owned', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(
        svc.createRule(1, {
          portfolioId: 'p-999',
          ruleType: PriceAlertRuleType.LIMIT_DOWN,
        } as CreatePriceAlertRuleDto),
      ).rejects.toThrow(NotFoundException)
    })

    it('should create rule with portfolioId and populate sourceName', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findFirst.mockResolvedValue({ name: '价值组合' })
      const svc = createService(prisma)

      await svc.createRule(1, {
        portfolioId: 'p-1',
        ruleType: PriceAlertRuleType.PCT_CHANGE_UP,
        threshold: 5,
      } as CreatePriceAlertRuleDto)

      expect(prisma.priceAlertRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ portfolioId: 'p-1', sourceName: '价值组合' }),
      })
    })
  })

  // ─── runScan ────────────────────────────────────────────────────────────────

  describe('runScan()', () => {
    it('should return triggered=0 if no active rules', async () => {
      const svc = createService()
      const result = await svc.runScan()
      expect(result).toEqual({ triggered: 0 })
    })

    it('should return triggered=0 if no daily data', async () => {
      const prisma = buildPrismaMock()
      prisma.priceAlertRule.findMany.mockResolvedValue([
        {
          id: 1,
          userId: 1,
          tsCode: '000001.SZ',
          stockName: '平安银行',
          ruleType: PriceAlertRuleType.PRICE_ABOVE,
          threshold: 10,
          status: PriceAlertRuleStatus.ACTIVE,
          memo: null,
          watchlistId: null,
          portfolioId: null,
          sourceName: null,
          lastTriggeredAt: null,
          triggerCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])
      prisma.daily.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)
      const result = await svc.runScan()
      expect(result).toEqual({ triggered: 0 })
    })

    it('should expand watchlist rules and trigger when price above threshold', async () => {
      const prisma = buildPrismaMock()
      const tradeDate = new Date('2024-12-31')

      prisma.priceAlertRule.findMany.mockResolvedValue([
        {
          id: 1,
          userId: 1,
          tsCode: null,
          stockName: null,
          ruleType: PriceAlertRuleType.PRICE_ABOVE,
          threshold: 20,
          status: PriceAlertRuleStatus.ACTIVE,
          memo: null,
          watchlistId: 5,
          portfolioId: null,
          sourceName: '科技股组合',
          lastTriggeredAt: null,
          triggerCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])
      prisma.watchlistStock.findMany.mockResolvedValue([
        { watchlistId: 5, tsCode: '000001.SZ' },
        { watchlistId: 5, tsCode: '600519.SH' },
      ])
      prisma.daily.findFirst.mockResolvedValue({ tradeDate })
      prisma.daily.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', close: 25, pctChg: 2 },
        { tsCode: '600519.SH', close: 15, pctChg: -1 },
      ])

      const gateway = buildGatewayMock()
      const svc = createService(prisma, gateway)
      const result = await svc.runScan()

      // 000001.SZ triggers (close=25 > threshold=20), 600519.SH does not
      expect(result.triggered).toBe(1)
      expect(prisma.priceAlertRule.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }))
      expect(gateway.emitToUser).toHaveBeenCalledTimes(1)
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        1,
        'price-alert',
        expect.objectContaining({
          tsCode: '000001.SZ',
          source: expect.objectContaining({ type: 'WATCHLIST', id: 5 }),
        }),
      )
    })

    it('should not increment triggerCount more than once per rule even if multiple stocks hit', async () => {
      const prisma = buildPrismaMock()
      const tradeDate = new Date('2024-12-31')

      prisma.priceAlertRule.findMany.mockResolvedValue([
        {
          id: 1,
          userId: 1,
          tsCode: null,
          stockName: null,
          ruleType: PriceAlertRuleType.PRICE_ABOVE,
          threshold: 10,
          status: PriceAlertRuleStatus.ACTIVE,
          memo: null,
          watchlistId: 3,
          portfolioId: null,
          sourceName: '全仓组',
          lastTriggeredAt: null,
          triggerCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])
      prisma.watchlistStock.findMany.mockResolvedValue([
        { watchlistId: 3, tsCode: '000001.SZ' },
        { watchlistId: 3, tsCode: '000002.SZ' },
      ])
      prisma.daily.findFirst.mockResolvedValue({ tradeDate })
      prisma.daily.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', close: 50, pctChg: 3 },
        { tsCode: '000002.SZ', close: 60, pctChg: 4 },
      ])

      const gateway = buildGatewayMock()
      const svc = createService(prisma, gateway)
      await svc.runScan()

      // Both stocks trigger but rule update should only happen once
      expect(prisma.priceAlertRule.update).toHaveBeenCalledTimes(1)
      // But emit fires for each triggered stock
      expect(gateway.emitToUser).toHaveBeenCalledTimes(2)
    })
  })
})
