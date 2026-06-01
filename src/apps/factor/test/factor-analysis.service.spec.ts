/**
 * FactorAnalysisService — 单元测试
 *
 * 覆盖要点：
 * - getIcAnalysis: 交易日不足 / 有效数据 / 已知相关系数（正向+负向手算验证） / 缓存命中
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

  describe('getIcAnalysis()', () => {
    const baseDto: FactorIcAnalysisDto = {
      factorName: 'pe',
      startDate: '20240101',
      endDate: '20240110',
      forwardDays: 1,
      icMethod: 'rank',
    }

    it('无交易日 → series 为空，icMean = 0', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([])
      const result = await service.getIcAnalysis(baseDto)
      expect(result.series).toHaveLength(0)
      expect(result.summary.icMean).toBe(0)
      expect(result.summary.icStd).toBe(0)
      expect(result.summary.icIr).toBe(0)
    })

    it('有因子数据 → series 被填充', async () => {
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ cal_date: new Date('2024-01-02') }, { cal_date: new Date('2024-01-03') }])
        .mockResolvedValueOnce([{ cal_date: new Date('2024-01-03') }])
        .mockResolvedValueOnce(FIVE_RETURNS)
        .mockResolvedValueOnce([])
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

    it('[手算验证] 完全负相关数据 → IC ≈ -1.0（因子值递增，收益递减）', async () => {
      // 5 只股票：因子值 [1,2,3,4,5]，收益 [0.05,0.04,0.03,0.02,0.01]
      // Rank 因子 = [1,2,3,4,5], Rank 收益 = [5,4,3,2,1]
      // d = [-4,-2,0,2,4] → Σd² = 40 → Spearman = 1-6*40/(5*24) = -1.0
      const REVERSED_RETURNS = [
        { ts_code: '000001.SZ', forward_return: 0.05 },
        { ts_code: '000002.SZ', forward_return: 0.04 },
        { ts_code: '000003.SZ', forward_return: 0.03 },
        { ts_code: '000004.SZ', forward_return: 0.02 },
        { ts_code: '000005.SZ', forward_return: 0.01 },
      ]
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ cal_date: new Date('2024-01-02') }, { cal_date: new Date('2024-01-03') }])
        .mockResolvedValueOnce([{ cal_date: new Date('2024-01-03') }])
        .mockResolvedValueOnce(REVERSED_RETURNS)
        .mockResolvedValueOnce([])
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(FIVE_STOCKS)
      const result = await service.getIcAnalysis(baseDto)
      expect(result.series[0].ic).toBeCloseTo(-1.0, 3)
    })

    it('缓存命中 → 直接返回缓存值，不调用 getRawFactorValuesForDate', async () => {
      const cached = {
        factorName: 'pe', forwardDays: 1, icMethod: 'rank',
        startDate: '20240101', endDate: '20240110',
        summary: { icMean: 0.05, icStd: 0.1, icIr: 0.5, icPositiveRate: 0.6, icAboveThreshold: 0.4, tStat: 1.2 },
        series: [{ tradeDate: '20240102', ic: 0.05, stockCount: 100 }],
      }
      mockCache.rememberJson.mockResolvedValueOnce(cached)
      const result = await service.getIcAnalysis(baseDto)
      expect(result).toEqual(cached)
      expect(mockCompute.getRawFactorValuesForDate).not.toHaveBeenCalled()
    })
  })

  describe('getQuantileAnalysis()', () => {
    const baseDto: FactorQuantileAnalysisDto = {
      factorName: 'pe', startDate: '20240101', endDate: '20240110', quantiles: 5, rebalanceDays: 5,
    }
    it('交易日数量不足（< 2）→ 抛出 NotFoundException', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([{ cal_date: new Date('2024-01-02') }])
      await expect(service.getQuantileAnalysis(baseDto)).rejects.toThrow(NotFoundException)
    })
    it('有足够交易日和因子数据 → 返回分组结果', async () => {
      const tradeDates = Array.from({ length: 10 }, (_, i) => ({ cal_date: new Date(2024, 0, i + 2) }))
      mockPrisma.$queryRaw.mockResolvedValueOnce(tradeDates)
      const fiveGroupStocks = [
        { tsCode: 'A', factorValue: 1 }, { tsCode: 'B', factorValue: 2 },
        { tsCode: 'C', factorValue: 3 }, { tsCode: 'D', factorValue: 4 }, { tsCode: 'E', factorValue: 5 },
      ]
      mockCompute.getRawFactorValuesForDate.mockResolvedValue(fiveGroupStocks)
      mockPrisma.$queryRaw.mockResolvedValue([])
      const result = await service.getQuantileAnalysis(baseDto)
      expect(result.groups).toHaveLength(5)
      expect(result.groups[0].group).toBe('Q1')
      expect(result.groups[4].group).toBe('Q5')
      expect(result.longShort).toBeDefined()
    })

    it('[手算验证] 3分位 6只股票 → 各组收益 + 多空与手算一致', async () => {
      // 6 只股票，因子值 1-6（递增），收益 0.12-0.02（递减）
      // Q1(底2): A+B → mean(0.12, 0.10) = 0.11
      // Q2(中2): C+D → mean(0.08, 0.06) = 0.07
      // Q3(顶2): E+F → mean(0.04, 0.02) = 0.03
      // 多空 = 0.03 - 0.11 = -0.08, 基准 = mean(全部) = 0.07
      const SIX_STOCKS = [
        { tsCode: 'A', factorValue: 1 }, { tsCode: 'B', factorValue: 2 },
        { tsCode: 'C', factorValue: 3 }, { tsCode: 'D', factorValue: 4 },
        { tsCode: 'E', factorValue: 5 }, { tsCode: 'F', factorValue: 6 },
      ]
      const SIX_RETURNS = [
        { ts_code: 'A', forward_return: 0.12 }, { ts_code: 'B', forward_return: 0.10 },
        { ts_code: 'C', forward_return: 0.08 }, { ts_code: 'D', forward_return: 0.06 },
        { ts_code: 'E', forward_return: 0.04 }, { ts_code: 'F', forward_return: 0.02 },
      ]

      // 2 个交易日，rebalanceDays=1 → 1 个调仓周期
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { cal_date: new Date('2024-01-02') },
        { cal_date: new Date('2024-01-03') },
      ])
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(SIX_STOCKS)
      mockPrisma.$queryRaw.mockResolvedValueOnce(SIX_RETURNS) // getAdjReturns

      const result = await service.getQuantileAnalysis({
        factorName: 'pe', startDate: '20240101', endDate: '20240110',
        quantiles: 3, rebalanceDays: 1,
      })

      expect(result.groups).toHaveLength(3)
      expect(result.groups[0].totalReturn).toBeCloseTo(0.11, 3)
      expect(result.groups[1].totalReturn).toBeCloseTo(0.07, 3)
      expect(result.groups[2].totalReturn).toBeCloseTo(0.03, 3)
      expect(result.longShort.totalReturn).toBeCloseTo(-0.08, 3)
      expect(result.benchmark.totalReturn).toBeCloseTo(0.07, 3)
    })

    it('[手算验证] 5分位 6只股票（不等分组）→ 多空收益正确', async () => {
      // 6 只股票分 5 组：size=floor(6/5)=1，最后组拿余数
      // Q1: [A]     → 0.12
      // Q2: [B]     → 0.10
      // Q3: [C]     → 0.08
      // Q4: [D]     → 0.06
      // Q5: [E,F]   → mean(0.04,0.02) = 0.03
      // 多空 = 0.03 - 0.12 = -0.09
      const SIX_STOCKS = [
        { tsCode: 'A', factorValue: 1 }, { tsCode: 'B', factorValue: 2 },
        { tsCode: 'C', factorValue: 3 }, { tsCode: 'D', factorValue: 4 },
        { tsCode: 'E', factorValue: 5 }, { tsCode: 'F', factorValue: 6 },
      ]
      const SIX_RETURNS = [
        { ts_code: 'A', forward_return: 0.12 }, { ts_code: 'B', forward_return: 0.10 },
        { ts_code: 'C', forward_return: 0.08 }, { ts_code: 'D', forward_return: 0.06 },
        { ts_code: 'E', forward_return: 0.04 }, { ts_code: 'F', forward_return: 0.02 },
      ]
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { cal_date: new Date('2024-01-02') }, { cal_date: new Date('2024-01-03') },
      ])
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(SIX_STOCKS)
      mockPrisma.$queryRaw.mockResolvedValueOnce(SIX_RETURNS)

      const result = await service.getQuantileAnalysis({
        factorName: 'pe', startDate: '20240101', endDate: '20240110',
        quantiles: 5, rebalanceDays: 1,
      })

      expect(result.groups).toHaveLength(5)
      expect(result.groups[0].totalReturn).toBeCloseTo(0.12, 3)
      expect(result.groups[4].totalReturn).toBeCloseTo(0.03, 3)
      expect(result.longShort.totalReturn).toBeCloseTo(-0.09, 3)
    })
  })

  describe('getDistribution()', () => {
    const baseDto: FactorDistributionDto = { factorName: 'pe', tradeDate: '20240101', bins: 10 }
    it('无因子数据 → stats 为 null，histogram 为空数组', async () => {
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce([])
      const result = await service.getDistribution(baseDto)
      expect(result.stats).toBeNull()
      expect(result.histogram).toEqual([])
    })
    it('正常因子数据 → stats 含 mean/median/std，histogram 有桶', async () => {
      const values = [
        { tsCode: 'A', factorValue: 1 }, { tsCode: 'B', factorValue: 2 }, { tsCode: 'C', factorValue: 3 },
        { tsCode: 'D', factorValue: 4 }, { tsCode: 'E', factorValue: 5 },
      ]
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(values)
      const result = await service.getDistribution(baseDto)
      expect(result.stats).toBeDefined()
      expect(result.stats!.mean).toBeCloseTo(3, 3)
      expect(result.stats!.median).toBe(3)
      expect(result.histogram).not.toHaveLength(0)
    })
  })

  describe('getDecayAnalysis()', () => {
    const baseDto: FactorDecayAnalysisDto = { factorName: 'pe', startDate: '20240101', endDate: '20240110' }
    it('无交易日 → 返回各持有期空数组', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([])
      const result = await service.getDecayAnalysis(baseDto)
      expect(result.results).toHaveLength(5)
    })
  })

  describe('getCorrelation()', () => {
    const baseDto: FactorCorrelationDto = { factorNames: ['pe', 'pb'], tradeDate: '20240101', method: 'spearman' }
    it('因子数据不足 → 矩阵元为 null', async () => {
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce([]).mockResolvedValueOnce([])
      const result = await service.getCorrelation(baseDto)
      expect(result.matrix).toHaveLength(2)
      expect(result.matrix[0][1]).toBeNull()
    })
    it('完全相同因子 → 相关性为 1', async () => {
      const identicalValues = [
        { tsCode: '000001.SZ', factorValue: 3 }, { tsCode: '000002.SZ', factorValue: 3 },
        { tsCode: '000003.SZ', factorValue: 3 }, { tsCode: '000004.SZ', factorValue: 3 }, { tsCode: '000005.SZ', factorValue: 3 },
      ]
      mockCompute.getRawFactorValuesForDate.mockResolvedValueOnce(identicalValues).mockResolvedValueOnce(identicalValues)
      const result = await service.getCorrelation(baseDto)
      expect(result.matrix[0][0]).toBe(1)
    })
  })
})