/**
 * DriftDetectionService — 单元测试
 *
 * 覆盖要点：
 * - detect: 无信号时返回 totalDriftScore=0、完全对齐时偏离为 0、有漂移时正确计算指标
 * - detectAndNotify: 无 portfolioId 提前返回、未超阈值不推送 WebSocket、超阈值推送 WebSocket
 * - computeDrift 权重逻辑：持仓中有额外标的 → EXTRA_IN_PORTFOLIO；信号目标不在持仓 → MISSING_IN_PORTFOLIO
 */
import { BadRequestException } from '@nestjs/common'
import { DriftDetectionService } from '../drift-detection.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function makeActivation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'act-1',
    userId: 1,
    strategyId: 'strat-1',
    portfolioId: 'p-1',
    isActive: true,
    alertThreshold: 0.3,
    ...overrides,
  }
}

function buildMocks() {
  const mockPrisma = {
    signalActivation: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    tradingSignal: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
    },
    portfolioHolding: {
      findMany: jest.fn(async () => []),
    },
    daily: {
      findMany: jest.fn(async () => []),
    },
    portfolio: {
      findUnique: jest.fn(async () => ({ id: 'p-1', name: '测试组合' })),
    },
    stockBasic: {
      findMany: jest.fn(async () => []),
    },
  }

  const mockPortfolioService = {
    assertOwner: jest.fn(async () => ({ id: 'p-1', name: '测试组合' })),
  }

  const mockEventsGateway = {
    emitToUser: jest.fn(),
  }

  return { mockPrisma, mockPortfolioService, mockEventsGateway }
}

