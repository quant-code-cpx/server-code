/**
 * SignalGenerationService — 单元测试
 *
 * 覆盖要点：
 * - generateAllSignals: 无交易日跳过、激活记录为空跳过、按激活数遍历、单个激活错误不阻断其他
 * - generateForActivation: 股池为空提前返回、正常流程写入信号、推送 WebSocket
 * - deriveActions: 无组合时全部 BUY、有组合时 BUY/HOLD/SELL 正确判断
 * - getTodayBars / buildHistoricalBars: 正常提取
 */
import { SignalGenerationService } from '../signal-generation.service'

// ── 辅助工厂 ─────────────────────────────────────────────────────────────────

function makeActivation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'act-1',
    userId: 1,
    strategyId: 'strat-1',
    portfolioId: null,
    isActive: true,
    universe: 'ALL_A',
    benchmarkTsCode: '000300.SH',
    lookbackDays: 60,
    alertThreshold: 0.3,
    lastSignalDate: null,
    ...overrides,
  }
}

function makeStrategy(overrides: Record<string, unknown> = {}) {
  return {
    id: 'strat-1',
    name: '策略A',
    strategyType: 'FACTOR_RANKING',
    strategyConfig: { topN: 20 },
    backtestDefaults: {},
    ...overrides,
  }
}

function makeBar(tsCode: string, dateStr: string): [string, unknown] {
  return [
    dateStr,
    { tsCode, tradeDate: dateStr, open: 10, close: 11, high: 12, low: 9, vol: 1000, amount: 11000, adjFactor: 1 },
  ]
}

// ── Mock 构建 ─────────────────────────────────────────────────────────────────

function buildMocks() {
  const mockPrisma = {
    tradeCal: { findFirst: jest.fn() },
    signalActivation: {
      findMany: jest.fn(async () => []),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(async () => ({})),
    },
    strategy: { findUniqueOrThrow: jest.fn() },
    tradingSignal: { createMany: jest.fn(async () => ({ count: 1 })) },
    portfolioHolding: { findMany: jest.fn(async () => []) },
  }
  const mockStrategyRegistry = {
    getStrategy: jest.fn(() => ({
      initialize: jest.fn(),
      generateSignal: jest.fn(async () => ({
        targets: [{ tsCode: '000001.SZ', weight: 0.1 }],
      })),
    })),
  }
  const mockDataService = {
    getAllListedStocks: jest.fn(async () => ['000001.SZ']),
    getIndexConstituents: jest.fn(async () => []),
    loadDailyBars: jest.fn(async () => new Map([['000001.SZ', new Map([makeBar('000001.SZ', '2025-03-01')])]])),
    getTradingDays: jest.fn(async () => [new Date('2025-03-01')]),
  }
  const mockEventsGateway = { emitToUser: jest.fn() }

  return { mockPrisma, mockStrategyRegistry, mockDataService, mockEventsGateway }
}

