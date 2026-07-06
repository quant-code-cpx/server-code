/**
 * BacktestEngineService — 单元测试
 *
 * 覆盖重点：私有辅助方法（通过 (service as any).method() 访问）
 * - checkRebalanceDay
 * - getTodayBars
 * - buildHistoricalBars
 * - computePositionValueWithAdjFactor
 * - adjustCostPriceForSplits
 * - buildPositionSnapshots
 */
import { BacktestEngineService } from '../services/backtest-engine.service'
import { BacktestConfig, DailyBar, PortfolioState, RebalanceFrequency } from '../types/backtest-engine.types'

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function buildBar(partial: Partial<DailyBar> = {}): DailyBar {
  return {
    tsCode: '000001.SZ',
    tradeDate: new Date('2025-01-02'),
    open: 10,
    high: 11,
    low: 9,
    close: 10,
    preClose: 10,
    vol: 100000,
    adjFactor: 1.0,
    upLimit: null,
    downLimit: null,
    isSuspended: false,
    adjClose: 10,
    adjOpen: 10,
    adjHigh: 11,
    adjLow: 9,
    ...partial,
  }
}

function buildPortfolio(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    cash: 1_000_000,
    positions: new Map(),
    nav: 1_000_000,
    ...overrides,
  }
}

// ── 构造服务（全部依赖 mock 为空对象） ────────────────────────────────────────

function createService(overrides: Record<string, unknown> = {}): BacktestEngineService {
  const prisma = overrides.prisma ?? {}
  const dataService = overrides.dataService ?? {}
  const executionService = overrides.executionService ?? {}
  const metricsService = overrides.metricsService ?? {}
  const strategyRegistry = overrides.strategyRegistry ?? {}
  // @ts-ignore 局部 mock，跳过 DI
  return new BacktestEngineService(prisma, dataService, executionService, metricsService, strategyRegistry)
}

function buildConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    runId: 'run-1',
    strategyType: 'CUSTOM_POOL_REBALANCE',
    strategyConfig: { tsCodes: ['000001.SZ'], weightMode: 'EQUAL' },
    startDate: new Date('2025-01-01'),
    endDate: new Date('2025-01-03'),
    benchmarkTsCode: '000300.SH',
    universe: 'CUSTOM',
    customUniverseTsCodes: ['000001.SZ'],
    initialCapital: 100_000,
    rebalanceFrequency: 'DAILY',
    priceMode: 'NEXT_OPEN',
    commissionRate: 0,
    stampDutyRate: 0,
    minCommission: 0,
    slippageBps: 0,
    maxPositions: 10,
    maxWeightPerStock: 1,
    minDaysListed: 60,
    enableTradeConstraints: true,
    enableT1Restriction: true,
    partialFillEnabled: true,
    ...overrides,
  }
}

