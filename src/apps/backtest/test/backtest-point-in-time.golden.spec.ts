import { BacktestDataService } from '../services/backtest-data.service'
import { PointInTimeFinancialService } from '../services/point-in-time-financial.service'
import { PointInTimeUniverseService } from '../services/point-in-time-universe.service'
import { BacktestEngineService } from '../services/backtest-engine.service'
import { FactorRankingStrategy } from '../strategies/factor-ranking.strategy'
import { ScreeningRotationStrategy } from '../strategies/screening-rotation.strategy'
import type { BacktestConfig, DailyBar } from '../types/backtest-engine.types'
import { isVerifiedBacktestCreationEnabled } from '../constants/backtest-reproducibility.constant'

function historicalBars(...codes: string[]): Map<string, DailyBar[]> {
  return new Map(codes.map((code) => [code, []]))
}

describe('Batch 029 point-in-time golden cases', () => {
  it('新回测门禁默认开启，显式 false 可暂停所有新运行入口', () => {
    expect(isVerifiedBacktestCreationEnabled({})).toBe(true)
    expect(isVerifiedBacktestCreationEnabled({ BACKTEST_REQUIRE_VERIFIED_DATA: 'true' })).toBe(true)
    expect(isVerifiedBacktestCreationEnabled({ BACKTEST_REQUIRE_VERIFIED_DATA: 'FALSE' })).toBe(false)
  })

  it('engine 在调仓与 T+1 执行前重新解析 universe，退出成员不可买入，新成员加载历史窗口', async () => {
    const dates = ['2020-01-02', '2020-01-03', '2020-01-06'].map((date) => new Date(`${date}T00:00:00.000Z`))
    const buildBar = (tsCode: string, date: Date): DailyBar => ({
      tsCode,
      tradeDate: date,
      open: 10,
      high: 10,
      low: 10,
      close: 10,
      preClose: 10,
      vol: 100,
      adjFactor: 1,
      upLimit: null,
      downLimit: null,
      isSuspended: false,
      adjClose: 10,
      adjOpen: 10,
      adjHigh: 10,
      adjLow: 10,
    })
    const loadDailyBars = jest.fn(
      async (codes: string[]) =>
        new Map(
          codes.map((code) => [
            code,
            new Map(dates.map((date) => [date.toISOString().slice(0, 10), buildBar(code, date)])),
          ]),
        ),
    )
    const dataService = {
      getTradingDays: jest.fn().mockResolvedValue(dates),
      loadDailyBars,
      loadBenchmarkBars: jest
        .fn()
        .mockResolvedValue(new Map(dates.map((date) => [date.toISOString().slice(0, 10), 100]))),
    }
    const pointInTimeUniverse = {
      resolve: jest.fn(async (_config: BacktestConfig, date: Date) => {
        const members = date <= dates[0] ? ['A', 'B'] : ['B', 'C']
        return {
          date: date.toISOString().slice(0, 10),
          members,
          source: 'INDEX:TEST',
          version: 'pit-universe-v1',
          hash: members.join('-'),
        }
      }),
    }
    const generateSignal = jest.fn(async (_date, _config, _bars, history: Map<string, DailyBar[]>) => ({
      targets: [...history.keys()].map((tsCode) => ({ tsCode })),
    }))
    const strategyRegistry = { getStrategy: jest.fn(() => ({ generateSignal })) }
    const executedSignals: string[][] = []
    const executionService = {
      executeTrades: jest.fn((_portfolio, signal, _bars, _config, signalDate, executeDate) => {
        executedSignals.push(signal.targets.map((target: { tsCode: string }) => target.tsCode))
        return {
          trades: [],
          rebalanceLog: {
            signalDate,
            executeDate,
            targetCount: signal.targets.length,
            executedBuyCount: 0,
            executedSellCount: 0,
            skippedLimitCount: 0,
            skippedSuspendCount: 0,
            message: null,
          },
        }
      }),
    }
    const metricsService = {
      computeMetrics: jest.fn(() => ({
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
      })),
    }
    const engine = new BacktestEngineService(
      {} as never,
      dataService as never,
      executionService as never,
      metricsService as never,
      strategyRegistry as never,
      pointInTimeUniverse as never,
    )
    const config = {
      runId: 'run-pit',
      strategyType: 'FACTOR_RANKING',
      strategyConfig: { factorName: 'roe' },
      startDate: dates[0],
      endDate: dates[2],
      benchmarkTsCode: '000300.SH',
      universe: 'HS300',
      initialCapital: 100_000,
      rebalanceFrequency: 'DAILY',
      priceMode: 'NEXT_OPEN',
      commissionRate: 0,
      stampDutyRate: 0,
      minCommission: 0,
      slippageBps: 0,
      maxPositions: 10,
      maxWeightPerStock: 1,
      minDaysListed: 0,
      enableTradeConstraints: false,
      enableT1Restriction: true,
      partialFillEnabled: true,
    } as BacktestConfig

    const result = await engine.runBacktest(config)

    expect(executedSignals).toEqual([['B'], ['B', 'C']])
    expect(loadDailyBars.mock.calls.map(([codes]) => codes)).toEqual([['A', 'B'], ['C']])
    expect(result.reproducibilityManifest).toMatchObject({
      universePolicyVersion: 'pit-universe-v1',
      qualityFlags: [],
    })
    expect(result.reproducibilityManifest?.inputHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('engine 在任一日期解析到空股票池时 fail closed，不生成伪 VERIFIED 结果', async () => {
    const date = new Date('2020-01-02T00:00:00.000Z')
    const engine = new BacktestEngineService(
      {} as never,
      {
        getTradingDays: jest.fn().mockResolvedValue([date]),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        resolve: jest.fn().mockResolvedValue({
          date: '2020-01-02',
          members: [],
          source: 'INDEX:000300.SH',
          version: 'pit-universe-v1',
          hash: 'empty',
        }),
      } as never,
    )

    await expect(
      engine.runBacktest({
        runId: 'run-empty-universe',
        strategyType: 'FACTOR_RANKING',
        strategyConfig: { factorName: 'roe' },
        startDate: date,
        endDate: date,
        benchmarkTsCode: '000300.SH',
        universe: 'HS300',
        initialCapital: 100_000,
        rebalanceFrequency: 'DAILY',
        priceMode: 'NEXT_OPEN',
        commissionRate: 0,
        stampDutyRate: 0,
        minCommission: 0,
        slippageBps: 0,
        maxPositions: 10,
        maxWeightPerStock: 1,
        minDaysListed: 0,
        enableTradeConstraints: false,
        enableT1Restriction: true,
        partialFillEnabled: true,
      }),
    ).rejects.toThrow('指定日期无可用的点时股票池快照')
  })

  describe('PointInTimeUniverseService', () => {
    it('ALL_A 使用历史 list/delist 日期，不使用当前 listStatus', async () => {
      const prisma = {
        stockBasic: {
          findMany: jest.fn().mockResolvedValue([{ tsCode: '000001.SZ' }, { tsCode: '600001.SH' }]),
        },
      }
      const service = new PointInTimeUniverseService(prisma as never)
      const config = {
        universe: 'ALL_A',
        minDaysListed: 60,
      } as BacktestConfig
      const signalDate = new Date('2020-06-30T00:00:00.000Z')

      const snapshot = await service.resolve(config, signalDate)

      expect(snapshot.members).toEqual(['000001.SZ', '600001.SH'])
      const where = prisma.stockBasic.findMany.mock.calls[0][0].where
      expect(where.listStatus).toBeUndefined()
      expect(where.listDate.lte.toISOString()).toBe('2020-05-01T00:00:00.000Z')
      expect(where.OR).toEqual([{ delistDate: null }, { delistDate: { gt: signalDate } }])
    })

    it('指数每个有效快照全量替换：退出成员消失，新成员加入', async () => {
      const prisma = {
        indexWeight: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ tradeDate: '20200131' })
            .mockResolvedValueOnce({ tradeDate: '20200228' }),
          findMany: jest
            .fn()
            .mockResolvedValueOnce([{ conCode: 'A' }, { conCode: 'B' }])
            .mockResolvedValueOnce([{ conCode: 'B' }, { conCode: 'C' }]),
        },
      }
      const service = new PointInTimeUniverseService(prisma as never)
      const config = { universe: 'HS300' } as BacktestConfig

      const january = await service.resolve(config, new Date('2020-02-03T00:00:00.000Z'))
      const march = await service.resolve(config, new Date('2020-03-02T00:00:00.000Z'))

      expect(january.members).toEqual(['A', 'B'])
      expect(march.members).toEqual(['B', 'C'])
      expect(march.members).not.toContain('A')
    })
  })

  describe('PointInTimeFinancialService', () => {
    it('财务指标只选择 signalDate 当日及以前公告版本', async () => {
      const prisma = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([
          {
            ts_code: '000001.SZ',
            value: 12.5,
            end_date: new Date('2019-12-31T00:00:00.000Z'),
            ann_date: new Date('2020-04-20T00:00:00.000Z'),
          },
        ]),
      }
      const service = new PointInTimeFinancialService(prisma as never)

      const result = await service.loadLatestVisibleMetric('roe', new Date('2020-04-30T00:00:00.000Z'), ['000001.SZ'])

      expect(result.get('000001.SZ')).toMatchObject({
        value: 12.5,
        announcementDate: new Date('2020-04-20T00:00:00.000Z'),
      })
      const [sql, universe, cutoff] = prisma.$queryRawUnsafe.mock.calls[0]
      expect(sql).toContain('fi.ann_date <= $2::date')
      expect(sql).toMatch(/ORDER BY[\s\S]*fi\.ts_code,[\s\S]*fi\.end_date DESC,[\s\S]*fi\.ann_date DESC/)
      expect(sql).toContain("(fi.update_flag = '1') DESC")
      expect(universe).toEqual(['000001.SZ'])
      expect(cutoff).toBe('2020-04-30')
    })
  })

  describe('strategy universe intersection', () => {
    it('SCREENING_ROTATION 在 LIMIT 前把查询限定到传入 universe', async () => {
      const prisma = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ ts_code: '000001.SZ' }]),
      }
      const strategy = new ScreeningRotationStrategy()
      const config = {
        strategyType: 'SCREENING_ROTATION',
        strategyConfig: { rankBy: 'totalMv', topN: 1 },
      } as BacktestConfig<'SCREENING_ROTATION'>

      const result = await strategy.generateSignal(
        new Date('2020-06-30T00:00:00.000Z'),
        config,
        new Map(),
        historicalBars('000001.SZ'),
        prisma as never,
      )

      expect(result.targets).toEqual([{ tsCode: '000001.SZ' }])
      expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('db.ts_code = ANY($2::text[])')
      expect(prisma.$queryRawUnsafe.mock.calls[0][2]).toEqual(['000001.SZ'])
    })

    it('FACTOR_RANKING 财务因子使用公告日服务并只返回池内证券', async () => {
      const prisma = {
        $queryRawUnsafe: jest.fn().mockResolvedValue([
          {
            ts_code: '000002.SZ',
            value: 20,
            end_date: new Date('2019-12-31T00:00:00.000Z'),
            ann_date: new Date('2020-04-01T00:00:00.000Z'),
          },
          {
            ts_code: '000001.SZ',
            value: 10,
            end_date: new Date('2019-12-31T00:00:00.000Z'),
            ann_date: new Date('2020-04-01T00:00:00.000Z'),
          },
        ]),
      }
      const strategy = new FactorRankingStrategy()
      const config = {
        strategyType: 'FACTOR_RANKING',
        strategyConfig: { factorName: 'roe', rankOrder: 'desc', topN: 1 },
      } as BacktestConfig<'FACTOR_RANKING'>

      const result = await strategy.generateSignal(
        new Date('2020-04-30T00:00:00.000Z'),
        config,
        new Map(),
        historicalBars('000001.SZ', '000002.SZ'),
        prisma as never,
      )

      expect(result.targets).toEqual([{ tsCode: '000002.SZ' }])
      expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain('fi.ann_date <= $2::date')
    })
  })

  describe('QFQ and deterministic adjustment ordering', () => {
    it.each([
      [
        [
          { tsCode: '000001.SZ', tradeDate: new Date('2020-01-02T00:00:00.000Z'), adjFactor: 1 },
          { tsCode: '000001.SZ', tradeDate: new Date('2020-01-03T00:00:00.000Z'), adjFactor: 2 },
        ],
      ],
      [
        [
          { tsCode: '000001.SZ', tradeDate: new Date('2020-01-03T00:00:00.000Z'), adjFactor: 2 },
          { tsCode: '000001.SZ', tradeDate: new Date('2020-01-02T00:00:00.000Z'), adjFactor: 1 },
        ],
      ],
    ])('QFQ=price*factor/latestAdj，结果不依赖 mock 返回顺序', async (adjRows) => {
      const prisma = {
        daily: {
          findMany: jest.fn().mockResolvedValue([
            {
              tsCode: '000001.SZ',
              tradeDate: new Date('2020-01-02T00:00:00.000Z'),
              open: 10,
              high: 10,
              low: 10,
              close: 10,
              preClose: 10,
              vol: 100,
            },
            {
              tsCode: '000001.SZ',
              tradeDate: new Date('2020-01-03T00:00:00.000Z'),
              open: 20,
              high: 20,
              low: 20,
              close: 20,
              preClose: 10,
              vol: 100,
            },
          ]),
        },
        adjFactor: { findMany: jest.fn().mockResolvedValue(adjRows) },
        stkLimit: { findMany: jest.fn().mockResolvedValue([]) },
        suspendD: { findMany: jest.fn().mockResolvedValue([]) },
      }
      const service = new BacktestDataService(prisma as never)

      const result = await service.loadDailyBars(
        ['000001.SZ'],
        new Date('2020-01-01T00:00:00.000Z'),
        new Date('2020-01-03T00:00:00.000Z'),
      )

      expect(result.get('000001.SZ')?.get('2020-01-02')?.adjClose).toBe(5)
      expect(result.get('000001.SZ')?.get('2020-01-03')?.adjClose).toBe(20)
      expect(prisma.adjFactor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: [{ tsCode: 'asc' }, { tradeDate: 'asc' }] }),
      )
    })
  })
})
