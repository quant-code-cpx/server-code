/**
 * WatchlistService — 单元测试
 *
 * 覆盖要点：
 * - createWatchlist：正常创建、达到上限、重复名称（P2002）、isDefault=true 触发 updateMany
 * - addStock：自选组不存在、超出 MAX_STOCKS_PER_WATCHLIST、股票不存在、重复（P2002）、成功
 * - batchAddStocks：当前数量 + 新增 > 上限时抛 BadRequestException
 * - removeStock：自选组不存在、股票不存在、成功调用 delete 和 invalidateCache
 * - updateWatchlist：不存在时抛 NotFoundException、成功时返回更新结果
 * - getWatchlistSummary：空股票列表、全上涨、涨跌平混合
 */

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { WatchlistService } from '../watchlist.service'
import { MAX_STOCKS_PER_WATCHLIST } from '../constants/watchlist.constant'
import { ADMIN_WATCHLIST_UNLIMITED } from 'src/constant/user.constant'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    watchlist: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    watchlistStock: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    user: {
      findUniqueOrThrow: jest.fn(),
    },
    stockBasic: {
      findFirst: jest.fn(),
      findMany: jest.fn(async () => []),
    },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (ops: unknown) => {
      if (Array.isArray(ops)) return Promise.all(ops)
      return (ops as (p: unknown) => Promise<unknown>)(buildPrismaMock())
    }),
  }
}

function buildCacheMock() {
  return {
    invalidateByPrefixes: jest.fn(async () => {}),
    get: jest.fn(),
    set: jest.fn(),
  }
}

function createService(prismaMock = buildPrismaMock(), cacheMock = buildCacheMock()) {
  return new WatchlistService(prismaMock as any, cacheMock as any)
}

