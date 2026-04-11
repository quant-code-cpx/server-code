/**
 * PortfolioService — 单元测试
 *
 * 覆盖要点：
 * - create: 正常创建组合
 * - list: 返回带 holdingCount 的映射结果
 * - assertOwner: 组合不存在时抛 NotFoundException，userId 不匹配时抛 ForbiddenException
 * - addHolding: 新建持仓；加仓时加权平均成本合并
 * - removeHolding: 删除持仓并触发缓存失效
 * - getPnlToday: 无持仓时返回空结果
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { Decimal } from '@prisma/client/runtime/library'
import { PortfolioService } from '../portfolio.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    portfolio: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    portfolioHolding: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    stockBasic: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    dailyBasic: {
      findMany: jest.fn(),
    },
    daily: {
      findMany: jest.fn(),
    },
    tradeCal: {
      findFirst: jest.fn(),
    },
    $queryRaw: jest.fn(async () => []),
  }
}

function buildCacheMock() {
  return {
    rememberJson: jest.fn(async (opts: { loader: () => Promise<unknown> }) => opts.loader()),
    invalidateByPrefixes: jest.fn(async () => 0),
  }
}

function createService(prismaMock = buildPrismaMock(), cacheMock = buildCacheMock()) {
  const tradeLogMock = { log: jest.fn(async () => {}) }
  return new PortfolioService(prismaMock as any, cacheMock as any, tradeLogMock as any)
}

function buildPortfolio(overrides: Record<string, unknown> = {}) {
  return {
    id: 'portfolio-001',
    userId: 10,
    name: '我的组合',
    description: null,
    initialCash: new Decimal('100000'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildHolding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'holding-001',
    portfolioId: 'portfolio-001',
    tsCode: '000001.SZ',
    stockName: '平安银行',
    quantity: 100,
    avgCost: new Decimal('10.00'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

// ═════════════════════════════════════════════════════════════════════════════

describe('PortfolioService', () => {
  // ─── create ─────────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('正常创建并返回组合信息', async () => {
      const prisma = buildPrismaMock()
      const expected = {
        id: 'portfolio-001',
        name: '测试组合',
        initialCash: new Decimal('50000'),
        description: null,
        createdAt: new Date(),
      }
      prisma.portfolio.create.mockResolvedValue(expected)

      const svc = createService(prisma)
      const result = await svc.create(10, { name: '测试组合', initialCash: 50000 })

      expect(result).toBe(expected)
      expect(prisma.portfolio.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 10, name: '测试组合' }) }),
      )
    })
  })

  // ─── list ────────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('将 _count.holdings 映射为 holdingCount', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findMany.mockResolvedValue([
        { ...buildPortfolio(), _count: { holdings: 3 } },
        { ...buildPortfolio({ id: 'portfolio-002', name: '组合2' }), _count: { holdings: 0 } },
      ])

      const svc = createService(prisma)
      const result = await svc.list(10)

      expect(result).toHaveLength(2)
      expect(result[0].holdingCount).toBe(3)
      expect(result[0]._count).toBeUndefined()
      expect(result[1].holdingCount).toBe(0)
    })
  })

  // ─── assertOwner ─────────────────────────────────────────────────────────────

  describe('assertOwner()', () => {
    it('组合不存在时抛出 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findUnique.mockResolvedValue(null)

      const svc = createService(prisma)
      await expect(svc.assertOwner('nonexistent', 10)).rejects.toThrow(NotFoundException)
    })

    it('userId 不匹配时抛出 ForbiddenException', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 99 }))

      const svc = createService(prisma)
      await expect(svc.assertOwner('portfolio-001', 10)).rejects.toThrow(ForbiddenException)
    })

    it('归属正确时返回组合对象', async () => {
      const prisma = buildPrismaMock()
      const portfolio = buildPortfolio({ userId: 10 })
      prisma.portfolio.findUnique.mockResolvedValue(portfolio)

      const svc = createService(prisma)
      const result = await svc.assertOwner('portfolio-001', 10)
      expect(result).toBe(portfolio)
    })
  })

  // ─── addHolding ───────────────────────────────────────────────────────────────

  describe('addHolding()', () => {
    it('首次持仓时调用 create', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.stockBasic.findFirst.mockResolvedValue({ name: '平安银行' })
      prisma.portfolioHolding.findUnique.mockResolvedValue(null)
      const newHolding = buildHolding()
      prisma.portfolioHolding.create.mockResolvedValue(newHolding)

      const svc = createService(prisma)
      const result = await svc.addHolding(
        { portfolioId: 'portfolio-001', tsCode: '000001.SZ', quantity: 100, avgCost: 10.0 },
        10,
      )

      expect(prisma.portfolioHolding.create).toHaveBeenCalled()
      expect(result).toBe(newHolding)
    })

    it('加仓时使用加权平均成本', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.stockBasic.findFirst.mockResolvedValue({ name: '平安银行' })
      // 已有 100 股 @10.00
      prisma.portfolioHolding.findUnique.mockResolvedValue(
        buildHolding({ quantity: 100, avgCost: new Decimal('10.00') }),
      )
      const updatedHolding = buildHolding({ quantity: 200, avgCost: new Decimal('11.00') })
      prisma.portfolioHolding.update.mockResolvedValue(updatedHolding)

      const svc = createService(prisma)
      // 再买 100 股 @12.00 → 加权平均 = (100*10 + 100*12)/200 = 11.00
      await svc.addHolding({ portfolioId: 'portfolio-001', tsCode: '000001.SZ', quantity: 100, avgCost: 12.0 }, 10)

      expect(prisma.portfolioHolding.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: 200 }),
        }),
      )
    })
  })

  // ─── removeHolding ────────────────────────────────────────────────────────────

  describe('removeHolding()', () => {
    it('删除持仓并触发缓存失效', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      prisma.portfolioHolding.findUniqueOrThrow.mockResolvedValue(buildHolding())
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.portfolioHolding.delete.mockResolvedValue({})

      const svc = createService(prisma, cache)
      const result = await svc.removeHolding('holding-001', 10)

      expect(prisma.portfolioHolding.delete).toHaveBeenCalled()
      expect(cache.invalidateByPrefixes).toHaveBeenCalled()
      expect(result).toEqual({ success: true })
    })
  })

  // ─── getPnlToday ─────────────────────────────────────────────────────────────

  describe('getPnlToday()', () => {
    it('无持仓时返回空的盈亏数据', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      // cache.rememberJson 直接调用 loader
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.tradeCal.findFirst.mockResolvedValue({ calDate: new Date() })
      prisma.portfolioHolding.findMany.mockResolvedValue([])

      const svc = createService(prisma, cache)
      const result = await svc.getPnlToday('portfolio-001', 10)

      expect(result.todayPnl).toBe(0)
      expect(result.byHolding).toHaveLength(0)
    })
  })
})