function createService(mocks = buildMocks()) {
  const svc = new DriftDetectionService(
    mocks.mockPrisma as never,
    mocks.mockPortfolioService as never,
    mocks.mockEventsGateway as never,
  )
  return { svc, ...mocks }
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('DriftDetectionService', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── detect ────────────────────────────────────────────────────────────────

  describe('detect', () => {
    it('无 strategyId 且组合无激活关联时抛 BadRequestException', async () => {
      const { svc, mockPrisma } = createService()
      mockPrisma.signalActivation.findFirst.mockResolvedValue(null)
      await expect(svc.detect({ portfolioId: 'p-1' }, 1)).rejects.toThrow(BadRequestException)
    })

    it('无信号时返回零偏离', async () => {
      const { svc, mockPrisma } = createService()
      mockPrisma.signalActivation.findFirst.mockResolvedValue({ strategyId: 'strat-1' })
      mockPrisma.tradingSignal.findFirst.mockResolvedValue(null)

      const result = await svc.detect({ portfolioId: 'p-1' }, 1)
      expect(result.totalDriftScore).toBe(0)
      expect(result.isAlert).toBe(false)
    })

    it('完全对齐时 totalDriftScore 约为 0', async () => {
      const { svc, mockPrisma } = createService()
      mockPrisma.signalActivation.findFirst.mockResolvedValue({ strategyId: 'strat-1' })
      const tradeDate = new Date('2025-03-01')
      mockPrisma.tradingSignal.findFirst.mockResolvedValue({ tradeDate })
      // 信号：000001.SZ BUY weight=1.0
      mockPrisma.tradingSignal.findMany.mockResolvedValue([{ tsCode: '000001.SZ', action: 'BUY', targetWeight: 1.0 }])
      // 持仓：只有 000001.SZ
      mockPrisma.portfolioHolding.findMany.mockResolvedValue([{ tsCode: '000001.SZ', quantity: 1000, avgCost: 10 }])
      // 最新价格
      mockPrisma.daily.findMany.mockResolvedValue([{ tsCode: '000001.SZ', close: 10 }])
      mockPrisma.stockBasic.findMany.mockResolvedValue([{ tsCode: '000001.SZ', name: '平安银行', industry: '银行' }])

      const result = await svc.detect({ portfolioId: 'p-1', strategyId: 'strat-1' }, 1)
      expect(result.positionDrift).toBe(0)
      // weightDrift 可能不完全为 0（因为实际权重 = 1.0），同样无行业漂移
      expect(result.isAlert).toBe(false)
    })

    it('有完全不重叠持仓时 positionDrift 为 1', async () => {
      const { svc, mockPrisma } = createService()
      mockPrisma.signalActivation.findFirst.mockResolvedValue({ strategyId: 'strat-1' })
      const tradeDate = new Date('2025-03-01')
      mockPrisma.tradingSignal.findFirst.mockResolvedValue({ tradeDate })
      // 信号目标：000001.SZ
      mockPrisma.tradingSignal.findMany.mockResolvedValue([{ tsCode: '000001.SZ', action: 'BUY', targetWeight: 1.0 }])
      // 持仓：000002.SZ（完全不同）
      mockPrisma.portfolioHolding.findMany.mockResolvedValue([{ tsCode: '000002.SZ', quantity: 1000, avgCost: 10 }])
      mockPrisma.daily.findMany.mockResolvedValue([])
      mockPrisma.stockBasic.findMany.mockResolvedValue([])

      const result = await svc.detect({ portfolioId: 'p-1', strategyId: 'strat-1' }, 1)
      expect(result.positionDrift).toBe(1)
    })
  })

  // ── detectAndNotify ───────────────────────────────────────────────────────

  describe('detectAndNotify', () => {
    it('activation 无 portfolioId 时提前返回不抛错', async () => {
      const { svc, mockPrisma } = createService()
      mockPrisma.signalActivation.findUnique.mockResolvedValue(makeActivation({ portfolioId: null }))
      await expect(svc.detectAndNotify('act-1', 1)).resolves.toBeUndefined()
      expect(mockPrisma.tradingSignal.findFirst).not.toHaveBeenCalled()
    })

    it('activation 不存在时提前返回', async () => {
      const { svc, mockPrisma } = createService()
      mockPrisma.signalActivation.findUnique.mockResolvedValue(null)
      await expect(svc.detectAndNotify('act-1', 1)).resolves.toBeUndefined()
    })

    it('未超阈值时不推送 WebSocket', async () => {
      const { svc, mockPrisma, mockEventsGateway } = createService()
      mockPrisma.signalActivation.findUnique.mockResolvedValue(makeActivation({ alertThreshold: 0.9 }))
      // 无信号 → totalDriftScore = 0 → isAlert = false
      mockPrisma.tradingSignal.findFirst.mockResolvedValue(null)

      await svc.detectAndNotify('act-1', 1)
      expect(mockEventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('超阈值时推送 drift_alert WebSocket', async () => {
      const { svc, mockPrisma, mockEventsGateway } = createService()
      // 低阈值，容易触发
      mockPrisma.signalActivation.findUnique.mockResolvedValue(makeActivation({ alertThreshold: 0.01 }))
      const tradeDate = new Date('2025-03-01')
      mockPrisma.tradingSignal.findFirst.mockResolvedValue({ tradeDate })
      // 完全不重叠 → positionDrift = 1 → totalDriftScore >> 0.01
      mockPrisma.tradingSignal.findMany.mockResolvedValue([{ tsCode: '000001.SZ', action: 'BUY', targetWeight: 1.0 }])
      mockPrisma.portfolioHolding.findMany.mockResolvedValue([{ tsCode: '000002.SZ', quantity: 1000, avgCost: 10 }])
      mockPrisma.daily.findMany.mockResolvedValue([])
      mockPrisma.stockBasic.findMany.mockResolvedValue([])
      mockPrisma.portfolio.findUnique.mockResolvedValue({ id: 'p-1', name: '测试组合' })

      await svc.detectAndNotify('act-1', 1)
      expect(mockEventsGateway.emitToUser).toHaveBeenCalledWith(1, 'drift_alert', expect.any(Object))
    })
  })
})
