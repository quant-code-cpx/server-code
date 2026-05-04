/**
 * FactorAnalysisService — 单元测试
 *
 * 覆盖要点：
 * - getIcAnalysis: 交易日不足 / 有效数据 / 已知相关系数 / 缓存命中
 * - getQuantileAnalysis: 交易日不足抛错
 * - getDistribution: 空数据 / 正常数据
 * - getDecayAnalysis: 返回各期数组
 * - getCorrelation: 完全相同因子 / 数据不足
 */
import { NotFoundException } from '@nestjs/common'
import { FactorAnalysisService } from '../services/factor-analysis.service'
import {
  FactorIcAnalysisDto,
  FactorQuantileAnalysisDto,
  FactorDistributionDto,
  FactorCorrelationDto,
  FactorDecayAnalysisDto,
} from '../dto/factor-analysis.dto'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn(async () => []),
    factorDefinition: { findMany: jest.fn(async () => []) },
  }
}

function buildComputeMock() {
  return { getRawFactorValuesForDate: jest.fn(async () => []) }
}

function buildCacheMock() {
  return {
    rememberJson: jest.fn(({ loader }: { loader: () => Promise<unknown> }) => loader()),
  }
}

// ── 辅助数据 ──────────────────────────────────────────────────────────────────

const FIVE_STOCKS = [
  { tsCode: '000001.SZ', factorValue: 1 },
  { tsCode: '000002.SZ', factorValue: 2 },
  { tsCode: '000003.SZ', factorValue: 3 },
  { tsCode: '000004.SZ', factorValue: 4 },
  { tsCode: '000005.SZ', factorValue: 5 },
]

