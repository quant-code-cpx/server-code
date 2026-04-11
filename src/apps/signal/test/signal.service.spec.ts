/**
 * SignalService — 单元测试
 *
 * 覆盖要点：
 * - activate: 策略不存在抛 NotFoundException、组合不存在抛 NotFoundException、正常激活返回
 * - deactivate: 激活记录不存在抛 NotFoundException、成功停用
 * - listActivations: 空列表、有数据时带策略名
 * - getLatestSignals: 无信号返回空、有信号按策略分组
 * - parseDateStr: 8位格式、ISO格式、非法格式抛 BadRequestException
 */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { SignalService } from '../signal.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function makeActivation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'act-1',
    userId: 1,
    strategyId: 'strat-1',
    portfolioId: null,
    isActive: true,
    universe: 'HS300',
    benchmarkTsCode: '000300.SH',
    lookbackDays: 250,
    alertThreshold: 0.3,
    lastSignalDate: null,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  }
}

function makeSignal(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sig-1',
    activationId: 'act-1',
    strategyId: 'strat-1',
    userId: 1,
    tradeDate: new Date('2025-03-01'),
    tsCode: '000001.SZ',
    action: 'BUY',
    targetWeight: 0.05,
    confidence: null,
    createdAt: new Date('2025-03-01'),
    ...overrides,
  }
}

function buildPrismaMock() {
  return {
    strategy: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(async () => []),
    },
    portfolio: {
      findFirst: jest.fn(),
    },
    signalActivation: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(async () => []),
    },
    tradingSignal: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      groupBy: jest.fn(async () => []),
    },
    stockBasic: {
      findMany: jest.fn(async () => []),
    },
  }
}

function createService(prisma = buildPrismaMock()) {
  return { service: new SignalService(prisma as never), prisma }
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('SignalService', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── activate ──────────────────────────────────────────────────────────────

  describe('activate', () => {
    it('策略不存在时抛出 NotFoundException', async () => {
      const { service, prisma } = createService()
      prisma.strategy.findFirst.mockResolvedValue(null)
      await expect(service.activate({ strategyId: 'x' }, 1)).rejects.toThrow(NotFoundException)
    })

    it('指定组合不存在时抛出 NotFoundException', async () => {
      const { service, prisma } = createService()
      prisma.strategy.findFirst.mockResolvedValue({ id: 's1', name: '策略A', strategyType: 'FACTOR_RANKING' })
      prisma.portfolio.findFirst.mockResolvedValue(null)
      await expect(service.activate({ strategyId: 's1', portfolioId: 'p-bad' }, 1)).rejects.toThrow(NotFoundException)
    })

    it('正常激活返回 SignalActivationItemDto', async () => {
      const { service, prisma } = createService()
      prisma.strategy.findFirst.mockResolvedValue({ id: 's1', name: '策略A', strategyType: 'FACTOR_RANKING' })
      const act = makeActivation()
      prisma.signalActivation.upsert.mockResolvedValue(act)

      const result = await service.activate({ strategyId: 's1' }, 1)
      expect(result.strategyId).toBe('strat-1')
      expect(result.isActive).toBe(true)
      expect(result.strategyName).toBe('策略A')
      expect(prisma.signalActivation.upsert).toHaveBeenCalled()
    })
  })

  // ── deactivate ────────────────────────────────────────────────────────────

  describe('deactivate', () => {
    it('激活记录不存在时抛出 NotFoundException', async () => {
      const { service, prisma } = createService()
      prisma.signalActivation.findUnique.mockResolvedValue(null)
      await expect(service.deactivate({ strategyId: 's1' }, 1)).rejects.toThrow(NotFoundException)
    })

    it('成功停用后 isActive 为 false', async () => {
      const { service, prisma } = createService()
      const act = makeActivation()
      prisma.signalActivation.findUnique.mockResolvedValue(act)
      const updated = { ...act, isActive: false }
      prisma.signalActivation.update.mockResolvedValue(updated)
      prisma.strategy.findUnique.mockResolvedValue({ name: '策略A' })

      const result = await service.deactivate({ strategyId: 'strat-1' }, 1)
      expect(result.isActive).toBe(false)
    })
  })

  // ── listActivations ───────────────────────────────────────────────────────

  describe('listActivations', () => {
    it('无激活记录时返回空数组', async () => {
      const { service, prisma } = createService()
      prisma.signalActivation.findMany.mockResolvedValue([])
      const result = await service.listActivations(1)
      expect(result).toEqual([])
    })

    it('有激活记录时正确拼接策略名', async () => {
      const { service, prisma } = createService()
      prisma.signalActivation.findMany.mockResolvedValue([makeActivation()])
      prisma.strategy.findMany.mockResolvedValue([{ id: 'strat-1', name: '策略A' }])

      const result = await service.listActivations(1)
      expect(result).toHaveLength(1)
      expect(result[0].strategyName).toBe('策略A')
    })
  })

  // ── getLatestSignals ──────────────────────────────────────────────────────

  describe('getLatestSignals', () => {
    it('无历史信号时返回空数组', async () => {
      const { service, prisma } = createService()
      prisma.tradingSignal.findFirst.mockResolvedValue(null)
      const result = await service.getLatestSignals({}, 1)
      expect(result).toEqual([])
    })

    it('有信号时按策略 ID 分组返回', async () => {
      const { service, prisma } = createService()
      const sig = makeSignal()
      prisma.tradingSignal.findFirst.mockResolvedValue({ tradeDate: sig.tradeDate })
      prisma.tradingSignal.findMany.mockResolvedValue([sig])
      prisma.strategy.findMany.mockResolvedValue([{ id: 'strat-1', name: '策略A' }])
      prisma.stockBasic.findMany.mockResolvedValue([{ tsCode: '000001.SZ', name: '平安银行' }])

      const result = await service.getLatestSignals({}, 1)
      expect(result).toHaveLength(1)
      expect(result[0].strategyId).toBe('strat-1')
      expect(result[0].signals[0].tsCode).toBe('000001.SZ')
    })
  })

  // ── parseDateStr ──────────────────────────────────────────────────────────

  describe('parseDateStr', () => {
    it('解析 8 位格式 YYYYMMDD', () => {
      const { service } = createService()
      const d = service.parseDateStr('20250301')
      expect(d.getFullYear()).toBe(2025)
      expect(d.getMonth()).toBe(2) // 0-indexed
      expect(d.getDate()).toBe(1)
    })

    it('解析 ISO 格式 YYYY-MM-DD', () => {
      const { service } = createService()
      const d = service.parseDateStr('2025-03-01')
      expect(d.getFullYear()).toBe(2025)
    })

    it('非法格式抛出 BadRequestException', () => {
      const { service } = createService()
      expect(() => service.parseDateStr('not-a-date')).toThrow(BadRequestException)
    })
  })
})