function buildWatchlist(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: 10,
    name: '我的自选',
    description: null,
    isDefault: false,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function buildUser(overrides: Record<string, unknown> = {}) {
  return { id: 10, watchlistLimit: 5, ...overrides }
}

function buildWatchlistStock(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    watchlistId: 1,
    tsCode: '000001.SZ',
    notes: null,
    tags: [],
    targetPrice: null,
    sortOrder: 0,
    addedAt: new Date(),
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('WatchlistService', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── createWatchlist() ─────────────────────────────────────────────────────

  describe('createWatchlist()', () => {
    it('正常创建自选组', async () => {
      const prisma = buildPrismaMock()
      const user = buildUser()
      const created = buildWatchlist()
      prisma.user.findUniqueOrThrow.mockResolvedValue(user)
      prisma.watchlist.count.mockResolvedValue(0)
      prisma.watchlist.create.mockResolvedValue(created)
      const svc = createService(prisma)

      const result = await svc.createWatchlist(10, { name: '我的自选', isDefault: false })

      expect(prisma.watchlist.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: '我的自选', userId: 10 }) }),
      )
      expect(result).toEqual(created)
    })

    it('自选组数量达到上限时抛 BadRequestException', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUniqueOrThrow.mockResolvedValue(buildUser({ watchlistLimit: 3 }))
      prisma.watchlist.count.mockResolvedValue(3)
      const svc = createService(prisma)

      await expect(svc.createWatchlist(10, { name: '超限组' })).rejects.toThrow(BadRequestException)
    })

    it('watchlistLimit 为 -1（ADMIN_WATCHLIST_UNLIMITED）时不受数量限制', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUniqueOrThrow.mockResolvedValue(buildUser({ watchlistLimit: ADMIN_WATCHLIST_UNLIMITED }))
      prisma.watchlist.count.mockResolvedValue(100) // 超过普通上限
      prisma.watchlist.create.mockResolvedValue(buildWatchlist())
      const svc = createService(prisma)

      // 不应抛异常
      await expect(svc.createWatchlist(10, { name: '管理员专属' })).resolves.toBeDefined()
    })

    it('重复名称（P2002）时抛 ConflictException', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUniqueOrThrow.mockResolvedValue(buildUser())
      prisma.watchlist.count.mockResolvedValue(0)
      prisma.watchlist.create.mockRejectedValue({ code: 'P2002' })
      const svc = createService(prisma)

      await expect(svc.createWatchlist(10, { name: '重复名称' })).rejects.toThrow(ConflictException)
    })

    it('isDefault=true 时先清除现有默认组', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUniqueOrThrow.mockResolvedValue(buildUser())
      prisma.watchlist.count.mockResolvedValue(0)
      prisma.watchlist.updateMany.mockResolvedValue({ count: 1 })
      prisma.watchlist.create.mockResolvedValue(buildWatchlist({ isDefault: true }))
      const svc = createService(prisma)

      await svc.createWatchlist(10, { name: '默认组', isDefault: true })

      expect(prisma.watchlist.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 10, isDefault: true }, data: { isDefault: false } }),
      )
    })

    it('isDefault=false 时不调用 updateMany', async () => {
      const prisma = buildPrismaMock()
      prisma.user.findUniqueOrThrow.mockResolvedValue(buildUser())
      prisma.watchlist.count.mockResolvedValue(0)
      prisma.watchlist.create.mockResolvedValue(buildWatchlist())
      const svc = createService(prisma)

      await svc.createWatchlist(10, { name: '普通组', isDefault: false })

      expect(prisma.watchlist.updateMany).not.toHaveBeenCalled()
    })
  })

  // ── addStock() ────────────────────────────────────────────────────────────

  describe('addStock()', () => {
    it('自选组不存在时抛 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.addStock(10, 999, { tsCode: '000001.SZ' })).rejects.toThrow(NotFoundException)
    })

    it('股票数量达到 MAX_STOCKS_PER_WATCHLIST 时抛 BadRequestException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      prisma.watchlistStock.count.mockResolvedValue(MAX_STOCKS_PER_WATCHLIST)
      const svc = createService(prisma)

      await expect(svc.addStock(10, 1, { tsCode: '000001.SZ' })).rejects.toThrow(BadRequestException)
    })

    it('股票代码在 stockBasic 中不存在时抛 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      prisma.watchlistStock.count.mockResolvedValue(0)
      prisma.stockBasic.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.addStock(10, 1, { tsCode: '999999.SZ' })).rejects.toThrow(NotFoundException)
    })

    it('股票已存在（P2002）时抛 ConflictException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      prisma.watchlistStock.count.mockResolvedValue(0)
      prisma.stockBasic.findFirst.mockResolvedValue({ tsCode: '000001.SZ' })
      prisma.watchlistStock.create.mockRejectedValue({ code: 'P2002' })
      const svc = createService(prisma)

      await expect(svc.addStock(10, 1, { tsCode: '000001.SZ' })).rejects.toThrow(ConflictException)
    })

    it('成功添加时返回创建的股票记录', async () => {
      const prisma = buildPrismaMock()
      const stock = buildWatchlistStock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      prisma.watchlistStock.count.mockResolvedValue(5)
      prisma.stockBasic.findFirst.mockResolvedValue({ tsCode: '000001.SZ' })
      prisma.watchlistStock.create.mockResolvedValue(stock)
      const svc = createService(prisma)

      const result = await svc.addStock(10, 1, { tsCode: '000001.SZ' })

      expect(prisma.watchlistStock.create).toHaveBeenCalled()
      expect(result).toEqual(stock)
    })
  })

  // ── batchAddStocks() ──────────────────────────────────────────────────────

  describe('batchAddStocks()', () => {
    it('自选组不存在时抛 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.batchAddStocks(10, 1, { stocks: [{ tsCode: '000001.SZ' }] })).rejects.toThrow(NotFoundException)
    })

    it('当前数量 + 新增超过上限时抛 BadRequestException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      // currentCount = 195，新增 10 = 205 > 200
      prisma.watchlistStock.count.mockResolvedValue(195)
      const svc = createService(prisma)

      const stocks = Array.from({ length: 10 }, (_, i) => ({ tsCode: `00000${i}.SZ` }))
      await expect(svc.batchAddStocks(10, 1, { stocks })).rejects.toThrow(BadRequestException)
    })

    it('批量添加成功时返回 added 和 skipped 统计', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      prisma.watchlistStock.count.mockResolvedValue(0)
      prisma.watchlistStock.createMany.mockResolvedValue({ count: 2 })
      const svc = createService(prisma)

      const result = await svc.batchAddStocks(10, 1, {
        stocks: [{ tsCode: '000001.SZ' }, { tsCode: '000002.SZ' }, { tsCode: '000001.SZ' }],
      })

      expect(result.added).toBe(2)
      expect(result.skipped).toBe(1)
    })
  })

  // ── removeStock() ─────────────────────────────────────────────────────────

  describe('removeStock()', () => {
    it('自选组不存在时抛 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.removeStock(10, 999, 100)).rejects.toThrow(NotFoundException)
    })

    it('股票记录不存在时抛 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      prisma.watchlistStock.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.removeStock(10, 1, 9999)).rejects.toThrow(NotFoundException)
    })

    it('成功移除时调用 delete 并使缓存失效', async () => {
      const prisma = buildPrismaMock()
      const cache = buildCacheMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      prisma.watchlistStock.findFirst.mockResolvedValue(buildWatchlistStock())
      prisma.watchlistStock.delete.mockResolvedValue(buildWatchlistStock())
      const svc = createService(prisma, cache)

      const result = await svc.removeStock(10, 1, 100)

      expect(prisma.watchlistStock.delete).toHaveBeenCalledWith({ where: { id: 100 } })
      expect(cache.invalidateByPrefixes).toHaveBeenCalled()
      expect(result).toMatchObject({ message: '移除成功' })
    })
  })

  // ── updateWatchlist() ─────────────────────────────────────────────────────

  describe('updateWatchlist()', () => {
    it('自选组不存在时抛 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.updateWatchlist(10, 999, { name: '新名称' })).rejects.toThrow(NotFoundException)
    })

    it('成功更新时返回更新结果', async () => {
      const prisma = buildPrismaMock()
      const updated = buildWatchlist({ name: '新名称' })
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      prisma.watchlist.update.mockResolvedValue(updated)
      const svc = createService(prisma)

      const result = await svc.updateWatchlist(10, 1, { name: '新名称' })

      expect(prisma.watchlist.update).toHaveBeenCalled()
      expect(result).toEqual(updated)
    })

    it('重复名称（P2002）时抛 ConflictException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      prisma.watchlist.update.mockRejectedValue({ code: 'P2002' })
      const svc = createService(prisma)

      await expect(svc.updateWatchlist(10, 1, { name: '已存在的名称' })).rejects.toThrow(ConflictException)
    })

    it('isDefault=true 时先清除其他默认组', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist({ id: 1 }))
      prisma.watchlist.updateMany.mockResolvedValue({ count: 1 })
      prisma.watchlist.update.mockResolvedValue(buildWatchlist({ isDefault: true }))
      const svc = createService(prisma)

      await svc.updateWatchlist(10, 1, { isDefault: true })

      expect(prisma.watchlist.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ userId: 10, isDefault: true, id: { not: 1 } }),
          data: { isDefault: false },
        }),
      )
    })
  })

  // ── deleteWatchlist() ─────────────────────────────────────────────────────

  describe('deleteWatchlist()', () => {
    it('自选组不存在时抛 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.deleteWatchlist(10, 999)).rejects.toThrow(NotFoundException)
    })

    it('成功删除时调用 delete', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      prisma.watchlist.delete.mockResolvedValue(buildWatchlist())
      const svc = createService(prisma)

      const result = await svc.deleteWatchlist(10, 1)

      expect(prisma.watchlist.delete).toHaveBeenCalledWith({ where: { id: 1 } })
      expect(result).toMatchObject({ message: '删除成功' })
    })
  })

  // ── getWatchlistSummary() ─────────────────────────────────────────────────

  describe('getWatchlistSummary()', () => {
    it('自选组为空时返回全零摘要', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      prisma.watchlistStock.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.getWatchlistSummary(10, 1)

      expect(result).toEqual({ stockCount: 0, upCount: 0, downCount: 0, flatCount: 0, avgPctChg: 0, totalMv: 0 })
    })

    it('全部上涨时 upCount 等于 stockCount', async () => {
      const prisma = buildPrismaMock()
      // getStocks 内部会调 findFirst + findMany + $queryRaw
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      const stocks = [
        buildWatchlistStock({ tsCode: '000001.SZ' }),
        buildWatchlistStock({ id: 101, tsCode: '000002.SZ' }),
      ]
      prisma.watchlistStock.findMany.mockResolvedValue(stocks)
      // 模拟 $queryRaw 返回行情
      prisma.$queryRaw.mockResolvedValue([
        {
          ts_code: '000001.SZ',
          close: 10,
          pct_chg: 2.5,
          vol: 1000,
          amount: 10000,
          pe_ttm: 15,
          pb: 2,
          total_mv: 50000,
          trade_date: new Date('2024-10-30'),
        },
        {
          ts_code: '000002.SZ',
          close: 20,
          pct_chg: 1.2,
          vol: 500,
          amount: 10000,
          pe_ttm: 20,
          pb: 3,
          total_mv: 100000,
          trade_date: new Date('2024-10-30'),
        },
      ])
      const svc = createService(prisma)

      const result = await svc.getWatchlistSummary(10, 1)

      expect(result.stockCount).toBe(2)
      expect(result.upCount).toBe(2)
      expect(result.downCount).toBe(0)
      expect(result.flatCount).toBe(0)
    })

    it('涨跌平混合时各计数正确', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      const stocks = [
        buildWatchlistStock({ tsCode: '000001.SZ' }),
        buildWatchlistStock({ id: 101, tsCode: '000002.SZ' }),
        buildWatchlistStock({ id: 102, tsCode: '000003.SZ' }),
        buildWatchlistStock({ id: 103, tsCode: '000004.SZ' }),
      ]
      prisma.watchlistStock.findMany.mockResolvedValue(stocks)
      prisma.$queryRaw.mockResolvedValue([
        {
          ts_code: '000001.SZ',
          close: 10,
          pct_chg: 3.0,
          vol: 1000,
          amount: 10000,
          pe_ttm: 15,
          pb: 2,
          total_mv: 50000,
          trade_date: new Date(),
        },
        {
          ts_code: '000002.SZ',
          close: 10,
          pct_chg: -1.5,
          vol: 1000,
          amount: 10000,
          pe_ttm: 15,
          pb: 2,
          total_mv: 50000,
          trade_date: new Date(),
        },
        {
          ts_code: '000003.SZ',
          close: 10,
          pct_chg: 0,
          vol: 1000,
          amount: 10000,
          pe_ttm: 15,
          pb: 2,
          total_mv: 50000,
          trade_date: new Date(),
        },
        {
          ts_code: '000004.SZ',
          close: 10,
          pct_chg: 2.0,
          vol: 1000,
          amount: 10000,
          pe_ttm: 15,
          pb: 2,
          total_mv: 50000,
          trade_date: new Date(),
        },
      ])
      const svc = createService(prisma)

      const result = await svc.getWatchlistSummary(10, 1)

      expect(result.stockCount).toBe(4)
      expect(result.upCount).toBe(2)
      expect(result.downCount).toBe(1)
      expect(result.flatCount).toBe(1)
    })

    it('totalMv 为所有股票 totalMv 之和', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(buildWatchlist())
      const stocks = [
        buildWatchlistStock({ tsCode: '000001.SZ' }),
        buildWatchlistStock({ id: 101, tsCode: '000002.SZ' }),
      ]
      prisma.watchlistStock.findMany.mockResolvedValue(stocks)
      prisma.$queryRaw.mockResolvedValue([
        {
          ts_code: '000001.SZ',
          close: 10,
          pct_chg: 1,
          vol: 1000,
          amount: 10000,
          pe_ttm: null,
          pb: null,
          total_mv: 30000,
          trade_date: new Date(),
        },
        {
          ts_code: '000002.SZ',
          close: 10,
          pct_chg: 1,
          vol: 1000,
          amount: 10000,
          pe_ttm: null,
          pb: null,
          total_mv: 70000,
          trade_date: new Date(),
        },
      ])
      const svc = createService(prisma)

      const result = await svc.getWatchlistSummary(10, 1)

      expect(result.totalMv).toBe(100000)
    })

    it('自选组不存在时抛 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.watchlist.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.getWatchlistSummary(10, 999)).rejects.toThrow(NotFoundException)
    })
  })
})
