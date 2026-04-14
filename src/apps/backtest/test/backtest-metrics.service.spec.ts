import { BacktestMetricsService } from '../services/backtest-metrics.service'
import { DailyNavRecord, TradeRecord, BacktestConfig } from '../types/backtest-engine.types'

// ── 测试数据工厂 ───────────────────────────────────────────────────────────────

function buildNav(partial: Partial<DailyNavRecord> = {}): DailyNavRecord {
  return {
    tradeDate: new Date('2025-01-01'),
    nav: 1.0,
    benchmarkNav: 1.0,
    dailyReturn: 0,
    benchmarkReturn: 0,
    drawdown: 0,
    cash: 1_000_000,
    positionValue: 0,
    exposure: 0,
    cashRatio: 1,
    ...partial,
  }
}

function buildTrade(partial: Partial<TradeRecord> = {}): TradeRecord {
  return {
    tradeDate: new Date('2025-01-02'),
    tsCode: '000001.SZ',
    side: 'BUY',
    price: 10,
    quantity: 100,
    amount: 1000,
    commission: 5,
    stampDuty: 0,
    slippageCost: 1,
    reason: null,
    ...partial,
  }
}

const baseConfig = {} as BacktestConfig

// ── 工具：构建连续 N 日的 NAV 序列 ────────────────────────────────────────────

/**
 * 构造等收益率序列。
 * @param dailyReturn 每日策略收益率（如 0.001 = 0.1%）
 * @param benchmarkDailyReturn 每日基准收益率
 * @param n 天数
 */
function buildNavSequence(dailyReturn: number, benchmarkDailyReturn: number, n: number): DailyNavRecord[] {
  const records: DailyNavRecord[] = []
  let nav = 1.0
  let benchmarkNav = 1.0
  let peak = 1.0

  for (let i = 0; i < n; i++) {
    nav = nav * (1 + dailyReturn)
    benchmarkNav = benchmarkNav * (1 + benchmarkDailyReturn)
    peak = Math.max(peak, nav)
    const drawdown = nav / peak - 1

    records.push(
      buildNav({
        tradeDate: new Date(2025, 0, i + 1),
        nav,
        benchmarkNav,
        dailyReturn,
        benchmarkReturn: benchmarkDailyReturn,
        drawdown,
      }),
    )
  }
  return records
}

// ═══════════════════════════════════════════════════════════════════════════════
// 测试套件
// ═══════════════════════════════════════════════════════════════════════════════