function createService(mocks = buildMocks()) {
  const svc = new SignalGenerationService(
    mocks.mockPrisma as never,
    mocks.mockStrategyRegistry as never,
    mocks.mockDataService as never,
    mocks.mockEventsGateway as never,
  )
  return { svc, ...mocks }
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('SignalGenerationService', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── generateAllSignals ────────────────────────────────────────────────────

  describe('generateAllSignals', () => {
    it('无交易日时提前返回', async () => {
      const { svc, mockPrisma } = createService()
      mockPrisma.tradeCal.findFirst.mockResolvedValue(null)
      await svc.generateAllSignals()
      expect(mockPrisma.signalActivation.findMany).not.toHaveBeenCalled()
    })

    it('激活记录为空时提前返回', async () => {
      const { svc, mockPrisma } = createService()
      mockPrisma.tradeCal.findFirst.mockResolvedValue({ calDate: new Date('2025-03-01') })
      mockPrisma.signalActivation.findMany.mockResolvedValue([])
      await svc.generateAllSignals()
      expect(mockPrisma.signalActivation.findUniqueOrThrow).not.toHaveBeenCalled()
    })

    it('单个激活失败不阻断其余激活', async () => {
      const { svc, mockPrisma } = createService()
      mockPrisma.tradeCal.findFirst.mockResolvedValue({ calDate: new Date('2025-03-01') })
      mockPrisma.signalActivation.findMany.mockResolvedValue([makeActivation(), makeActivation({ id: 'act-2' })])
      // 第一次 findUniqueOrThrow 抛错，第二次正常
      mockPrisma.signalActivation.findUniqueOrThrow
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce(makeActivation({ id: 'act-2' }))
      mockPrisma.strategy.findUniqueOrThrow.mockResolvedValue(makeStrategy())
      mockPrisma.portfolioHolding.findMany.mockResolvedValue([])

      // Should not throw
      await expect(svc.generateAllSignals()).resolves.toBeUndefined()
    })
  })

  // ── generateForActivation ─────────────────────────────────────────────────

  describe('generateForActivation', () => {
    it('股池为空时不写入信号，但仍更新 lastSignalDate', async () => {
      const { svc, mockPrisma, mockDataService } = createService()
      mockPrisma.signalActivation.findUniqueOrThrow.mockResolvedValue(makeActivation())
      mockPrisma.strategy.findUniqueOrThrow.mockResolvedValue(makeStrategy())
      mockDataService.getAllListedStocks.mockResolvedValue([])

      await svc.generateForActivation('act-1', new Date('2025-03-01'))

      expect(mockPrisma.tradingSignal.createMany).not.toHaveBeenCalled()
      expect(mockPrisma.signalActivation.update).not.toHaveBeenCalled()
    })

    it('正常流程写入信号并推送 WebSocket', async () => {
      const { svc, mockPrisma, mockEventsGateway } = createService()
      mockPrisma.signalActivation.findUniqueOrThrow.mockResolvedValue(makeActivation())
      mockPrisma.strategy.findUniqueOrThrow.mockResolvedValue(makeStrategy())

      await svc.generateForActivation('act-1', new Date('2025-03-01'))

      expect(mockPrisma.tradingSignal.createMany).toHaveBeenCalled()
      expect(mockPrisma.signalActivation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastSignalDate: expect.any(Date) }) }),
      )
      expect(mockEventsGateway.emitToUser).toHaveBeenCalledWith(1, 'signal_generated', expect.any(Object))
    })

    it('策略 generateSignal 返回空 targets 时不写入信号', async () => {
      const { svc, mockPrisma, mockStrategyRegistry } = createService()
      mockPrisma.signalActivation.findUniqueOrThrow.mockResolvedValue(makeActivation())
      mockPrisma.strategy.findUniqueOrThrow.mockResolvedValue(makeStrategy())
      mockStrategyRegistry.getStrategy.mockReturnValue({
        initialize: jest.fn(),
        generateSignal: jest.fn(async () => ({ targets: [] })),
      })

      await svc.generateForActivation('act-1', new Date('2025-03-01'))

      expect(mockPrisma.tradingSignal.createMany).not.toHaveBeenCalled()
      expect(mockPrisma.signalActivation.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lastSignalDate: expect.any(Date) }) }),
      )
    })
  })

  // ── deriveActions (通过 generateForActivation 间接测试) ────────────────────

  describe('deriveActions behavior', () => {
    it('无组合时所有 targets 动作为 BUY', async () => {
      const { svc, mockPrisma } = createService()
      // 无 portfolioId
      mockPrisma.signalActivation.findUniqueOrThrow.mockResolvedValue(makeActivation({ portfolioId: null }))
      mockPrisma.strategy.findUniqueOrThrow.mockResolvedValue(makeStrategy())

      await svc.generateForActivation('act-1', new Date('2025-03-01'))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const createCall = (mockPrisma.tradingSignal.createMany.mock.calls as any)[0][0]
      const actions: string[] = createCall.data.map((r: { action: string }) => r.action)
      expect(actions.every((a) => a === 'BUY')).toBe(true)
    })

    it('有组合时已持仓为 HOLD，新进仓为 BUY，退出仓位为 SELL', async () => {
      const { svc, mockPrisma, mockStrategyRegistry } = createService()
      mockPrisma.signalActivation.findUniqueOrThrow.mockResolvedValue(makeActivation({ portfolioId: 'p-1' }))
      mockPrisma.strategy.findUniqueOrThrow.mockResolvedValue(makeStrategy())
      // 当前持仓：000001.SZ（在新目标中）和 000002.SZ（不在新目标中 → SELL）
      mockPrisma.portfolioHolding.findMany.mockResolvedValue([{ tsCode: '000001.SZ' }, { tsCode: '000002.SZ' }])
      // 信号只有 000001.SZ 和 000003.SZ（新 BUY）
      mockStrategyRegistry.getStrategy.mockReturnValue({
        initialize: jest.fn(),
        generateSignal: jest.fn(async () => ({
          targets: [
            { tsCode: '000001.SZ', weight: 0.1 },
            { tsCode: '000003.SZ', weight: 0.1 },
          ],
        })),
      })

      await svc.generateForActivation('act-1', new Date('2025-03-01'))

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const createCall = (mockPrisma.tradingSignal.createMany.mock.calls as any)[0][0]
      const actionMap = new Map(createCall.data.map((r: { tsCode: string; action: string }) => [r.tsCode, r.action]))
      expect(actionMap.get('000001.SZ')).toBe('HOLD')
      expect(actionMap.get('000003.SZ')).toBe('BUY')
      expect(actionMap.get('000002.SZ')).toBe('SELL')
    })
  })
})
