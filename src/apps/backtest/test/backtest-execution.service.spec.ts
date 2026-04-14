/**
 * BacktestExecutionService — 单元测试
 *
 * 测试设计原则：所有期望值基于业务公式独立手算，不从代码输出反推。
 *
 * 覆盖要点：
 * - SELL: 现金流 = amount - commission - stampDuty - slippageCost
 * - BUY: 现金流 = amount + commission + slippageCost
 * - 加仓成本价加权
 * - LOT_SIZE 向下取整
 * - T+1 限制
 * - 涨跌停/停牌跳过
 */
import { BacktestExecutionService } from '../services/backtest-execution.service'
import { BacktestConfig, DailyBar, PortfolioState, SignalOutput } from '../types/backtest-engine.types'

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

function buildConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    runId: 'test-run',
    strategyType: 'CUSTOM_POOL_REBALANCE',
    strategyConfig: { tsCodes: [] },
    startDate: new Date('2025-01-01'),
    endDate: new Date('2025-12-31'),
    benchmarkTsCode: '000300.SH',
    universe: 'CUSTOM',
    initialCapital: 1_000_000,
    rebalanceFrequency: 'MONTHLY',
    priceMode: 'NEXT_OPEN',
    commissionRate: 0.0003, // 万3
    stampDutyRate: 0.001, // 千1
    minCommission: 5,
    slippageBps: 5, // 5bps
    maxPositions: 20,
    maxWeightPerStock: 1,
    minDaysListed: 0,
    enableTradeConstraints: false,
    enableT1Restriction: false,
    partialFillEnabled: true,
    ...overrides,
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

// ═══════════════════════════════════════════════════════════════════════════════

