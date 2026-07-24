import { FactorScreeningRotationStrategy } from '../strategies/factor-screening-rotation.strategy'
import type { BacktestConfig, DailyBar } from '../types/backtest-engine.types'

describe('FactorScreeningRotationStrategy', () => {
  it('因子快照含池外高排名股票时，只从回测引擎已加载 universe 选股', async () => {
    const prisma = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([
        { ts_code: '600999.SH', value: 0.1 },
        { ts_code: '000001.SZ', value: 1 },
        { ts_code: '000002.SZ', value: 2 },
        { ts_code: '000003.SZ', value: 3 },
      ]),
    }
    const historicalBars = new Map<string, DailyBar[]>([
      ['000001.SZ', []],
      ['000002.SZ', []],
      ['000003.SZ', []],
    ])
    const config = {
      strategyType: 'FACTOR_SCREENING_ROTATION',
      strategyConfig: {
        conditions: [{ factorName: 'pe_ttm', operator: 'lte', value: 20 }],
        sortBy: 'pe_ttm',
        sortOrder: 'asc',
        topN: 2,
        weightMethod: 'equal_weight',
      },
    } as BacktestConfig<'FACTOR_SCREENING_ROTATION'>

    const result = await new FactorScreeningRotationStrategy().generateSignal(
      new Date('2026-07-06T00:00:00.000Z'),
      config,
      new Map(),
      historicalBars,
      prisma as never,
    )

    expect(result.targets.map((target) => target.tsCode)).toEqual(['000001.SZ', '000002.SZ'])
    expect(result.targets.map((target) => target.tsCode)).not.toContain('600999.SH')
    expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('ts_code = ANY($3::text[])')
    expect(prisma.$queryRawUnsafe.mock.calls[0][3]).toEqual(['000001.SZ', '000002.SZ', '000003.SZ'])
  })
})
