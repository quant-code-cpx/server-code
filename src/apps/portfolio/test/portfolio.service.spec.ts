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

    it('[BIZ] 无最新交易日（tradeCal 无数据）→ 返回 tradeDate: null, todayPnl: 0', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.tradeCal.findFirst.mockResolvedValue(null) // 无交易日历

      const svc = createService(prisma, cache)
      const result = await svc.getPnlToday('portfolio-001', 10)

      expect(result.tradeDate).toBeNull()
      expect(result.todayPnl).toBe(0)
      expect(result.byHolding).toHaveLength(0)
    })

    it('[BIZ] 持仓全部停牌（无行情）→ todayPnl=0, byHolding 中 pctChg 和 todayPnl 为 null', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      const tradeDate = new Date()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.tradeCal.findFirst.mockResolvedValue({ calDate: tradeDate })
      prisma.portfolioHolding.findMany.mockResolvedValue([buildHolding()])
      // 无行情（停牌）
      prisma.daily.findMany.mockResolvedValue([])

      const svc = createService(prisma, cache)
      const result = await svc.getPnlToday('portfolio-001', 10)

      expect(result.todayPnl).toBe(0)
      expect(result.byHolding).toHaveLength(1)
      expect(result.byHolding[0].pctChg).toBeNull()
      expect(result.byHolding[0].todayPnl).toBeNull()
    })

    it('[BIZ] 持仓有行情 → todayPnl = 昨日市值 × pctChg/100', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      const tradeDate = new Date()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.tradeCal.findFirst.mockResolvedValue({ calDate: tradeDate })
      prisma.portfolioHolding.findMany.mockResolvedValue([buildHolding({ quantity: 100, tsCode: '000001.SZ' })])
      // 收盘价 10 元，涨幅 2%
      prisma.daily.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', close: new Decimal('10.00'), pctChg: new Decimal('2.00') },
      ])

      const svc = createService(prisma, cache)
      const result = await svc.getPnlToday('portfolio-001', 10)

      // 手算：mv = 10 * 100 = 1000, yesterdayMV = 1000 / (1 + 2/100) = 1000/1.02 ≈ 980.39
      // todayPnl = 980.39 * 2/100 ≈ 19.608
      const expectedPnl = (1000 / 1.02) * 0.02
      expect(result.todayPnl).toBeCloseTo(expectedPnl, 5)
      expect(result.byHolding[0].pctChg).toBeCloseTo(2, 5)
    })

    it('[BIZ] 涨幅 10%、收盘 11 元、100 股 → todayPnl = 100（昨日市值 1000×10%）', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      const tradeDate = new Date()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.tradeCal.findFirst.mockResolvedValue({ calDate: tradeDate })
      prisma.portfolioHolding.findMany.mockResolvedValue([buildHolding({ quantity: 100, tsCode: '000001.SZ' })])
      // 今日收盘 11 元，涨幅 10%（昨日收盘 = 11/1.1 = 10 元）
      prisma.daily.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', close: new Decimal('11.00'), pctChg: new Decimal('10.00') },
      ])

      const svc = createService(prisma, cache)
      const result = await svc.getPnlToday('portfolio-001', 10)

      // mv = 11*100 = 1100, yesterdayMV = 1100/1.1 = 1000, todayPnl = 1000 * 0.1 = 100
      expect(result.todayPnl).toBeCloseTo(100, 5)
    })

    it('[BIZ] 多只持仓混合涨跌 → todayPnl 正确汇总', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      const tradeDate = new Date()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.tradeCal.findFirst.mockResolvedValue({ calDate: tradeDate })
      prisma.portfolioHolding.findMany.mockResolvedValue([
        buildHolding({ quantity: 100, tsCode: '000001.SZ' }),
        buildHolding({ id: 'h2', quantity: 200, tsCode: '000002.SZ', stockName: '万科A' }),
      ])
      prisma.daily.findMany.mockResolvedValue([
        // 股票A: close=11, +10% → 昨日mv=1000, pnl=100
        { tsCode: '000001.SZ', close: new Decimal('11.00'), pctChg: new Decimal('10.00') },
        // 股票B: close=9, -10% → 昨日mv=2000, pnl=-200
        { tsCode: '000002.SZ', close: new Decimal('9.00'), pctChg: new Decimal('-10.00') },
      ])

      const svc = createService(prisma, cache)
      const result = await svc.getPnlToday('portfolio-001', 10)

      // 手算：A: (1100/1.1)*0.1 = 100, B: (1800/0.9)*(-0.1) = -200
      const pnlA = (11 * 100 / 1.1) * 0.1
      const pnlB = (9 * 200 / 0.9) * (-0.1)
      expect(result.todayPnl).toBeCloseTo(pnlA + pnlB, 5)
      expect(result.byHolding).toHaveLength(2)
    })
  })

  // ─── addHolding: 加权平均成本精确值 ───────────────────────────────────────────

  describe('[BIZ] addHolding() 加权平均成本精确值', () => {
    it('[BIZ] 100股@10 + 200股@15 → 加权平均成本 = (1000+3000)/300 ≈ 13.333', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.stockBasic.findFirst.mockResolvedValue({ name: '测试股票' })
      prisma.portfolioHolding.findUnique.mockResolvedValue(
        buildHolding({ quantity: 100, avgCost: new Decimal('10.00') }),
      )
      const updatedHolding = buildHolding({ quantity: 300, avgCost: new Decimal('13.333333') })
      prisma.portfolioHolding.update.mockResolvedValue(updatedHolding)

      const svc = createService(prisma)
      await svc.addHolding({ portfolioId: 'portfolio-001', tsCode: '000001.SZ', quantity: 200, avgCost: 15.0 }, 10)

      const updateCall = prisma.portfolioHolding.update.mock.calls[0][0]
      expect(updateCall.data.quantity).toBe(300)
      // 加权平均 = (100*10 + 200*15)/300 = 4000/300 = 13.333...
      expect(Number(updateCall.data.avgCost)).toBeCloseTo(4000 / 300, 5)
    })

    it('[BIZ] 100股@10 + 100股@20 → 加权平均成本精确为 15.00', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.stockBasic.findFirst.mockResolvedValue({ name: '测试股票' })
      prisma.portfolioHolding.findUnique.mockResolvedValue(
        buildHolding({ quantity: 100, avgCost: new Decimal('10.00') }),
      )
      prisma.portfolioHolding.update.mockResolvedValue(buildHolding({ quantity: 200 }))

      const svc = createService(prisma)
      await svc.addHolding({ portfolioId: 'portfolio-001', tsCode: '000001.SZ', quantity: 100, avgCost: 20.0 }, 10)

      const updateCall = prisma.portfolioHolding.update.mock.calls[0][0]
      expect(updateCall.data.quantity).toBe(200)
      expect(Number(updateCall.data.avgCost)).toBeCloseTo(15.0, 5)
    })
  })

  // ─── assertOwner: 权限边界 ─────────────────────────────────────────────────────

  describe('[SEC] assertOwner() 权限边界', () => {
    it('[SEC] userId 与 portfolio.userId 差 1 时也应抛出 ForbiddenException', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 11 }))

      const svc = createService(prisma)
      // 请求方是 userId=10，但 portfolio 属于 userId=11
      await expect(svc.assertOwner('portfolio-001', 10)).rejects.toThrow(ForbiddenException)
    })
  })

  // ─── buildDetail: 组合详情与未实现盈亏 ──────────────────────────────────────────

  describe('[BIZ] detail() — totalUnrealizedPnl 部分缺价场景', () => {
    it('[BIZ] 全部持仓有价格 → totalUnrealizedPnl = totalMV - totalCostWithPrice', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      const portfolio = buildPortfolio({ userId: 10 })
      prisma.portfolio.findUnique.mockResolvedValue(portfolio)
      prisma.tradeCal.findFirst.mockResolvedValue({ calDate: new Date() })
      prisma.portfolioHolding.findMany.mockResolvedValue([
        buildHolding({ tsCode: '000001.SZ', quantity: 100, avgCost: new Decimal('10.00') }),
        buildHolding({ id: 'h2', tsCode: '000002.SZ', quantity: 200, avgCost: new Decimal('20.00'), stockName: '万科A' }),
      ])
      prisma.dailyBasic.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', close: 12, totalMv: null },
        { tsCode: '000002.SZ', close: 18, totalMv: null },
      ])
      prisma.stockBasic.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', industry: '银行' },
        { tsCode: '000002.SZ', industry: '房地产' },
      ])

      const svc = createService(prisma, cache)
      const result = await svc.detail('portfolio-001', 10)

      // 手算: A市值=12*100=1200, 成本=10*100=1000; B市值=18*200=3600, 成本=20*200=4000
      // totalMV=4800, totalCost=5000, totalCostWithPrice=5000, unrealizedPnl=4800-5000=-200
      expect(result.summary.totalMarketValue).toBe(4800)
      expect(result.summary.totalCost).toBe(5000)
      expect(result.summary.totalUnrealizedPnl).toBeCloseTo(-200, 5)
    })

    it('[BIZ] 部分持仓缺价 → totalUnrealizedPnl 仅对有价格持仓求和', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      const portfolio = buildPortfolio({ userId: 10 })
      prisma.portfolio.findUnique.mockResolvedValue(portfolio)
      prisma.tradeCal.findFirst.mockResolvedValue({ calDate: new Date() })
      prisma.portfolioHolding.findMany.mockResolvedValue([
        buildHolding({ tsCode: '000001.SZ', quantity: 100, avgCost: new Decimal('10.00') }),
        buildHolding({ id: 'h2', tsCode: '000002.SZ', quantity: 200, avgCost: new Decimal('5.00'), stockName: '停牌股' }),
      ])
      // 只有 000001 有价格，000002 停牌无价格
      prisma.dailyBasic.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', close: 12, totalMv: null },
      ])
      prisma.stockBasic.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', industry: '银行' },
        { tsCode: '000002.SZ', industry: '停牌行业' },
      ])

      const svc = createService(prisma, cache)
      const result = await svc.detail('portfolio-001', 10)

      // 手算: A市值=1200, A成本=1000 → 有价PnL=200
      // B停牌无价格 → 不参与 PnL 计算
      // totalCost=2000 (包含B的500*200=1000)
      // totalMarketValue=1200 (只有A)
      // totalUnrealizedPnl = 1200 - 1000 = 200 (只对有价的A求差)
      expect(result.summary.totalMarketValue).toBe(1200)
      expect(result.summary.totalCost).toBe(2000)
      expect(result.summary.totalUnrealizedPnl).toBeCloseTo(200, 5)
    })
  })

  // ─── addHolding: Number(Decimal) 精度丢失 ────────────────────────────────────

  describe('[BUG P1-B8] addHolding() — Number(Decimal) 精度丢失', () => {
    it('[BUG P1-B8] 成本价含高精度小数时 Number(Decimal) 引入 IEEE 754 舍入误差', async () => {
      // 业务场景：avgCost 为循环小数（如 1/3 = 0.333...），Decimal 可精确表示
      // 但代码使用 Number(existing.avgCost) 将 Decimal 转为 JS float（IEEE 754 双精度）
      // 双精度只有 15-16 位有效数字，超出部分被截断
      const prisma = buildPrismaMock()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.stockBasic.findFirst.mockResolvedValue({ name: '精度测试股' })

      // avgCost = 1/3（循环小数，用 Decimal 可精确保存到任意位数）
      const exactDecimalStr = '3.33333333333333333333' // 20 位小数
      prisma.portfolioHolding.findUnique.mockResolvedValue(
        buildHolding({ quantity: 3, avgCost: new Decimal(exactDecimalStr) }),
      )
      prisma.portfolioHolding.update.mockResolvedValue(buildHolding({ quantity: 6 }))

      const svc = createService(prisma)
      // 加仓：再买 3 股 @10 元 → newAvgCost = (3*exactDecimal + 3*10) / 6
      await svc.addHolding({ portfolioId: 'portfolio-001', tsCode: '000001.SZ', quantity: 3, avgCost: 10 }, 10)

      const updateCall = prisma.portfolioHolding.update.mock.calls[0][0]
      const computedAvgCost = Number(updateCall.data.avgCost)

      // 手算（精确 Decimal 运算）：
      // newAvgCost = (3 * 3.33333333333333333333 + 3 * 10) / 6 = (9.99999... + 30) / 6 = 39.99999... / 6
      const exactResult = new Decimal(exactDecimalStr).mul(3).plus(new Decimal(10).mul(3)).div(6)

      // 结果在 10 位精度内接近（单次误差在 ~1e-16 量级）
      expect(computedAvgCost).toBeCloseTo(Number(exactResult), 10)

      // 文档化：Number('3.33333333333333333333') ≠ 精确的 10/3
      // IEEE 754 double 仅保留 15-16 位有效数字，超出部分被截断为最近可表示值
      // 例：Number('3.33333333333333333333') = 3.3333333333333335（末位有舍入）
      //   而 Decimal 运算中 3*3.33333333333333333333 = 9.99999999999999999999（精确）
      const jsFloat = Number(new Decimal(exactDecimalStr))       // 3.3333333333333335 (截断)
      const decimalStr = new Decimal(exactDecimalStr).toFixed(20) // '3.33333333333333333333'（精确）
      // Number 转换会丢失超出 double 精度的位数
      expect(jsFloat.toString().length).toBeLessThan(decimalStr.replace('.', '').length)
      // 修复方案：使用 Decimal 运算代替 Number() 转换
      // newAvgCost = existing.avgCost.mul(existing.quantity).plus(new Decimal(dto.avgCost).mul(dto.quantity)).div(newQty)
    })
  })

  // ─── getPnlToday: NaN 与除零场景 ─────────────────────────────────────────────

  describe('[BUG P1-B9] getPnlToday() — pctChg=-100% 时 todayPnl 为 NaN', () => {
    it('[BUG P1-B9] 股票退市（close=0, pctChg=-100）时 todayPnl 为 NaN 污染汇总结果', async () => {
      // 业务场景：A 股退市当天 close=0, pctChg=-100
      // 代码计算：todayPnl = (mv / (1 + pctChg/100)) * (pctChg/100)
      //         = (0 / (1 + (-100)/100)) * (-100/100)
      //         = (0 / 0) * (-1) = NaN * (-1) = NaN
      // 手算（正确）：退市当天应保护性返回 todayPnl=0 或昨日市值（不能为 NaN）
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      const tradeDate = new Date()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.tradeCal.findFirst.mockResolvedValue({ calDate: tradeDate })
      prisma.portfolioHolding.findMany.mockResolvedValue([buildHolding({ quantity: 100, tsCode: '000001.SZ' })])
      // 退市：收盘价为 0，跌幅 -100%
      prisma.daily.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', close: new Decimal('0'), pctChg: new Decimal('-100') },
      ])

      const svc = createService(prisma, cache)
      const result = await svc.getPnlToday('portfolio-001', 10)

      // [BUG P1-B9] 0/0 = NaN，NaN != null → totalPnl += NaN → todayPnl = NaN
      // 修复后应改为：expect(result.todayPnl).toBe(0) 或有限值
      expect(isNaN(result.todayPnl)).toBe(true)
      // byHolding 中该持仓的 todayPnl 也为 NaN
      expect(isNaN(result.byHolding[0].todayPnl!)).toBe(true)
    })

    it('[BUG P1-B9] 退市持仓与正常持仓混合时总 todayPnl 被 NaN 污染', async () => {
      // 即使另一只股票正常，NaN 传播导致整个 todayPnl 为 NaN
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      const tradeDate = new Date()
      prisma.portfolio.findUnique.mockResolvedValue(buildPortfolio({ userId: 10 }))
      prisma.tradeCal.findFirst.mockResolvedValue({ calDate: tradeDate })
      prisma.portfolioHolding.findMany.mockResolvedValue([
        buildHolding({ quantity: 100, tsCode: '000001.SZ' }),
        buildHolding({ id: 'h2', quantity: 200, tsCode: '000002.SZ', stockName: '正常股' }),
      ])
      prisma.daily.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', close: new Decimal('0'), pctChg: new Decimal('-100') }, // 退市
        { tsCode: '000002.SZ', close: new Decimal('10'), pctChg: new Decimal('5') }, // 正常 +5%
      ])

      const svc = createService(prisma, cache)
      const result = await svc.getPnlToday('portfolio-001', 10)

      // [BUG] 000001 的 todayPnl=NaN，0+NaN+正常股pnl = NaN
      // 正常股手算：mv=10*200=2000, pnl=(2000/1.05)*0.05 ≈ 95.24
      expect(isNaN(result.todayPnl)).toBe(true) // NaN 污染整体汇总
      // 修复方案：(mv / (1 + pctChg/100)) 分母为零时返回 0（退市当天 pnl=0 是合理默认值）
    })
  })
})