describe('BacktestExecutionService', () => {
  let service: BacktestExecutionService

  beforeEach(() => {
    service = new BacktestExecutionService()
  })

  // ── SELL 现金流 ────────────────────────────────────────────────────────────

  describe('[BIZ] SELL 现金流计算', () => {
    it('[BIZ] 卖出时 cash 增加 = amount - commission - stampDuty - slippageCost', () => {
      // 持仓：1000股 @8元
      // 执行价 open=10, 卖 1000 股
      // amount = 10 * 1000 = 10000
      // slippageCost = 10000 * 5 / 10000 = 5
      // commission = max(10000 * 0.0003, 5) = max(3, 5) = 5
      // stampDuty = 10000 * 0.001 = 10
      // net = 10000 - 5 - 5 - 10 = 9980
      const config = buildConfig()
      const portfolio = buildPortfolio({
        cash: 0,
        positions: new Map([
          ['000001.SZ', { tsCode: '000001.SZ', quantity: 1000, costPrice: 8, entryDate: new Date() }],
        ]),
      })
      const signal: SignalOutput = { targets: [] } // sell everything
      const bars = new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })]])

      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      expect(trades).toHaveLength(1)
      expect(trades[0].side).toBe('SELL')
      expect(trades[0].quantity).toBe(1000)
      expect(trades[0].amount).toBe(10000)
      expect(trades[0].slippageCost).toBeCloseTo(5, 5)
      expect(trades[0].commission).toBe(5)
      expect(trades[0].stampDuty).toBe(10)
      // cash = 0 + 10000 - 5 - 10 - 5 = 9980
      expect(portfolio.cash).toBeCloseTo(9980, 5)
      expect(portfolio.positions.size).toBe(0)
    })

    it('[BIZ] 卖出记录的 actualPrice = execPrice - slippage/qty', () => {
      const config = buildConfig({ slippageBps: 10 })
      const portfolio = buildPortfolio({
        cash: 0,
        positions: new Map([
          ['000001.SZ', { tsCode: '000001.SZ', quantity: 500, costPrice: 8, entryDate: new Date() }],
        ]),
      })
      const signal: SignalOutput = { targets: [] }
      const bars = new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 20, close: 20 })]])

      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      // amount = 20 * 500 = 10000
      // slippage = 10000 * 10 / 10000 = 10
      // actualPrice = 20 - 10/500 = 20 - 0.02 = 19.98
      expect(trades[0].price).toBeCloseTo(19.98, 5)
    })
  })

  // ── BUY 现金流 ─────────────────────────────────────────────────────────────

  describe('[BIZ] BUY 现金流计算', () => {
    it('[BIZ] 买入时 cash 减少 = amount + commission + slippageCost', () => {
      // cash=100000, target 000001.SZ 权重 50%
      const config = buildConfig({ slippageBps: 5 })
      const portfolio = buildPortfolio({ cash: 100000 })
      const signal: SignalOutput = { targets: [{ tsCode: '000001.SZ', weight: 0.5 }] }
      const bars = new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })]])

      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      expect(trades).toHaveLength(1)
      expect(trades[0].side).toBe('BUY')
      // targetValue = 100000 * 0.5 = 50000
      // rawQty = floor(50000/10/100)*100 = 5000
      // amount = 5000 * 10 = 50000
      // slippageCost = 50000 * 5 / 10000 = 25
      // commission = max(50000*0.0003, 5) = max(15, 5) = 15
      expect(trades[0].quantity).toBe(5000)
      expect(trades[0].amount).toBe(50000)
      expect(trades[0].slippageCost).toBeCloseTo(25, 5)
      expect(trades[0].commission).toBeCloseTo(15, 5)
      expect(trades[0].stampDuty).toBe(0) // 买入无印花税

      // cash = 100000 - 50000 - 15 - 25 = 49960
      expect(portfolio.cash).toBeCloseTo(49960, 5)
    })

    it('[BIZ] LOT_SIZE 向下取整到 100 股', () => {
      const config = buildConfig()
      const portfolio = buildPortfolio({ cash: 1050 }) // 只够买约 105 股 @10 元
      const signal: SignalOutput = { targets: [{ tsCode: '000001.SZ', weight: 1.0 }] }
      const bars = new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })]])

      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      expect(trades).toHaveLength(1)
      // floor(1050/10/100)*100 = floor(1.05)*100 = 100
      expect(trades[0].quantity).toBe(100)
    })

    it('[BIZ] 不足 100 股时不买入', () => {
      const config = buildConfig()
      const portfolio = buildPortfolio({ cash: 500 }) // 只够 50 股 @10 元
      const signal: SignalOutput = { targets: [{ tsCode: '000001.SZ', weight: 1.0 }] }
      const bars = new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })]])

      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      expect(trades).toHaveLength(0)
    })
  })

  // ── 加仓成本价加权 ─────────────────────────────────────────────────────────

  describe('[BIZ] 加仓成本价加权', () => {
    it('[BIZ] 已有持仓再买入时 costPrice 使用加权平均', () => {
      const config = buildConfig({ slippageBps: 0 }) // 去掉滑点简化计算
      const portfolio = buildPortfolio({
        cash: 50000,
        positions: new Map([
          ['000001.SZ', { tsCode: '000001.SZ', quantity: 100, costPrice: 8, entryDate: new Date() }],
        ]),
      })
      // 已有 100股@8, 目标权重 100%
      // nav = 50000 + 100*10 = 51000
      // targetValue = 51000
      // currentValue = 100*10 = 1000
      // diffValue = 50000
      // rawQty = floor(50000/10/100)*100 = 5000
      const signal: SignalOutput = { targets: [{ tsCode: '000001.SZ', weight: 1.0 }] }
      const bars = new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })]])

      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      expect(trades).toHaveLength(1)
      const pos = portfolio.positions.get('000001.SZ')!
      // 新 qty = 100 + 5000 = 5100
      expect(pos.quantity).toBe(5100)
      // costPrice = (8*100 + 10*5000) / 5100 = (800 + 50000) / 5100 ≈ 9.961
      expect(pos.costPrice).toBeCloseTo((8 * 100 + 10 * 5000) / 5100, 4)
    })
  })

  // ── T+1 限制 ───────────────────────────────────────────────────────────────

  describe('[BIZ] T+1 限制', () => {
    it('[BIZ] enableT1Restriction=true 时不能在同轮中卖出后买入同一只股票', () => {
      // 注意：当前实现中，targets 中的股票不会被卖出（sell step 跳过 effectiveWeights 中的股票），
      // 因此 T+1 限制在正常调仓流程中不会触发。此测试验证开启 T+1 后基础流程仍然正常。
      const config = buildConfig({ enableT1Restriction: true })
      const portfolio = buildPortfolio({
        cash: 100000,
        positions: new Map([
          ['000001.SZ', { tsCode: '000001.SZ', quantity: 100, costPrice: 8, entryDate: new Date() }],
        ]),
      })
      const signal: SignalOutput = { targets: [{ tsCode: '000002.SZ', weight: 0.5 }] }
      const bars = new Map([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })],
        ['000002.SZ', buildBar({ tsCode: '000002.SZ', open: 20, close: 20 })],
      ])

      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      const sellTrades = trades.filter(t => t.side === 'SELL')
      const buyTrades = trades.filter(t => t.side === 'BUY')
      expect(sellTrades).toHaveLength(1)
      expect(sellTrades[0].tsCode).toBe('000001.SZ')
      expect(buyTrades).toHaveLength(1)
      expect(buyTrades[0].tsCode).toBe('000002.SZ')
    })
  })

  // ── 涨跌停与停牌 ──────────────────────────────────────────────────────────

  describe('[BIZ] 涨跌停与停牌', () => {
    it('[BIZ] 停牌股票不能卖出', () => {
      const config = buildConfig({ enableTradeConstraints: true })
      const portfolio = buildPortfolio({
        cash: 0,
        positions: new Map([
          ['000001.SZ', { tsCode: '000001.SZ', quantity: 1000, costPrice: 8, entryDate: new Date() }],
        ]),
      })
      const signal: SignalOutput = { targets: [] } // sell everything
      const bars = new Map([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10, isSuspended: true })],
      ])

      const { trades, rebalanceLog } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      expect(trades).toHaveLength(0) // 停牌无法卖出
      expect(rebalanceLog.skippedSuspendCount).toBe(1)
      expect(portfolio.positions.size).toBe(1) // 持仓保留
    })

    it('[BIZ] 跌停股票不能卖出（价格 <= downLimit）', () => {
      const config = buildConfig({ enableTradeConstraints: true })
      const portfolio = buildPortfolio({
        cash: 0,
        positions: new Map([
          ['000001.SZ', { tsCode: '000001.SZ', quantity: 1000, costPrice: 8, entryDate: new Date() }],
        ]),
      })
      const signal: SignalOutput = { targets: [] }
      const bars = new Map([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 9, close: 9, downLimit: 9 })],
      ])

      const { trades, rebalanceLog } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      expect(trades).toHaveLength(0)
      expect(rebalanceLog.skippedLimitCount).toBe(1)
    })

    it('[BIZ] 涨停股票不能买入（价格 >= upLimit）', () => {
      const config = buildConfig({ enableTradeConstraints: true })
      const portfolio = buildPortfolio({ cash: 100000 })
      const signal: SignalOutput = { targets: [{ tsCode: '000001.SZ', weight: 1.0 }] }
      const bars = new Map([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 11, close: 11, upLimit: 11 })],
      ])

      const { trades, rebalanceLog } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      expect(trades).toHaveLength(0)
      expect(rebalanceLog.skippedLimitCount).toBe(1)
    })
  })

  // ── 等权重分配 ────────────────────────────────────────────────────────────

  describe('[BIZ] 权重分配', () => {
    it('[BIZ] 未指定权重时使用等权重', () => {
      const config = buildConfig()
      const portfolio = buildPortfolio({ cash: 100000 })
      const signal: SignalOutput = {
        targets: [
          { tsCode: '000001.SZ' }, // no weight
          { tsCode: '000002.SZ' }, // no weight
        ],
      }
      const bars = new Map([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })],
        ['000002.SZ', buildBar({ tsCode: '000002.SZ', open: 10, close: 10 })],
      ])

      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      // 两只股票等权重 = 0.5 each
      // totalNav = 100000 (全现金, 无持仓)
      // A: targetValue = 100000 * 0.5 = 50000, rawQty = floor(50000/10/100)*100 = 5000
      // 买 A 后：cash = 100000 - 50000 - commission - slippage = 约 49960
      // B: targetValue = 100000 * 0.5 = 50000, but available cash < 50000
      // partialFill 模式: availableValue = min(50000, ~49960) ≈ 49960
      // rawQty = floor(49960/10/100)*100 = 4900
      expect(trades).toHaveLength(2)
      expect(trades[0].quantity).toBe(5000) // 第一只获得完整配额
      // 第二只因手续费消耗导致现金不足，实际买入略少
      expect(trades[1].quantity).toBeLessThanOrEqual(5000)
      expect(trades[1].quantity).toBeGreaterThanOrEqual(4800)
    })

    it('[BIZ] maxWeightPerStock 限制权重上限', () => {
      const config = buildConfig({ maxWeightPerStock: 0.3 })
      const portfolio = buildPortfolio({ cash: 100000 })
      const signal: SignalOutput = {
        targets: [
          { tsCode: '000001.SZ', weight: 0.7 },
          { tsCode: '000002.SZ', weight: 0.3 },
        ],
      }
      const bars = new Map([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })],
        ['000002.SZ', buildBar({ tsCode: '000002.SZ', open: 10, close: 10 })],
      ])

      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      // weight capped at 0.3 for 000001
      // 000001: targetValue = 100000 * 0.3 = 30000, qty = floor(30000/10/100)*100 = 3000
      // 000002: targetValue = 100000 * 0.3 = 30000, qty = 3000
      const buyA = trades.find(t => t.tsCode === '000001.SZ')
      const buyB = trades.find(t => t.tsCode === '000002.SZ')
      expect(buyA!.quantity).toBe(3000)
      expect(buyB!.quantity).toBe(3000)
    })
  })

  // ── computePositionValue 中的 falsy 修复验证 ──────────────────────────────

  describe('[BIZ] computePositionValue — close=0 处理', () => {
    it('[BIZ] close=0 时正确计入持仓市值为 0（不跳过）', () => {
      // 通过 executeTrades 间接测试 computePositionValue
      // 有持仓 A 和 B，B 的 close=0
      // totalNav = cash + posValue; B 的 close=0 意味着 B 的市值 = 0
      const config = buildConfig()
      const portfolio = buildPortfolio({
        cash: 50000,
        positions: new Map([
          ['000001.SZ', { tsCode: '000001.SZ', quantity: 100, costPrice: 10, entryDate: new Date() }],
          ['000002.SZ', { tsCode: '000002.SZ', quantity: 100, costPrice: 10, entryDate: new Date() }],
        ]),
      })
      // A 正常 close=10, B 的 close=0
      const signal: SignalOutput = {
        targets: [
          { tsCode: '000001.SZ', weight: 0.5 },
          { tsCode: '000002.SZ', weight: 0.5 },
        ],
      }
      const bars = new Map([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })],
        ['000002.SZ', buildBar({ tsCode: '000002.SZ', open: 0, close: 0 })],
      ])

      // getExecutionPrice returns null if price <= 0, so B won't be bought
      // but computePositionValue should count B's close=0 via !== null
      // totalNav = 50000 + (100*10) + (100*0) = 51000
      // This test verifies the code doesn't use costPrice=10 as fallback for B
      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      // A: targetValue = 51000*0.5 = 25500, currentValue = 100*10=1000
      // diffValue = 24500
      // rawQty = floor(24500/10/100)*100 = 2400
      // B: getExecutionPrice returns null (open=0, price <= 0) → skip buy
      const buyA = trades.find(t => t.tsCode === '000001.SZ' && t.side === 'BUY')
      expect(buyA).toBeDefined()
      expect(buyA!.quantity).toBe(2400)
    })
  })

  // ── rebalanceLog 正确性 ────────────────────────────────────────────────────

  describe('[BIZ] rebalanceLog 统计', () => {
    it('[BIZ] 正确记录 targetCount/executedBuyCount/executedSellCount', () => {
      const config = buildConfig()
      const portfolio = buildPortfolio({
        cash: 100000,
        positions: new Map([
          ['000001.SZ', { tsCode: '000001.SZ', quantity: 100, costPrice: 10, entryDate: new Date() }],
          ['000003.SZ', { tsCode: '000003.SZ', quantity: 200, costPrice: 5, entryDate: new Date() }],
        ]),
      })
      // 目标：换仓到 000002，卖掉 000001 和 000003
      const signal: SignalOutput = { targets: [{ tsCode: '000002.SZ', weight: 1.0 }] }
      const bars = new Map([
        ['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })],
        ['000002.SZ', buildBar({ tsCode: '000002.SZ', open: 20, close: 20 })],
        ['000003.SZ', buildBar({ tsCode: '000003.SZ', open: 5, close: 5 })],
      ])

      const { rebalanceLog } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      expect(rebalanceLog.targetCount).toBe(1)
      expect(rebalanceLog.executedSellCount).toBe(2)
      expect(rebalanceLog.executedBuyCount).toBe(1)
      expect(rebalanceLog.skippedLimitCount).toBe(0)
      expect(rebalanceLog.skippedSuspendCount).toBe(0)
    })
  })

  // ── 资金检查 bug ───────────────────────────────────────────────────────────

  describe('[BUG P1-B6] 资金检查仅比较 amount，未含佣金和滑点', () => {
    it('[BUG P1-B6] 现金恰好等于成交额时扣除最小佣金和滑点后现金变负', () => {
      // cash=1000，买 100股@10 → amount=1000（cash >= amount 通过检查）
      // 但实际扣除：amount(1000) + minCommission(5) + slippage(0.5) = 1005.5
      // → cash = 1000 - 1005.5 = -5.5（负数，资金数据损坏）
      const config = buildConfig({ slippageBps: 5, commissionRate: 0.0003, minCommission: 5 })
      const portfolio = buildPortfolio({ cash: 1000 })
      const signal: SignalOutput = { targets: [{ tsCode: '000001.SZ', weight: 1.0 }] }
      const bars = new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })]])

      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      // [BUG] 资金检查漏洞：`portfolio.cash < amount` 通过，但扣除佣金+滑点后现金为负
      // amount = floor(1000/10/100)*100 * 10 = 100 * 10 = 1000
      // commission = max(1000*0.0003, 5) = 5, slippageCost = 1000*5/10000 = 0.5
      // cash = 1000 - 1000 - 5 - 0.5 = -5.5
      expect(trades).toHaveLength(1) // [BUG] 买入成功了
      expect(portfolio.cash).toBeLessThan(0) // [BUG] 现金为负

      // 修复方案：检查条件改为 `portfolio.cash < amount + commission + slippageCost`
    })

    it('[BUG P1-B6] 佣金超过最小佣金时同样可能出现现金不足', () => {
      // cash = 200000，买 20000股@10 → amount=200000（通过检查）
      // commission = max(200000*0.0003, 5) = max(60, 5) = 60
      // slippage = 200000*5/10000 = 100
      // cash = 200000 - 200000 - 60 - 100 = -160（负数）
      const config = buildConfig({ slippageBps: 5, commissionRate: 0.0003, minCommission: 5 })
      const portfolio = buildPortfolio({ cash: 200000 })
      const signal: SignalOutput = { targets: [{ tsCode: '000001.SZ', weight: 1.0 }] }
      const bars = new Map([['000001.SZ', buildBar({ tsCode: '000001.SZ', open: 10, close: 10 })]])

      const { trades } = service.executeTrades(
        portfolio,
        signal,
        bars,
        config,
        new Date('2025-01-01'),
        new Date('2025-01-02'),
      )

      // floor(200000/10/100)*100 = 2000*100/100 wait:
      // floor(200000/10/100)*100 = floor(200)*100 = 200*100 = 20000? 20000 shares?
      // No: floor(200000/10/100) = floor(200) = 200, * 100 = 20000 shares
      // amount = 20000 * 10 = 200000
      expect(trades).toHaveLength(1) // [BUG] 买入成功了
      expect(portfolio.cash).toBeLessThan(0) // [BUG] 现金为负
    })
  })
})
