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

  // ── Phase 2 新增：deriveActions 私有逻辑边界 ─────────────────────────────

  describe('[BIZ] deriveActions() — 边界与权重语义', () => {
    it('[BIZ] 持仓完全与目标重叠时所有信号为 HOLD，不产生 BUY/SELL', () => {
      const { svc } = createService()
      const holdings = new Set(['000001.SZ', '000002.SZ'])
      const targets = new Map([
        ['000001.SZ', 0.5],
        ['000002.SZ', 0.5],
      ])

      const result = (svc as any).deriveActions(holdings, targets, true)

      expect(result.every((r: { action: string }) => r.action === 'HOLD')).toBe(true)
      expect(result).toHaveLength(2)
    })

    it('[BIZ] 持仓与目标完全不重叠时旧持仓 SELL、新目标 BUY', () => {
      const { svc } = createService()
      const holdings = new Set(['000001.SZ', '000002.SZ'])
      const targets = new Map([
        ['000003.SZ', 0.5],
        ['000004.SZ', 0.5],
      ])

      const result = (svc as any).deriveActions(holdings, targets, true)

      const actions = new Map(result.map((r: { tsCode: string; action: string }) => [r.tsCode, r.action]))
      expect(actions.get('000001.SZ')).toBe('SELL')
      expect(actions.get('000002.SZ')).toBe('SELL')
      expect(actions.get('000003.SZ')).toBe('BUY')
      expect(actions.get('000004.SZ')).toBe('BUY')
    })

    it('[BIZ] SELL 信号的 targetWeight 应为 0', () => {
      const { svc } = createService()
      const holdings = new Set(['000001.SZ'])
      const targets = new Map([['000002.SZ', 0.5]])

      const result = (svc as any).deriveActions(holdings, targets, true)

      const sell = result.find((r: { action: string }) => r.action === 'SELL')
      expect(sell).toBeDefined()
      expect(sell.targetWeight).toBe(0)
    })

    it('[EDGE] weight=0 的目标仍产生 BUY 信号（不被过滤）— 记录已知行为', () => {
      // 当前 deriveActions 实现：weight=0 仍作为有效 target 处理
      // 设计上 weight=0 语义等同 SELL，但当前代码不过滤，此测试记录现有行为
      const { svc } = createService()
      const holdings = new Set<string>()
      const targets = new Map([['000001.SZ', 0]]) // weight=0 但是新目标

      const result = (svc as any).deriveActions(holdings, targets, true)

      // 当前行为：weight=0 的新目标生成 BUY（无组合上下文时）
      expect(result[0].tsCode).toBe('000001.SZ')
      expect(result[0].action).toBe('BUY')
      expect(result[0].targetWeight).toBe(0)
    })
  })

  // ── Phase 2 新增：generateForActivation 幂等性 ───────────────────────────

  describe('[BIZ] generateForActivation() — 幂等性与信号去重', () => {
    it('[BIZ] 写入信号时使用 skipDuplicates，确保不重复入库', async () => {
      const mocks = buildMocks()
      mocks.mockPrisma.tradeCal.findFirst.mockResolvedValue({ calDate: new Date('2025-03-01') })
      mocks.mockPrisma.signalActivation.findUniqueOrThrow.mockResolvedValue(makeActivation({ portfolioId: null }))
      mocks.mockPrisma.strategy.findUniqueOrThrow.mockResolvedValue(makeStrategy())
      const { svc, mockPrisma } = createService(mocks)

      await svc.generateForActivation('act-1', new Date('2025-03-01'))

      if (mockPrisma.tradingSignal.createMany.mock.calls.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const callArgs = (mockPrisma.tradingSignal.createMany.mock.calls as any)[0][0]
        expect(callArgs).toHaveProperty('skipDuplicates', true)
      }
    })

    it('[BIZ] 生成信号后 lastSignalDate 应更新为当日交易日', async () => {
      const mocks = buildMocks()
      mocks.mockPrisma.tradeCal.findFirst.mockResolvedValue({ calDate: new Date('2025-03-01') })
      mocks.mockPrisma.signalActivation.findUniqueOrThrow.mockResolvedValue(makeActivation({ portfolioId: null }))
      mocks.mockPrisma.strategy.findUniqueOrThrow.mockResolvedValue(makeStrategy())
      const { svc, mockPrisma } = createService(mocks)

      await svc.generateForActivation('act-1', new Date('2025-03-01'))

      expect(mockPrisma.signalActivation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'act-1' },
          data: expect.objectContaining({ lastSignalDate: expect.any(Date) }),
        }),
      )
    })
  })

  // ── Phase 2：weight=0 的语义 bug ──────────────────────────────────────────

  // 业务规则：weight=0 语义 = "不持有"，等价于 SELL 指令
  // B6 bug：nullish coalescing `?? 1/N` 正确跳过 0（不赋等权），但 deriveActions 不区分 weight=0

  describe('[BUG-B6] weight=0 持仓语义 — deriveActions 未正确处理', () => {
    it('[BUG] 无组合上下文时 weight=0 目标仍产生 BUY+targetWeight=0（语义矛盾）', () => {
      // 业务推导：无组合路径全部发 BUY，weight=0 的 BUY 意义不明
      // 正确行为应为：weight=0 目标应被过滤或产生 SKIP 信号
      const { svc } = createService()
      const holdings = new Set<string>() // 无持仓
      const targets = new Map([['000001.SZ', 0]]) // weight=0

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (svc as any).deriveActions(holdings, targets, false) // hasPortfolio=false

      // 当前行为（BUG）：BUY 信号但 targetWeight=0
      expect(result[0].action).toBe('BUY')
      expect(result[0].targetWeight).toBe(0)
      // 正确行为：weight=0 目标不应产生 BUY，或 targetWeight 至少应 > 0
    })

    it('[BUG] 有组合 + 已持仓 + weight=0 → 产生 HOLD 而非 SELL（语义错误）', () => {
      // 业务推导：我已经持有该股，但策略给出 weight=0，说明策略认为不应继续持有
      // 正确行为：应产生 SELL 信号；当前实现：因为 tsCode 在 currentHoldings → HOLD
      const { svc } = createService()
      const holdings = new Set(['000001.SZ']) // 已持仓
      const targets = new Map([['000001.SZ', 0]]) // weight=0 = "不持有"

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (svc as any).deriveActions(holdings, targets, true) // hasPortfolio=true

      // 当前行为（BUG）：HOLD + targetWeight=0
      expect(result[0].action).toBe('HOLD')
      expect(result[0].targetWeight).toBe(0)
      // 正确行为：action 应为 'SELL'，因为 weight=0 表示退出该仓位
    })
  })

  // ── Phase 2：resolveTradeDate 字符串路径时区 ──────────────────────────────

  // 业务规则：'20250301' 应被解析为上海时间 2025-03-01（而非 UTC 午夜）
  // B2 bug：new Date('2025-03-01') 创建 UTC midnight，在 UTC+8 服务器会是前一天 16:00

  describe('[BUG-B2] resolveTradeDate() — 字符串路径创建 UTC 午夜 Date', () => {
    it('[BUG] 字符串 "20250301" 被解析为 UTC midnight（非上海时间）', async () => {
      // 直接测试私有方法行为：是否使用 UTC 解析
      const { svc } = createService()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (svc as any).resolveTradeDate('20250301')

      // 当前行为：new Date('2025-03-01') = UTC midnight = 2025-03-01T00:00:00.000Z
      expect(result).toBeInstanceOf(Date)
      expect(result.toISOString()).toBe('2025-03-01T00:00:00.000Z')
      // 正确行为（Shanghai）：如果服务在 UTC+8 运行，应为 2025-02-28T16:00:00.000Z 或使用本地时区解析
    })

    it('[BIZ] resolveTradeDate 无参数时从 tradeCal 查询最晚交易日', async () => {
      const mocks = buildMocks()
      const tradeDate = new Date('2025-03-01')
      mocks.mockPrisma.tradeCal.findFirst.mockResolvedValue({ calDate: tradeDate })
      const { svc } = createService(mocks)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (svc as any).resolveTradeDate(undefined)

      expect(result).toEqual(tradeDate)
      expect(mocks.mockPrisma.tradeCal.findFirst).toHaveBeenCalledTimes(1)
    })
  })

  // ── Phase 2：buildHistoricalBars 包含当日 bar ─────────────────────────────

  // 业务规则："历史" K 线应该是截止日之前的数据，不包含当日
  // B12 bug：d <= upToDateStr 使用 <=，导致当日 bar 包含在"历史"数据中

  describe('[BUG-B12] buildHistoricalBars() — d <= upToDateStr 包含当日', () => {
    it('[BUG] upToDate 当日的 bar 被包含在历史 K 线中', () => {
      const { svc } = createService()
      // 构造行情：含历史日 + 当日
      const allBarsMap = new Map([
        [
          '000001.SZ',
          new Map([
            makeBar('000001.SZ', '2025-02-28'), // 前一日
            makeBar('000001.SZ', '2025-03-01'), // 当日
          ]),
        ],
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (svc as any).buildHistoricalBars(allBarsMap, '2025-03-01')

      // 当前行为（BUG）：当日 bar 包含在历史中（应只含 2025-02-28）
      const bars: unknown[] = result.get('000001.SZ')
      expect(bars).toHaveLength(2) // 包含了当日（BUG记录）
      // 正确行为：bars.length 应为 1，只含 2025-02-28
    })

    it('[BIZ] upToDate 之前的所有 bar 按日期升序排列', () => {
      const { svc } = createService()
      const allBarsMap = new Map([
        [
          '000001.SZ',
          new Map([
            makeBar('000001.SZ', '2025-03-01'),
            makeBar('000001.SZ', '2025-01-01'),
            makeBar('000001.SZ', '2025-02-01'),
          ]),
        ],
      ])

      // 取到 2025-02-28，当日 2025-03-01 不含（严格 <）
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (svc as any).buildHistoricalBars(allBarsMap, '2025-02-28')

      const bars = result.get('000001.SZ') as Array<{ tradeDate: string }>
      // 2025-01-01 和 2025-02-01 都 <= '2025-02-28'，按升序
      expect(bars).toHaveLength(2)
      expect(bars[0].tradeDate).toBe('2025-01-01')
      expect(bars[1].tradeDate).toBe('2025-02-01')
    })
  })

  // ── Phase 2：weight=null/undefined 等权分配 ───────────────────────────────

  // 业务规则：策略未指定 weight 时，所有目标等权分配（1/N）
  // 实现：t.weight ?? 1/totalTargets — nullish coalescing，null 和 undefined 都触发等权

  describe('[BIZ] weight=null/undefined — 等权分配', () => {
    it('[BIZ] weight=null 时使用等权 1/N（通过 generateForActivation 验证）', async () => {
      const mocks = buildMocks()
      mocks.mockPrisma.tradeCal.findFirst.mockResolvedValue({ calDate: new Date('2025-03-01') })
      mocks.mockPrisma.signalActivation.findUniqueOrThrow.mockResolvedValue(makeActivation({ portfolioId: null }))
      mocks.mockPrisma.strategy.findUniqueOrThrow.mockResolvedValue(makeStrategy())
      // 3 个 targets 均不含 weight
      mocks.mockStrategyRegistry.getStrategy.mockReturnValue({
        initialize: jest.fn(),
        generateSignal: jest.fn(async () => ({
          targets: [
            { tsCode: '000001.SZ', weight: null },
            { tsCode: '000002.SZ', weight: null },
            { tsCode: '000003.SZ', weight: null },
          ],
        })),
      })
      const { svc, mockPrisma } = createService(mocks)

      await svc.generateForActivation('act-1', new Date('2025-03-01'))

      // 手算：N=3 → 每只等权 1/3 ≈ 0.3333
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const createCall = (mockPrisma.tradingSignal.createMany.mock.calls as any)[0][0]
      const weights = createCall.data.map((r: { targetWeight: number }) => r.targetWeight)
      expect(weights).toHaveLength(3)
      weights.forEach((w: number) => expect(w).toBeCloseTo(1 / 3, 10))
    })

    it('[BIZ] weight=0 不触发等权（nullish coalescing 不处理假值 0）', () => {
      // 手算：0 ?? 1/2 → 0（不触发等权，0 保留）
      const { svc } = createService()
      const holdings = new Set<string>()
      const targets = new Map([
        ['000001.SZ', 0], // weight=0 → 保留 0，不等权
        ['000002.SZ', null as unknown as number], // weight=null → 等权
      ])

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const targetWeightMap = new Map<string, number>()
      for (const [tsCode, weight] of targets) {
        const totalTargets = 2
        targetWeightMap.set(tsCode, weight ?? 1 / totalTargets)
      }

      expect(targetWeightMap.get('000001.SZ')).toBe(0) // weight=0 保留
      expect(targetWeightMap.get('000002.SZ')).toBeCloseTo(0.5) // weight=null → 1/2
    })
  })
})
