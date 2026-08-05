import { mergePriceBuckets } from '../chip/stock-chip-tool.facade'
import { buildSummary } from '../margin/stock-margin-tool.facade'
import { RelativeStrengthCalculationService } from '../relative-strength/relative-strength-calculation.service'

describe('第二批个股深度研究纯计算', () => {
  it('[CHIP] 确定性合并相邻价位桶且保持 percent 总量', () => {
    const input = Array.from({ length: 100 }, (_, index) => ({ price: index + 1, percent: 1 }))
    const first = mergePriceBuckets(input, 20)
    const second = mergePriceBuckets(input, 20)

    expect(first).toEqual(second)
    expect(first).toHaveLength(20)
    expect(first.reduce((sum, item) => sum + (item.percent ?? 0), 0)).toBeCloseTo(100, 12)
    expect(first[0]).toEqual({ price: 3, percent: 5 })
  })

  it('[MARGIN] 5/20 日按实际观测行计算，20 点规则决定趋势', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      tradeDate: new Date(Date.UTC(2026, 0, index + 1)),
      tsCode: '600000.SH',
      rzye: 100 + index,
      rzmre: 3,
      rzche: 2,
      rzjmre: 1,
      rqye: 10,
      rqmcl: null,
      rqchl: null,
      rqyl: null,
      rzrqye: 110 + index,
      rzrqyl: null,
      syncedAt: new Date(),
    }))

    const summary = buildSummary(rows)
    expect(summary).toMatchObject({
      financingNetBuy5d: 5,
      financingNetBuy20d: 20,
      trend: 'UP',
    })
    expect(summary.financingBalanceChange20dPct).toBeCloseTo(19, 12)
  })

  it('[RELATIVE] 使用复利、样本统计与 NAV 峰值计算回撤', () => {
    const service = new RelativeStrengthCalculationService()
    const drawdown = service.calculate([
      { tradeDate: '2026-01-01', stockClose: 100, benchmarkClose: 100 },
      { tradeDate: '2026-01-02', stockClose: 110, benchmarkClose: 100 },
      { tradeDate: '2026-01-03', stockClose: 99, benchmarkClose: 100 },
    ])
    expect(drawdown.summary.stockTotalReturn).toBeCloseTo(-0.01, 12)
    expect(drawdown.summary.maxDrawdown).toBeCloseTo(-0.1, 12)
    expect(drawdown.summary.beta).toBeNull()

    const benchmarkReturns = Array.from({ length: 29 }, (_, index) =>
      index % 3 === 0 ? 0.01 : index % 3 === 1 ? -0.005 : 0.002,
    )
    let stock = 100
    let benchmark = 100
    const points = [{ tradeDate: '2026-01-01', stockClose: stock, benchmarkClose: benchmark }]
    benchmarkReturns.forEach((value, index) => {
      benchmark *= 1 + value
      stock *= 1 + value * 2
      points.push({
        tradeDate: `2026-01-${String(index + 2).padStart(2, '0')}`,
        stockClose: stock,
        benchmarkClose: benchmark,
      })
    })
    expect(service.calculate(points).summary.beta).toBeCloseTo(2, 10)
  })
})