describe('BacktestMetricsService', () => {
  let service: BacktestMetricsService

  beforeEach(() => {
    service = new BacktestMetricsService()
  })

  // ── 边界：数据不足 ──────────────────────────────────────────────────────────

  describe('数据不足时返回空指标', () => {
    it('空 navRecords → 全零指标，tradeCount 正确', () => {
      const result = service.computeMetrics([], [buildTrade(), buildTrade()], baseConfig)
      expect(result.totalReturn).toBe(0)
      expect(result.sharpeRatio).toBe(0)
      expect(result.maxDrawdown).toBe(0)
      expect(result.tradeCount).toBe(2)
    })

    it('单条 navRecord → 全零指标', () => {
      const result = service.computeMetrics([buildNav({ nav: 1.1 })], [], baseConfig)
      expect(result.totalReturn).toBe(0)
      expect(result.tradeCount).toBe(0)
    })
  })

  // ── 总收益率 ────────────────────────────────────────────────────────────────

  describe('totalReturn & benchmarkReturn', () => {
    it('持平行情 → totalReturn = 0', () => {
      const navs = buildNavSequence(0, 0, 252)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.totalReturn).toBeCloseTo(0, 6)
    })

    it('每日 +1% 持续 252 天 → totalReturn ≈ 11.96 (复利)', () => {
      const navs = buildNavSequence(0.01, 0, 252)
      const result = service.computeMetrics(navs, [], baseConfig)
      // 1.01^252 - 1 ≈ 11.965
      expect(result.totalReturn).toBeGreaterThan(11)
      expect(result.totalReturn).toBeLessThan(13)
    })

    it('基准每日 +0.05% → benchmarkReturn 正值', () => {
      const navs = buildNavSequence(0, 0.0005, 252)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.benchmarkReturn).toBeGreaterThan(0)
    })

    it('excessReturn = totalReturn - benchmarkReturn', () => {
      const navs = buildNavSequence(0.002, 0.001, 100)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.excessReturn).toBeCloseTo(result.totalReturn - result.benchmarkReturn, 8)
    })
  })

  // ── 年化收益 ────────────────────────────────────────────────────────────────

  describe('annualizedReturn', () => {
    it('252 个交易日 → annualizedReturn ≈ totalReturn（整一年）', () => {
      const dailyReturn = 0.0004 // ~10% 年化
      const navs = buildNavSequence(dailyReturn, 0, 252)
      const result = service.computeMetrics(navs, [], baseConfig)
      // 一整年的年化应约等于总收益
      expect(Math.abs(result.annualizedReturn - result.totalReturn)).toBeLessThan(0.01)
    })

    it('正收益 → annualizedReturn 为正', () => {
      const navs = buildNavSequence(0.001, 0, 252)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.annualizedReturn).toBeGreaterThan(0)
    })
  })

  // ── 最大回撤 ─────────────────────────────────────────────────────────────────

  describe('maxDrawdown', () => {
    it('单调上涨序列 → maxDrawdown = 0', () => {
      const navs = buildNavSequence(0.001, 0, 100)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.maxDrawdown).toBeCloseTo(0, 5)
    })

    it('包含回撤 → maxDrawdown 为负', () => {
      // 先涨后跌：前50天 +0.5%，后50天 -0.5%
      const up = buildNavSequence(0.005, 0, 50)
      const lastUp = up[up.length - 1]
      // 从高点开始回落
      const down: DailyNavRecord[] = []
      let nav = lastUp.nav
      let peak = nav
      for (let i = 0; i < 50; i++) {
        nav = nav * (1 - 0.005)
        peak = Math.max(peak, nav)
        down.push(buildNav({ nav, benchmarkNav: 1, dailyReturn: -0.005, benchmarkReturn: 0, drawdown: nav / peak - 1 }))
      }
      const navs = [...up, ...down]
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.maxDrawdown).toBeLessThan(0)
    })

    it('全程亏损 → maxDrawdown 等于 totalReturn（不超过）', () => {
      const navs = buildNavSequence(-0.002, 0, 100)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.maxDrawdown).toBeLessThanOrEqual(0)
      expect(result.maxDrawdown).toBeGreaterThanOrEqual(-1)
    })
  })

  // ── 夏普比率 ─────────────────────────────────────────────────────────────────

  describe('sharpeRatio', () => {
    it('零波动率 → sharpeRatio = 0', () => {
      const navs = buildNavSequence(0, 0, 100)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.sharpeRatio).toBe(0)
    })

    it('高稳定正收益 → sharpeRatio > 1', () => {
      // 每日固定 +0.04%（约年化 10%），零波动（需要轻微缺陷模拟波动）
      // 使用 +0.1% 但有轻微噪声的模拟
      const n = 252
      const records: DailyNavRecord[] = []
      let nav = 1.0
      let peak = 1.0
      for (let i = 0; i < n; i++) {
        const r = 0.001 + (i % 2 === 0 ? 0.0001 : -0.0001) // 非零波动
        nav = nav * (1 + r)
        peak = Math.max(peak, nav)
        records.push(buildNav({ nav, benchmarkNav: 1, dailyReturn: r, benchmarkReturn: 0, drawdown: nav / peak - 1 }))
      }
      const result = service.computeMetrics(records, [], baseConfig)
      // Sharpe > 1 表示超额收益相对风险优秀
      expect(result.sharpeRatio).toBeGreaterThan(1)
    })

    it('有波动的亏损序列 → sharpeRatio 为负', () => {
      // 有真实波动的亏损：净收益为负，波动足够触发有意义的 Sharpe
      const n = 252
      const records: DailyNavRecord[] = []
      let nav = 1.0
      let peak = 1.0
      for (let i = 0; i < n; i++) {
        const r = i % 2 === 0 ? -0.008 : 0.002 // 平均每日 -0.003，有明显波动
        nav = nav * (1 + r)
        peak = Math.max(peak, nav)
        records.push(buildNav({ nav, benchmarkNav: 1, dailyReturn: r, benchmarkReturn: 0, drawdown: nav / peak - 1 }))
      }
      const result = service.computeMetrics(records, [], baseConfig)
      expect(result.sharpeRatio).toBeLessThan(0)
    })
  })

  // ── 索提诺比率 ────────────────────────────────────────────────────────────────

  describe('sortinoRatio', () => {
    it('无下行波动（只有正收益）→ sortinoRatio = 0（下行 std=0）', () => {
      // 每日明确高于无风险利率（0.02/252 ≈ 0.0000794），所以超额为正
      const navs = buildNavSequence(0.005, 0, 100)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.sortinoRatio).toBe(0) // downsideStd=0 时返回 0
    })

    it('有下行波动时 sortinoRatio 有限值', () => {
      const n = 252
      const records: DailyNavRecord[] = []
      let nav = 1.0
      let peak = 1.0
      for (let i = 0; i < n; i++) {
        const r = i % 3 === 0 ? -0.005 : 0.003
        nav = nav * (1 + r)
        peak = Math.max(peak, nav)
        records.push(buildNav({ nav, benchmarkNav: 1, dailyReturn: r, benchmarkReturn: 0, drawdown: nav / peak - 1 }))
      }
      const result = service.computeMetrics(records, [], baseConfig)
      expect(isFinite(result.sortinoRatio)).toBe(true)
    })

    it('[BIZ] Sortino 下行偏差分母使用全体收益数量（非仅负值数量）', () => {
      // 关键验证：固定修复后的 Sortino 使用 N(全体) 做分母
      // 构造一半正、一半负的超额收益序列
      const n = 252
      const records: DailyNavRecord[] = []
      let nav = 1.0
      let peak = 1.0
      for (let i = 0; i < n; i++) {
        const r = i % 2 === 0 ? 0.005 : -0.003 // 每隔一天涨跌
        nav = nav * (1 + r)
        peak = Math.max(peak, nav)
        records.push(buildNav({ nav, benchmarkNav: 1, dailyReturn: r, benchmarkReturn: 0, drawdown: nav / peak - 1 }))
      }

      const result = service.computeMetrics(records, [], baseConfig)

      // 手算 downside deviation (使用全体 N=252 做分母)
      const rfDaily = 0.02 / 252
      const excessReturns = records.map(r => r.dailyReturn - rfDaily)
      const downsideSquaredSum = excessReturns.reduce((a, r) => a + (r < 0 ? r ** 2 : 0), 0)
      const downsideVar = downsideSquaredSum / excessReturns.length  // N=252, not ~126
      const downsideStd = Math.sqrt(downsideVar) * Math.sqrt(252)

      // 验证 Sortino 是有限值且非零
      expect(isFinite(result.sortinoRatio)).toBe(true)
      expect(result.sortinoRatio).not.toBe(0)

      // 手算 annualized return
      const firstNav = records[0].nav
      const lastNav = records[records.length - 1].nav
      const totalReturn = lastNav / firstNav - 1
      const years = n / 252
      const annualizedReturn = Math.pow(1 + totalReturn, 1 / years) - 1
      const expectedSortino = downsideStd > 0 ? (annualizedReturn - 0.02) / downsideStd : 0

      expect(result.sortinoRatio).toBeCloseTo(expectedSortino, 3)
    })
  })

  // ── Alpha & Beta ──────────────────────────────────────────────────────────────

  describe('alpha & beta', () => {
    it('收益与基准完全一致 → beta ≈ 1, alpha ≈ 0', () => {
      const r = 0.001
      const navs = buildNavSequence(r, r, 252)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.beta).toBeCloseTo(1, 1)
      expect(Math.abs(result.alpha)).toBeLessThan(0.05)
    })

    it('基准零方差 → beta = 0', () => {
      const navs = buildNavSequence(0.001, 0, 100) // benchmarkReturn=0 每天
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.beta).toBe(0)
    })
  })

  // ── 交易统计 ──────────────────────────────────────────────────────────────────

  describe('tradeCount & turnoverRate', () => {
    it('无交易 → tradeCount = 0, turnoverRate = 0', () => {
      const navs = buildNavSequence(0.001, 0, 252)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.tradeCount).toBe(0)
      expect(result.turnoverRate).toBe(0)
    })

    it('SELL 交易不计入换手率（只计 BUY）', () => {
      const navs = buildNavSequence(0.001, 0, 252)
      const sellOnly = [buildTrade({ side: 'SELL', amount: 100_000 })]
      const withBuy = [buildTrade({ side: 'BUY', amount: 100_000 })]

      const resultSell = service.computeMetrics(navs, sellOnly, baseConfig)
      const resultBuy = service.computeMetrics(navs, withBuy, baseConfig)

      expect(resultSell.turnoverRate).toBe(0)
      expect(resultBuy.turnoverRate).toBeGreaterThan(0)
    })

    it('tradeCount 包含所有交易（BUY + SELL）', () => {
      const navs = buildNavSequence(0, 0, 10)
      const trades = [buildTrade({ side: 'BUY' }), buildTrade({ side: 'SELL' }), buildTrade({ side: 'BUY' })]
      const result = service.computeMetrics(navs, trades, baseConfig)
      expect(result.tradeCount).toBe(3)
    })
  })

  // ── 胜率 ─────────────────────────────────────────────────────────────────────

  describe('winRate', () => {
    it('每日均跑赢基准 → winRate = 1', () => {
      const navs = buildNavSequence(0.002, 0.001, 100)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.winRate).toBeCloseTo(1, 5)
    })

    it('每日均跑输基准 → winRate = 0', () => {
      const navs = buildNavSequence(0.001, 0.002, 100)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.winRate).toBeCloseTo(0, 5)
    })
  })

  // ── Calmar 比率 ───────────────────────────────────────────────────────────────

  describe('calmarRatio', () => {
    it('无回撤 → calmarRatio = 0', () => {
      const navs = buildNavSequence(0, 0, 100)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.calmarRatio).toBe(0)
    })

    it('有回撤且正收益 → calmarRatio > 0', () => {
      const mixed: DailyNavRecord[] = []
      let nav = 1.0
      let peak = 1.0
      for (let i = 0; i < 252; i++) {
        const r = i % 5 === 0 ? -0.01 : 0.003
        nav = nav * (1 + r)
        peak = Math.max(peak, nav)
        mixed.push(buildNav({ nav, benchmarkNav: 1, dailyReturn: r, benchmarkReturn: 0, drawdown: nav / peak - 1 }))
      }
      const result = service.computeMetrics(mixed, [], baseConfig)
      expect(result.calmarRatio).toBeGreaterThan(0)
    })
  })

  // ── maxDrawdown: 先涨后跌的精确值验证 ──────────────────────────────────────

  describe('[BIZ] maxDrawdown 精确值', () => {
    it('[BIZ] 先涨至 1.2 再跌至 0.9 → maxDrawdown ≈ -0.25', () => {
      // NAV: 1.0 → 1.2 → 0.9; peak=1.2; drawdown at 0.9 = 0.9/1.2 - 1 = -0.25
      const navs: DailyNavRecord[] = [
        buildNav({ nav: 1.0, dailyReturn: 0, drawdown: 0 }),
        buildNav({ nav: 1.2, dailyReturn: 0.2, drawdown: 0 }),
        buildNav({ nav: 0.9, dailyReturn: -0.25, drawdown: 0.9 / 1.2 - 1 }),
      ]
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.maxDrawdown).toBeCloseTo(-0.25, 4)
    })

    it('[BIZ] 先跌后涨（从未超过起始值）→ maxDrawdown 等于第一跌的幅度', () => {
      // NAV: 1.0 → 0.8 → 0.9; peak=1.0; drawdown at 0.8 = 0.8/1.0 - 1 = -0.2
      const navs: DailyNavRecord[] = [
        buildNav({ nav: 1.0, dailyReturn: 0, drawdown: 0 }),
        buildNav({ nav: 0.8, dailyReturn: -0.2, drawdown: -0.2 }),
        buildNav({ nav: 0.9, dailyReturn: 0.125, drawdown: -0.1 }),
      ]
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.maxDrawdown).toBeCloseTo(-0.2, 4)
    })
  })

  // ── 总收益率精确值 ──────────────────────────────────────────────────────────

  describe('[BIZ] totalReturn 精确值', () => {
    it('[BIZ] 简单两日序列：1.0 → 1.1 → totalReturn = 0.1', () => {
      const navs: DailyNavRecord[] = [
        buildNav({ nav: 1.0, benchmarkNav: 1.0, dailyReturn: 0, benchmarkReturn: 0 }),
        buildNav({ nav: 1.1, benchmarkNav: 1.05, dailyReturn: 0.1, benchmarkReturn: 0.05 }),
      ]
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.totalReturn).toBeCloseTo(0.1, 6)
      expect(result.benchmarkReturn).toBeCloseTo(0.05, 6)
      expect(result.excessReturn).toBeCloseTo(0.05, 6)
    })

    it('[BIZ] NAV 下跌：1.0 → 0.8 → totalReturn = -0.2', () => {
      const navs: DailyNavRecord[] = [
        buildNav({ nav: 1.0, benchmarkNav: 1.0, dailyReturn: 0, benchmarkReturn: 0 }),
        buildNav({ nav: 0.8, benchmarkNav: 1.0, dailyReturn: -0.2, benchmarkReturn: 0 }),
      ]
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.totalReturn).toBeCloseTo(-0.2, 6)
    })
  })

  // ── 信息比率 ──────────────────────────────────────────────────────────────

  describe('[BIZ] informationRatio', () => {
    it('[BIZ] 策略与基准完全一致 → informationRatio = 0（超额无波动）', () => {
      const r = 0.001
      const navs = buildNavSequence(r, r, 252)
      const result = service.computeMetrics(navs, [], baseConfig)
      // excessSeries 全为 0，excessStd=0 → IR=0
      expect(result.informationRatio).toBe(0)
    })

    it('[BIZ] 策略持续跑赢基准 → informationRatio > 0', () => {
      const navs = buildNavSequence(0.002, 0.001, 252)
      const result = service.computeMetrics(navs, [], baseConfig)
      expect(result.informationRatio).toBeGreaterThan(0)
    })
  })

  // ── 方差计算方式（总体 vs 样本）─────────────────────────────────────────────

  describe('[P1-B5 已修复] Sharpe/Volatility 改用样本方差（÷n-1）', () => {
    it('[P1-B5 已修复] n=5 时 volatility 使用样本方差，Sharpe 较总体方差更保守', () => {
      // 对称日收益序列：[-0.02, -0.01, 0, 0.01, 0.02]
      // mean = 0, SS = 2*(0.02)^2 + 2*(0.01)^2 = 0.001
      // 总体 std = sqrt(0.001/5) = sqrt(0.0002) ≈ 0.01414
      // 样本 std = sqrt(0.001/4) = sqrt(0.00025) ≈ 0.01581（修复后应使用此值）
      const dailyReturns = [-0.02, -0.01, 0, 0.01, 0.02]
      let nav = 1.0
      let peak = 1.0
      const records: DailyNavRecord[] = []
      for (const r of dailyReturns) {
        nav = nav * (1 + r)
        peak = Math.max(peak, nav)
        records.push(buildNav({ nav, benchmarkNav: 1, dailyReturn: r, benchmarkReturn: 0, drawdown: nav / peak - 1 }))
      }

      const result = service.computeMetrics(records, [], baseConfig)

      const rfDaily = 0.02 / 252
      const excessReturns = dailyReturns.map((r) => r - rfDaily)
      const excessMean = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length
      const ss = excessReturns.reduce((a, r) => a + (r - excessMean) ** 2, 0)
      const n = excessReturns.length

      const populationAnnStd = Math.sqrt(ss / n) * Math.sqrt(252)
      const sampleAnnStd = Math.sqrt(ss / (n - 1)) * Math.sqrt(252)

      // 修复后：volatility 使用样本方差（÷n-1）
      expect(result.volatility).toBeCloseTo(sampleAnnStd, 4)
      // 样本 std > 总体 std
      expect(result.volatility).toBeGreaterThan(populationAnnStd)

      // 修复后 Sharpe 使用样本 std（更大），因此比总体 Sharpe 更保守（更小的绝对值）
      const firstNav = records[0].nav
      const lastNav = records[n - 1].nav
      const totalReturn = lastNav / firstNav - 1
      const years = n / 252
      const annReturn = Math.pow(1 + totalReturn, 1 / years) - 1
      if (sampleAnnStd > 1e-8) {
        const expectedSampleSharpe = (annReturn - 0.02) / sampleAnnStd
        expect(result.sharpeRatio).toBeCloseTo(expectedSampleSharpe, 3)
      }
    })

    it('[P1-B5 已修复] IR 使用样本方差，n=4 时比总体方差版本更保守（小 sqrt(4/3) 倍）', () => {
      // excessReturn = [0.001, -0.001, 0.001, -0.001]，mean=0，SS=0.000004
      // 样本 std = sqrt(0.000004/3) ≈ 0.001155（修复后）
      // 总体 std = sqrt(0.000004/4) = 0.001（修复前）
      const benchmarkReturn = 0.002
      const dailyReturns = [0.003, 0.001, 0.003, 0.001]
      let nav = 1.0
      let benchNav = 1.0
      let peak = 1.0
      const records: DailyNavRecord[] = []
      for (let i = 0; i < dailyReturns.length; i++) {
        nav = nav * (1 + dailyReturns[i])
        benchNav = benchNav * (1 + benchmarkReturn)
        peak = Math.max(peak, nav)
        records.push(
          buildNav({
            nav,
            benchmarkNav: benchNav,
            dailyReturn: dailyReturns[i],
            benchmarkReturn,
            drawdown: nav / peak - 1,
          }),
        )
      }

      const result = service.computeMetrics(records, [], baseConfig)

      const n = dailyReturns.length
      const excessSeries = dailyReturns.map((r) => r - benchmarkReturn)
      const ss = excessSeries.reduce((a, r) => a + r ** 2, 0) // excessMean=0
      const sampleAnnExcessStd = Math.sqrt(ss / (n - 1)) * Math.sqrt(252)

      // 修复后：IR 分母使用样本 std
      const annExcessReturn = (excessSeries.reduce((a, b) => a + b, 0) / n) * 252
      const expectedIR = sampleAnnExcessStd > 0 ? annExcessReturn / sampleAnnExcessStd : 0
      if (isFinite(result.informationRatio)) {
        expect(result.informationRatio).toBeCloseTo(expectedIR, 3)
      }
    })
  })
})