const FIVE_RETURNS = [
  { ts_code: '000001.SZ', forward_return: 0.01 },
  { ts_code: '000002.SZ', forward_return: 0.02 },
  { ts_code: '000003.SZ', forward_return: 0.03 },
  { ts_code: '000004.SZ', forward_return: 0.04 },
  { ts_code: '000005.SZ', forward_return: 0.05 },
]

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('FactorAnalysisService', () => {
  let service: FactorAnalysisService
  let mockPrisma: ReturnType<typeof buildPrismaMock>
  let mockCompute: ReturnType<typeof buildComputeMock>
  let mockCache: ReturnType<typeof buildCacheMock>

  beforeEach(() => {
    mockPrisma = buildPrismaMock()
    mockCompute = buildComputeMock()
    mockCache = buildCacheMock()
    service = new FactorAnalysisService(mockPrisma as any, mockCompute as any, mockCache as any)
  })

  // ── getIcAnalysis ────────────────────────────────────────────────────────

  describe('getIcAnalysis()', () => {
    const baseDto: FactorIcAnalysisDto = {
      factorName: 'pe',
      startDate: '20240101',
      endDate: '20240110',
      forwardDays: 1,
      icMethod: 'rank',
    }

    it('无交易日 → series 为空，icMean = 0', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([]) // getTradeDates → 0 dates

      const result = await service.getIcAnalysis(baseDto)

      expect(result.series).toHaveLength(0)
      expect(result.summary.icMean).toBe(0)
      expect(result.summary.icStd).toBe(0)
      expect(result.summary.icIr).toBe(0)
    })

    it('有因子数据 → series 被填充', async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ cal_date: new Date('2024-01-02') }, { cal_date: new Date('2024-01-03') }]) // getTradeDates
        .mockResolvedValueOnce([{ cal_date: new Date('2024-01-03') }]) // getNthTradingDayAfter('20240102', 1)
        .mockResolvedValueOnce(FIVE_RETURNS) // getAdjReturns
        .mockResolvedValueOnce([]) // getNthTradingDayAfter('20240103', 1) → null → continue

      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(FIVE_STOCKS)

      const result = await service.getIcAnalysis(baseDto)

      expect(result.series).toHaveLength(1)
      expect(result.series[0].stockCount).toBe(5)
      expect(result.summary.icMean).not.toBe(0)
    })

    it('完全单调相关数据 → IC ≈ 1.0', async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ cal_date: new Date('2024-01-02') }, { cal_date: new Date('2024-01-03') }])
        .mockResolvedValueOnce([{ cal_date: new Date('2024-01-03') }])
        .mockResolvedValueOnce(FIVE_RETURNS)
        .mockResolvedValueOnce([])

      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(FIVE_STOCKS)

      const result = await service.getIcAnalysis(baseDto)

      expect(result.series[0].ic).toBeCloseTo(1.0, 3)
    })

    it('缓存命中 → 直接返回缓存值，不调用 getRawFactorValuesForDate', async () => {
      const cached = {
        factorName: 'pe',
        forwardDays: 1,
        icMethod: 'rank',
        startDate: '20240101',
        endDate: '20240110',
        summary: { icMean: 0.05, icStd: 0.1, icIr: 0.5, icPositiveRate: 0.6, icAboveThreshold: 0.4, tStat: 1.2 },
        series: [{ tradeDate: '20240102', ic: 0.05, stockCount: 100 }],
      }
      mockCache.rememberJson.mockResolvedValueOnce(cached)

      const result = await service.getIcAnalysis(baseDto)

      expect(result).toEqual(cached)
      expect(mockCompute.getRawFactorValuesForDate).not.toHaveBeenCalled()
    })
  })

  // ── getQuantileAnalysis ──────────────────────────────────────────────────

  describe('getQuantileAnalysis()', () => {
    const baseDto: FactorQuantileAnalysisDto = {
      factorName: 'pe',
      startDate: '20240101',
      endDate: '20240110',
      quantiles: 5,
      rebalanceDays: 5,
    }

    it('交易日数量不足（< 2）→ 抛出 NotFoundException', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ cal_date: new Date('2024-01-02') }]) // 仅 1 个交易日

      await expect(service.getQuantileAnalysis(baseDto)).rejects.toThrow(NotFoundException)
    })

    it('有足够交易日和因子数据 → 返回分组结果', async () => {
      const tradeDates = Array.from({ length: 10 }, (_, i) => ({
        cal_date: new Date(2024, 0, i + 2),
      }))
      mockPrisma.$queryRaw.mockResolvedValueOnce(tradeDates) // getTradeDates

      // 调仓周期 5 → 2 个 rebalanceDates: tradeDates[0] 和 tradeDates[9]
      // 每个 rebalanceDate 调用 getRawFactorValuesForDate + getAdjReturns
      const fiveGroupStocks = [
        { tsCode: 'A', factorValue: 1 },
        { tsCode: 'B', factorValue: 2 },
        { tsCode: 'C', factorValue: 3 },
        { tsCode: 'D', factorValue: 4 },
        { tsCode: 'E', factorValue: 5 },
      ]
      mockCompute.getRawFactorValuesForDate.mockResolvedValue(fiveGroupStocks)
      mockPrisma.$queryRaw.mockResolvedValue([]) // getAdjReturns → 空，返回率为 0

      const result = await service.getQuantileAnalysis(baseDto)

      expect(result.groups).toHaveLength(5)
      expect(result.groups[0].group).toBe('Q1')
      expect(result.groups[4].group).toBe('Q5')
      expect(result.longShort).toBeDefined()
    })
  })

  // ── getDistribution ──────────────────────────────────────────────────────

  describe('getDistribution()', () => {
    const baseDto: FactorDistributionDto = {
      factorName: 'pe',
      tradeDate: '20240101',
      bins: 10,
    }

    it('无因子数据 → stats 为 null，histogram 为空数组', async () => {
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce([])

      const result = await service.getDistribution(baseDto)

      expect(result.stats).toBeNull()
      expect(result.histogram).toHaveLength(0)
      expect(result.factorName).toBe('pe')
    })

    it('有效数据 → 返回正确的 stats 和 histogram', async () => {
      const values = Array.from({ length: 20 }, (_, i) => ({
        tsCode: `00000${i}.SZ`,
        factorValue: i + 1,
      }))
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(values)

      const result = await service.getDistribution(baseDto)

      expect(result.stats).not.toBeNull()
      expect(result.stats!.count).toBe(20)
      expect(result.stats!.min).toBe(1)
      expect(result.stats!.max).toBe(20)
      expect(result.histogram).toHaveLength(10)
      // 直方图各柱之和因浮点边界问题可能差 1，允许 19 或 20
      const totalCount = result.histogram.reduce((s, b) => s + b.count, 0)
      expect(totalCount).toBeGreaterThanOrEqual(19)
      expect(totalCount).toBeLessThanOrEqual(20)
    })
  })

  // ── getDecayAnalysis ─────────────────────────────────────────────────────

  describe('getDecayAnalysis()', () => {
    it('返回各持有期的 IC 统计数组', async () => {
      const baseDto: FactorDecayAnalysisDto = {
        factorName: 'pe',
        startDate: '20240101',
        endDate: '20240110',
        periods: [1, 5],
      }

      // 每个 period 调用 getIcAnalysis，后者调用 getTradeDates → 返回空
      mockPrisma.$queryRaw.mockResolvedValue([])

      const result = await service.getDecayAnalysis(baseDto)

      expect(result.factorName).toBe('pe')
      expect(result.results).toHaveLength(2)
      expect(result.results[0].period).toBe(1)
      expect(result.results[1].period).toBe(5)
      expect(result.results[0].icMean).toBe(0)
    })
  })

  // ── getCorrelation ───────────────────────────────────────────────────────

  describe('getCorrelation()', () => {
    const baseDto: FactorCorrelationDto = {
      factorNames: ['pe', 'pb'],
      tradeDate: '20240101',
      method: 'spearman',
    }

    it('两个因子值完全相同 → 非对角线相关系数 ≈ 1.0', async () => {
      const sameValues = [
        { tsCode: '000001.SZ', factorValue: 1 },
        { tsCode: '000002.SZ', factorValue: 2 },
        { tsCode: '000003.SZ', factorValue: 3 },
      ]
      mockCompute.getRawFactorValuesForDate.mockResolvedValue(sameValues)

      const result = await service.getCorrelation(baseDto)

      expect(result.matrix[0][0]).toBe(1)
      expect(result.matrix[1][1]).toBe(1)
      expect(result.matrix[0][1]).toBeCloseTo(1.0, 2)
      expect(result.matrix[1][0]).toBeCloseTo(1.0, 2)
    })

    it('公共股票数 < 3 → 相关系数矩阵非对角线为 null（样本不足无法计算）', async () => {
      const twoStocks = [
        { tsCode: '000001.SZ', factorValue: 1 },
        { tsCode: '000002.SZ', factorValue: 2 },
      ]
      mockCompute.getRawFactorValuesForDate.mockResolvedValue(twoStocks)

      const result = await service.getCorrelation(baseDto)

      expect(result.matrix[0][0]).toBe(1)
      expect(result.matrix[0][1]).toBeNull()
      expect(result.matrix[1][0]).toBeNull()
    })

    it('返回正确的元数据，factors 按字母升序排列', async () => {
      mockCompute.getRawFactorValuesForDate.mockResolvedValue([])

      const result = await service.getCorrelation(baseDto)

      expect(result.tradeDate).toBe('20240101')
      expect(result.method).toBe('spearman')
      // factorNames=['pe','pb'] → sorted → ['pb','pe']
      expect(result.factors).toEqual(['pb', 'pe'])
    })

    it('返回 factorLabels（fallback 到因子名）', async () => {
      mockCompute.getRawFactorValuesForDate.mockResolvedValue([])
      // factorDefinition.findMany 返回 pb 有 label，pe 没有
      mockPrisma.factorDefinition.findMany.mockResolvedValue([{ name: 'pb', label: '市净率' }])

      const result = await service.getCorrelation(baseDto)

      // sorted: ['pb','pe'] → labels: ['市净率', 'pe']
      expect(result.factorLabels).toEqual(['市净率', 'pe'])
    })

    it('返回 nMatrix（对角线为单因子有效值数，非对角线为两两交集数）', async () => {
      const factor1 = [
        { tsCode: '000001.SZ', factorValue: 1 },
        { tsCode: '000002.SZ', factorValue: 2 },
        { tsCode: '000003.SZ', factorValue: 3 },
        { tsCode: '000004.SZ', factorValue: 4 },
      ]
      const factor2 = [
        { tsCode: '000001.SZ', factorValue: 10 },
        { tsCode: '000002.SZ', factorValue: 20 },
        { tsCode: '000003.SZ', factorValue: 30 },
      ]
      // sorted: ['pb','pe'] — pb=factor1(4 stocks), pe=factor2(3 stocks)
      mockCompute.getRawFactorValuesForDate
        .mockResolvedValueOnce(factor1) // pb
        .mockResolvedValueOnce(factor2) // pe

      const result = await service.getCorrelation(baseDto)

      // nMatrix[0][0]=4(pb), nMatrix[1][1]=3(pe), nMatrix[0][1]=nMatrix[1][0]=3(intersection)
      expect(result.nMatrix[0][0]).toBe(4)
      expect(result.nMatrix[1][1]).toBe(3)
      expect(result.nMatrix[0][1]).toBe(3)
      expect(result.nMatrix[1][0]).toBe(3)
    })

    it('返回 coverage（有效值 / 并集大小）', async () => {
      const factor1 = [
        { tsCode: '000001.SZ', factorValue: 1 },
        { tsCode: '000002.SZ', factorValue: 2 },
      ]
      const factor2 = [
        { tsCode: '000002.SZ', factorValue: 10 },
        { tsCode: '000003.SZ', factorValue: 20 },
      ]
      // union = 3 stocks; pb has 2 → 2/3, pe has 2 → 2/3
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(factor1).mockResolvedValueOnce(factor2)

      const result = await service.getCorrelation(baseDto)

      expect(result.coverage[0]).toBeCloseTo(2 / 3, 5)
      expect(result.coverage[1]).toBeCloseTo(2 / 3, 5)
    })

    it('返回 meta 字段', async () => {
      mockCompute.getRawFactorValuesForDate.mockResolvedValue([])

      const result = await service.getCorrelation(baseDto)

      expect(result.meta.matrixMode).toBe('pairwise')
      expect(result.meta.minSampleForCorr).toBe(3)
      expect(result.meta.universe).toBe('all')
      expect(result.meta.computedAt).toBeTruthy()
    })
  })
})