function buildMetrics(overrides: Record<string, number> = {}) {
  return {
    totalReturn: 0,
    annualizedReturn: 0,
    benchmarkReturn: 0,
    excessReturn: 0,
    maxDrawdown: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    calmarRatio: 0,
    volatility: 0,
    alpha: 0,
    beta: 0,
    informationRatio: 0,
    winRate: 0,
    turnoverRate: 0,
    tradeCount: 0,
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════════════════

describe('BacktestEngineService', () => {
  let service: BacktestEngineService

  beforeEach(() => {
    jest.clearAllMocks()
    service = createService()
  })

  // ── checkRebalanceDay ──────────────────────────────────────────────────────

  describe('checkRebalanceDay()', () => {
    const dates = (strs: string[]) => strs.map((s) => new Date(s))

    it('DAILY: 每天都返回 true', () => {
      const tradingDays = dates(['2025-01-02', '2025-01-03', '2025-01-06'])
      for (let i = 0; i < tradingDays.length; i++) {
        expect((service as any).checkRebalanceDay(tradingDays[i], tradingDays, i, 'DAILY')).toBe(true)
      }
    })

    describe('WEEKLY', () => {
      it('第一个交易日（idx=0）返回 true', () => {
        const tradingDays = dates(['2025-01-02', '2025-01-03'])
        expect((service as any).checkRebalanceDay(tradingDays[0], tradingDays, 0, 'WEEKLY')).toBe(true)
      })

      it('同一周内第二天返回 false', () => {
        // 2025-01-02 (Thu) -> 2025-01-03 (Fri), 同一周
        const tradingDays = dates(['2025-01-02', '2025-01-03'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'WEEKLY')).toBe(false)
      })

      it('跨周（下周一）返回 true', () => {
        // 2025-01-03 (Fri) -> 2025-01-06 (Mon)
        const tradingDays = dates(['2025-01-03', '2025-01-06'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'WEEKLY')).toBe(true)
      })

      it('同一 ISO 周内的周六→周日返回 false（A 股不开盘的极端场景）', () => {
        // 2025-01-04 (Sat) 和 2025-01-05 (Sun) 同属 ISO week 1 of 2025
        // A 股周末不开盘，此为极端测试场景
        const tradingDays = dates(['2025-01-04', '2025-01-05'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'WEEKLY')).toBe(false)
      })

      it('跨年但同一 ISO 周（周二→周四）→ 正确返回 false（同一交易周）', () => {
        // 2024-12-31 (Tue) ISO week 1 of 2025 → 2025-01-02 (Thu) ISO week 1 of 2025
        // 同属一个 ISO 周，不需要调仓
        const tradingDays = dates(['2024-12-31', '2025-01-02'])
        const result = (service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'WEEKLY')
        expect(result).toBe(false)
      })

      it('跨周且前后都是周三（跳过中间一周）→ 正确返回 true', () => {
        // 2025-01-08 (Wed) ISO week 2 → 2025-01-15 (Wed) ISO week 3
        // 不同 ISO 周，应触发调仓
        const tradingDays = dates(['2025-01-08', '2025-01-15'])
        const result = (service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'WEEKLY')
        expect(result).toBe(true)
      })

      it('正常跨周（Fri→Mon）返回 true', () => {
        // 2025-01-10 (Fri, ISO week 2) -> 2025-01-13 (Mon, ISO week 3)
        const tradingDays = dates(['2025-01-10', '2025-01-13'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'WEEKLY')).toBe(true)
      })

      it('跨年且跨周（Fri→Mon）→ 返回 true', () => {
        // 2024-12-27 (Fri, ISO week 52 of 2024) → 2024-12-30 (Mon, ISO week 1 of 2025)
        const tradingDays = dates(['2024-12-27', '2024-12-30'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'WEEKLY')).toBe(true)
      })
    })

    describe('MONTHLY', () => {
      it('第一个交易日（idx=0）返回 true', () => {
        const tradingDays = dates(['2025-01-02'])
        expect((service as any).checkRebalanceDay(tradingDays[0], tradingDays, 0, 'MONTHLY')).toBe(true)
      })

      it('同月内第二天返回 false', () => {
        const tradingDays = dates(['2025-01-02', '2025-01-03'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'MONTHLY')).toBe(false)
      })

      it('跨月时返回 true', () => {
        const tradingDays = dates(['2025-01-31', '2025-02-03'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'MONTHLY')).toBe(true)
      })
    })

    describe('QUARTERLY', () => {
      it('第一个交易日（idx=0）返回 true', () => {
        const tradingDays = dates(['2025-01-02'])
        expect((service as any).checkRebalanceDay(tradingDays[0], tradingDays, 0, 'QUARTERLY')).toBe(true)
      })

      it('同月内第二天返回 false', () => {
        const tradingDays = dates(['2025-01-02', '2025-01-03'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'QUARTERLY')).toBe(false)
      })

      it('跨入季度首月（1月=0）返回 true', () => {
        const tradingDays = dates(['2024-12-31', '2025-01-02'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'QUARTERLY')).toBe(true)
      })

      it('跨入季度首月（4月=3）返回 true', () => {
        const tradingDays = dates(['2025-03-31', '2025-04-01'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'QUARTERLY')).toBe(true)
      })

      it('跨入季度首月（7月=6）返回 true', () => {
        const tradingDays = dates(['2025-06-30', '2025-07-01'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'QUARTERLY')).toBe(true)
      })

      it('跨入季度首月（10月=9）返回 true', () => {
        const tradingDays = dates(['2025-09-30', '2025-10-08'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'QUARTERLY')).toBe(true)
      })

      it('跨月但非季首（2月）返回 false', () => {
        const tradingDays = dates(['2025-01-31', '2025-02-03'])
        expect((service as any).checkRebalanceDay(tradingDays[1], tradingDays, 1, 'QUARTERLY')).toBe(false)
      })
    })
  })

  // ── getTodayBars ───────────────────────────────────────────────────────────

  describe('getTodayBars()', () => {
    it('多只股票时返回指定日期的 bar', () => {
      const allBarsMap = new Map<string, Map<string, DailyBar>>()

      const bars1 = new Map<string, DailyBar>()
      bars1.set('2025-01-02', buildBar({ tsCode: '000001.SZ', close: 10 }))
      bars1.set('2025-01-03', buildBar({ tsCode: '000001.SZ', close: 11 }))

      const bars2 = new Map<string, DailyBar>()
      bars2.set('2025-01-02', buildBar({ tsCode: '000002.SZ', close: 20 }))

      allBarsMap.set('000001.SZ', bars1)
      allBarsMap.set('000002.SZ', bars2)

      const result: Map<string, DailyBar> = (service as any).getTodayBars(allBarsMap, '2025-01-02')

      expect(result.size).toBe(2)
      expect(result.get('000001.SZ')!.close).toBe(10)
      expect(result.get('000002.SZ')!.close).toBe(20)
    })

    it('当日无 bar 时返回空 Map', () => {
      const allBarsMap = new Map<string, Map<string, DailyBar>>()
      const bars1 = new Map<string, DailyBar>()
      bars1.set('2025-01-02', buildBar({ tsCode: '000001.SZ' }))
      allBarsMap.set('000001.SZ', bars1)

      const result: Map<string, DailyBar> = (service as any).getTodayBars(allBarsMap, '2025-01-09')
      expect(result.size).toBe(0)
    })

    it('allBarsMap 为空时返回空 Map', () => {
      const result: Map<string, DailyBar> = (service as any).getTodayBars(new Map(), '2025-01-02')
      expect(result.size).toBe(0)
    })
  })

  // ── buildHistoricalBars ────────────────────────────────────────────────────

  describe('buildHistoricalBars()', () => {
    it('返回不超过指定日期的 bar，并按日期升序排序', () => {
      const allBarsMap = new Map<string, Map<string, DailyBar>>()
      const barMap = new Map<string, DailyBar>()
      barMap.set('2025-01-01', buildBar({ tsCode: '000001.SZ', close: 9 }))
      barMap.set('2025-01-02', buildBar({ tsCode: '000001.SZ', close: 10 }))
      barMap.set('2025-01-03', buildBar({ tsCode: '000001.SZ', close: 11 }))
      allBarsMap.set('000001.SZ', barMap)

      const result: Map<string, DailyBar[]> = (service as any).buildHistoricalBars(allBarsMap, '2025-01-02')

      expect(result.has('000001.SZ')).toBe(true)
      const bars = result.get('000001.SZ')!
      expect(bars).toHaveLength(2)
      expect(bars[0].close).toBe(9)
      expect(bars[1].close).toBe(10)
    })

    it('排除晚于指定日期的 bar', () => {
      const allBarsMap = new Map<string, Map<string, DailyBar>>()
      const barMap = new Map<string, DailyBar>()
      barMap.set('2025-01-04', buildBar({ tsCode: '000001.SZ', close: 12 }))
      allBarsMap.set('000001.SZ', barMap)

      const result: Map<string, DailyBar[]> = (service as any).buildHistoricalBars(allBarsMap, '2025-01-02')
      expect(result.has('000001.SZ')).toBe(false)
    })

    it('包含日期本身的 bar', () => {
      const allBarsMap = new Map<string, Map<string, DailyBar>>()
      const barMap = new Map<string, DailyBar>()
      barMap.set('2025-01-02', buildBar({ tsCode: '000001.SZ', close: 10 }))
      allBarsMap.set('000001.SZ', barMap)

      const result: Map<string, DailyBar[]> = (service as any).buildHistoricalBars(allBarsMap, '2025-01-02')
      expect(result.get('000001.SZ')).toHaveLength(1)
    })
  })

  // ── computePositionValueWithAdjFactor ──────────────────────────────────────

  describe('computePositionValueWithAdjFactor()', () => {
    it('正确累加多个持仓的市值', () => {
      const portfolio = buildPortfolio({
        positions: new Map([
          ['000001.SZ', { tsCode: '000001.SZ', quantity: 100, costPrice: 8, entryDate: new Date() }],
          ['000002.SZ', { tsCode: '000002.SZ', quantity: 200, costPrice: 15, entryDate: new Date() }],
        ]),
      })

      const todayBars = new Map<string, DailyBar>([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', close: 10 })],
        ['000002.SZ', buildBar({ tsCode: '000002.SZ', close: 20 })],
      ])

      const value: number = (service as any).computePositionValueWithAdjFactor(portfolio, todayBars)
      expect(value).toBe(100 * 10 + 200 * 20) // 1000 + 4000 = 5000
    })

    it('bar 缺失时使用 costPrice 兜底', () => {
      const portfolio = buildPortfolio({
        positions: new Map([['000001.SZ', { tsCode: '000001.SZ', quantity: 100, costPrice: 8, entryDate: new Date() }]]),
      })

      const value: number = (service as any).computePositionValueWithAdjFactor(portfolio, new Map())
      expect(value).toBe(100 * 8)
    })

    it('无持仓时返回 0', () => {
      const portfolio = buildPortfolio({ positions: new Map() })
      const value: number = (service as any).computePositionValueWithAdjFactor(portfolio, new Map())
      expect(value).toBe(0)
    })
  })

  // ── adjustCostPriceForSplits ───────────────────────────────────────────────

  describe('adjustCostPriceForSplits()', () => {
    it('adjFactor 变化时调整 costPrice 和 quantity', () => {
      const pos = { tsCode: '000001.SZ', quantity: 1000, costPrice: 10, entryDate: new Date() }
      const portfolio = buildPortfolio({ positions: new Map([['000001.SZ', pos]]) })

      const todayBars = new Map<string, DailyBar>([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 2.0 })],
      ])
      const yesterdayBars = new Map<string, DailyBar>([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 1.0 })],
      ])

      ;(service as any).adjustCostPriceForSplits(portfolio, todayBars, yesterdayBars)

      // ratio = 2.0 / 1.0 = 2，costPrice /= 2，quantity *= 2
      expect(pos.costPrice).toBeCloseTo(5, 5)
      expect(pos.quantity).toBe(2000)
    })

    it('adjFactor 相同时不调整', () => {
      const pos = { tsCode: '000001.SZ', quantity: 1000, costPrice: 10, entryDate: new Date() }
      const portfolio = buildPortfolio({ positions: new Map([['000001.SZ', pos]]) })

      const todayBars = new Map<string, DailyBar>([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 1.0 })],
      ])
      const yesterdayBars = new Map<string, DailyBar>([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 1.0 })],
      ])

      ;(service as any).adjustCostPriceForSplits(portfolio, todayBars, yesterdayBars)

      expect(pos.costPrice).toBe(10)
      expect(pos.quantity).toBe(1000)
    })

    it('adjFactor 为 null 时不调整', () => {
      const pos = { tsCode: '000001.SZ', quantity: 500, costPrice: 12, entryDate: new Date() }
      const portfolio = buildPortfolio({ positions: new Map([['000001.SZ', pos]]) })

      const todayBars = new Map<string, DailyBar>([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: null })],
      ])
      const yesterdayBars = new Map<string, DailyBar>([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 1.0 })],
      ])

      ;(service as any).adjustCostPriceForSplits(portfolio, todayBars, yesterdayBars)

      expect(pos.costPrice).toBe(12)
      expect(pos.quantity).toBe(500)
    })
  })

  // ── buildPositionSnapshots ─────────────────────────────────────────────────

  describe('buildPositionSnapshots()', () => {
    it('返回每个持仓的快照，包含 weight、unrealizedPnl、holdingDays', () => {
      const entryDate = new Date('2025-01-01')
      const today = new Date('2025-01-11') // 10天后
      const pos = { tsCode: '000001.SZ', quantity: 100, costPrice: 8, entryDate }
      const portfolio = buildPortfolio({
        cash: 900_000,
        positions: new Map([['000001.SZ', pos]]),
      })

      const todayBars = new Map<string, DailyBar>([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', close: 10 })],
      ])

      const snapshots = (service as any).buildPositionSnapshots(portfolio, todayBars, today)

      expect(snapshots).toHaveLength(1)
      const snap = snapshots[0]
      expect(snap.tsCode).toBe('000001.SZ')
      expect(snap.quantity).toBe(100)
      expect(snap.costPrice).toBe(8)
      expect(snap.closePrice).toBe(10)
      expect(snap.marketValue).toBe(1000) // 100 * 10
      expect(snap.unrealizedPnl).toBeCloseTo(200, 5) // 100 * (10 - 8)
      expect(snap.holdingDays).toBe(10)
      // totalValue = 900000 + 1000 = 901000; weight = 1000/901000
      expect(snap.weight).toBeCloseTo(1000 / 901000, 8)
    })

    it('bar 缺失时 closePrice/marketValue/unrealizedPnl 均为 null', () => {
      const pos = { tsCode: '000001.SZ', quantity: 100, costPrice: 8, entryDate: new Date('2025-01-01') }
      const portfolio = buildPortfolio({
        cash: 1_000_000,
        positions: new Map([['000001.SZ', pos]]),
      })

      const snapshots = (service as any).buildPositionSnapshots(portfolio, new Map(), new Date('2025-01-11'))

      expect(snapshots[0].closePrice).toBeNull()
      expect(snapshots[0].marketValue).toBeNull()
      expect(snapshots[0].unrealizedPnl).toBeNull()
    })

    it('空持仓时返回空数组', () => {
      const portfolio = buildPortfolio({ positions: new Map() })
      const snapshots = (service as any).buildPositionSnapshots(portfolio, new Map(), new Date())
      expect(snapshots).toHaveLength(0)
    })
  })

  // ── adjustCostPriceForSplits: 精度与累积 ──────────────────────────────────

  describe('[EDGE] adjustCostPriceForSplits() 精度与边界', () => {
    it('[EDGE] 多次连续送转（10送10 三次）累积不产生错误', () => {
      const pos = { tsCode: '000001.SZ', quantity: 1000, costPrice: 10, entryDate: new Date() }
      const portfolio = buildPortfolio({ positions: new Map([['000001.SZ', pos]]) })

      // 第一次 10送10: ratio=2
      ;(service as any).adjustCostPriceForSplits(
        portfolio,
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 2.0 })]]),
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 1.0 })]]),
      )
      expect(pos.quantity).toBe(2000)
      expect(pos.costPrice).toBeCloseTo(5, 5)

      // 第二次 10送10: ratio=2（相对于上次的 adjFactor）
      ;(service as any).adjustCostPriceForSplits(
        portfolio,
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 4.0 })]]),
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 2.0 })]]),
      )
      expect(pos.quantity).toBe(4000)
      expect(pos.costPrice).toBeCloseTo(2.5, 5)
    })

    it('[EDGE] quantity=1, ratio=0.5（缩股）→ 保留 0.5 股，避免市值被 round 放大', () => {
      const pos = { tsCode: '000001.SZ', quantity: 1, costPrice: 10, entryDate: new Date() }
      const portfolio = buildPortfolio({ positions: new Map([['000001.SZ', pos]]) })

      ;(service as any).adjustCostPriceForSplits(
        portfolio,
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 0.5 })]]),
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 1.0 })]]),
      )
      // ratio = 0.5/1.0 = 0.5; quantity = 0.5; costPrice = 10 / 0.5 = 20; market value remains 10
      expect(pos.quantity).toBeCloseTo(0.5, 8)
      expect(pos.costPrice).toBeCloseTo(20, 5)
    })

    it('[EDGE] 小数比例多次复权不因每日 round 产生累计误差', () => {
      const pos = { tsCode: '000001.SZ', quantity: 101, costPrice: 10, entryDate: new Date() }
      const portfolio = buildPortfolio({ positions: new Map([['000001.SZ', pos]]) })

      ;(service as any).adjustCostPriceForSplits(
        portfolio,
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 1.1 })]]),
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 1.0 })]]),
      )
      ;(service as any).adjustCostPriceForSplits(
        portfolio,
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 1.21 })]]),
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 1.1 })]]),
      )

      expect(pos.quantity).toBeCloseTo(101 * 1.21, 8)
      expect(pos.costPrice).toBeCloseTo(10 / 1.21, 8)
      expect(pos.quantity * pos.costPrice).toBeCloseTo(1010, 8)
    })

    it('[EDGE] adjFactor 从 0 → 正值时不调整（避免除零）', () => {
      const pos = { tsCode: '000001.SZ', quantity: 100, costPrice: 10, entryDate: new Date() }
      const portfolio = buildPortfolio({ positions: new Map([['000001.SZ', pos]]) })

      ;(service as any).adjustCostPriceForSplits(
        portfolio,
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 1.0 })]]),
        new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', adjFactor: 0 })]]),
      )
      // yesterdayBar.adjFactor === 0，不应调整
      expect(pos.quantity).toBe(100)
      expect(pos.costPrice).toBe(10)
    })
  })

  // ── computePositionValueWithAdjFactor: 使用成本价兜底 ─────────────────────

  describe('[EDGE] computePositionValueWithAdjFactor() 兜底价格', () => {
    it('[EDGE] close=0 时使用真实价格 0（不回退到 costPrice）', () => {
      const portfolio = buildPortfolio({
        positions: new Map([['000001.SZ', { tsCode: '000001.SZ', quantity: 100, costPrice: 8, entryDate: new Date() }]]),
      })
      const todayBars = new Map<string, DailyBar>([['000001.SZ', buildBar({ tsCode: '000001.SZ', close: 0 })]])

      const value: number = (service as any).computePositionValueWithAdjFactor(portfolio, todayBars)
      // close=0 时 price !== null，使用 close 价格计算市值
      expect(value).toBe(0)
    })
  })

  // ── runBacktest: 真实主循环场景 ─────────────────────────────────────────

  describe('runBacktest()', () => {
    it('[BIZ] T+1 执行：今日 signal 不在当日成交，下一交易日才执行', async () => {
      const tradingDays = [new Date('2025-01-01'), new Date('2025-01-02')]
      const dataService = {
        getTradingDays: jest.fn(async () => tradingDays),
        loadDailyBars: jest.fn(async () =>
          new Map([
            [
              '000001.SZ',
              new Map([
                ['2025-01-01', buildBar({ tsCode: '000001.SZ', tradeDate: tradingDays[0], open: 10, close: 10 })],
                ['2025-01-02', buildBar({ tsCode: '000001.SZ', tradeDate: tradingDays[1], open: 11, close: 11 })],
              ]),
            ],
          ]),
        ),
        loadBenchmarkBars: jest.fn(async () => new Map(tradingDays.map((d) => [d.toISOString().slice(0, 10), 100]))),
      }
      const strategyRegistry = {
        getStrategy: jest.fn(() => ({ generateSignal: jest.fn(async () => ({ targets: [{ tsCode: '000001.SZ' }] })) })),
      }
      const executeTrades = jest.fn((_portfolio, _signal, _bars, _config, signalDate, executeDate) => ({
        trades: [],
        rebalanceLog: {
          signalDate,
          executeDate,
          targetCount: 1,
          executedBuyCount: 0,
          executedSellCount: 0,
          skippedLimitCount: 0,
          skippedSuspendCount: 0,
          message: null,
        },
      }))
      const executionService = { executeTrades }
      const metricsService = { computeMetrics: jest.fn(() => buildMetrics()) }
      const svc = createService({ dataService, executionService, metricsService, strategyRegistry })

      await svc.runBacktest(buildConfig())

      expect(executeTrades).toHaveBeenCalledTimes(1)
      const [, , , , signalDate, executeDate] = executeTrades.mock.calls[0]
      expect(signalDate.toISOString().slice(0, 10)).toBe('2025-01-01')
      expect(executeDate.toISOString().slice(0, 10)).toBe('2025-01-02')
    })

    it('[BIZ] T+1 执行日无行情时保留 pending signal，延后到下一可交易日', async () => {
      const tradingDays = [new Date('2025-01-01'), new Date('2025-01-02'), new Date('2025-01-03')]
      const dataService = {
        getTradingDays: jest.fn(async () => tradingDays),
        loadDailyBars: jest.fn(async () =>
          new Map([
            [
              '000001.SZ',
              new Map([
                ['2025-01-01', buildBar({ tsCode: '000001.SZ', tradeDate: tradingDays[0], open: 10, close: 10 })],
                ['2025-01-03', buildBar({ tsCode: '000001.SZ', tradeDate: tradingDays[2], open: 11, close: 11 })],
              ]),
            ],
          ]),
        ),
        loadBenchmarkBars: jest.fn(async () => new Map(tradingDays.map((d) => [d.toISOString().slice(0, 10), 100]))),
      }
      const generateSignal = jest.fn(async () => ({ targets: [{ tsCode: '000001.SZ', weight: 1 }] }))
      const strategyRegistry = { getStrategy: jest.fn(() => ({ generateSignal })) }
      const executeTrades = jest.fn((_portfolio, _signal, _bars, _config, signalDate, executeDate) => ({
        trades: [
          {
            tradeDate: executeDate,
            tsCode: '000001.SZ',
            side: 'BUY',
            price: 11,
            quantity: 100,
            amount: 1100,
            commission: 0,
            stampDuty: 0,
            slippageCost: 0,
            reason: 'rebalance-buy',
          },
        ],
        rebalanceLog: {
          signalDate,
          executeDate,
          targetCount: 1,
          executedBuyCount: 1,
          executedSellCount: 0,
          skippedLimitCount: 0,
          skippedSuspendCount: 0,
          message: null,
        },
      }))
      const executionService = { executeTrades }
      const metricsService = { computeMetrics: jest.fn(() => buildMetrics({ tradeCount: 1 })) }
      const svc = createService({ dataService, executionService, metricsService, strategyRegistry })

      await svc.runBacktest(buildConfig())

      expect(executeTrades).toHaveBeenCalledTimes(1)
      const [, , , , signalDate, executeDate] = executeTrades.mock.calls[0]
      expect(signalDate.toISOString().slice(0, 10)).toBe('2025-01-01')
      expect(executeDate.toISOString().slice(0, 10)).toBe('2025-01-03')
      expect(generateSignal).toHaveBeenCalledTimes(2)
    })

    it('[EDGE] benchmark 中间缺日时沿用上一日 benchmarkNav，不产生虚假回撤', async () => {
      const tradingDays = [new Date('2025-01-01'), new Date('2025-01-02'), new Date('2025-01-03')]
      const dataService = {
        getTradingDays: jest.fn(async () => tradingDays),
        loadDailyBars: jest.fn(async () => new Map()),
        loadBenchmarkBars: jest.fn(async () =>
          new Map([
            ['2025-01-01', 100],
            ['2025-01-03', 120],
          ]),
        ),
      }
      const strategyRegistry = { getStrategy: jest.fn(() => ({ generateSignal: jest.fn(async () => ({ targets: [] })) })) }
      const executionService = {
        executeTrades: jest.fn((_portfolio, _signal, _bars, _config, signalDate, executeDate) => ({
          trades: [],
          rebalanceLog: {
            signalDate,
            executeDate,
            targetCount: 0,
            executedBuyCount: 0,
            executedSellCount: 0,
            skippedLimitCount: 0,
            skippedSuspendCount: 0,
            message: null,
          },
        })),
      }
      const metricsService = { computeMetrics: jest.fn(() => buildMetrics({ benchmarkReturn: 0.2 })) }
      const svc = createService({ dataService, executionService, metricsService, strategyRegistry })

      const result = await svc.runBacktest(
        buildConfig({
          strategyConfig: { tsCodes: [], weightMode: 'EQUAL' },
          customUniverseTsCodes: [],
          rebalanceFrequency: 'MONTHLY',
        }),
      )

      expect(result.navRecords.map((r) => r.benchmarkNav)).toEqual([1, 1, 1.2])
      expect(result.navRecords.map((r) => r.benchmarkReturn)).toEqual([0, 0, 0.19999999999999996])
    })
  })
})
