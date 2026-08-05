import { FactorSourceType } from '@prisma/client'
import { FactorAnalysisToolFacade } from '../factor-analysis-tool.facade'

describe('FactorAnalysisToolFacade', () => {
  const definition = {
    name: 'pe_ttm',
    label: '市盈率TTM',
    category: 'VALUATION',
    sourceType: FactorSourceType.FIELD_REF,
    sourceTable: 'DailyBasic',
    sourceField: 'pe_ttm',
    expression: null,
    params: null,
    isBuiltin: true,
    isEnabled: true,
  }
  const prisma = {
    factorDefinition: { findMany: jest.fn(async () => [definition]) },
    $queryRaw: jest.fn(async () => [{ trade_date: '20260724' }]),
  }
  const compute = {
    getFactorValues: jest.fn(async () => ({ total: 100, page: 1, pageSize: 20, items: [], summary: {} })),
  }
  const analysis = {
    getDistribution: jest.fn(),
    getCorrelation: jest.fn(),
    getIcAnalysis: jest.fn(async () => ({ series: [{ stockCount: 80 }] })),
    getQuantileAnalysis: jest.fn(),
    getDecayAnalysis: jest.fn(),
  }
  const facade = new FactorAnalysisToolFacade(prisma as never, compute as never, analysis as never)

  beforeEach(() => jest.clearAllMocks())

  it('VALUES 只读取启用内置因子，并使用不晚于 asOf 的共同快照', async () => {
    prisma.factorDefinition.findMany.mockResolvedValueOnce([definition] as never)
    prisma.$queryRaw.mockResolvedValueOnce([{ trade_date: '20260724' }] as never)
    const result = await facade.analyze({
      analysis: 'VALUES',
      factorNames: ['pe_ttm'],
      asOfDate: '2026-07-30',
      page: 1,
      pageSize: 20,
    })

    expect(result.data).toMatchObject({ analysis: 'VALUES', dataThrough: '2026-07-24', sampleCount: 100 })
    expect(compute.getFactorValues).toHaveBeenCalledWith(
      expect.objectContaining({ factorName: 'pe_ttm', tradeDate: '20260724' }),
      FactorSourceType.FIELD_REF,
      'pe_ttm',
    )
  })

  it('IC 数据水位使用分析 endDate，不冒充最新快照日', async () => {
    prisma.factorDefinition.findMany.mockResolvedValueOnce([definition] as never)
    const result = await facade.analyze({
      analysis: 'IC',
      factorNames: ['pe_ttm'],
      startDate: '2026-01-01',
      endDate: '2026-06-30',
      forwardDays: 5,
    })
    expect(result.data).toMatchObject({ dataThrough: '2026-06-30', sampleCount: 80 })
  })

  it('QUANTILE 样本数取各组平均有效样本数的最大值', async () => {
    prisma.factorDefinition.findMany.mockResolvedValueOnce([definition] as never)
    analysis.getQuantileAnalysis.mockResolvedValueOnce({
      groups: [{ averageSampleCount: 19.5 }, { averageSampleCount: 20.4 }],
    } as never)

    const result = await facade.analyze({
      analysis: 'QUANTILE',
      factorNames: ['pe_ttm'],
      startDate: '2026-01-01',
      endDate: '2026-06-30',
    })

    expect(result.data).toMatchObject({ dataThrough: '2026-06-30', sampleCount: 20 })
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })

  it('按 analysis 严格拒绝无关字段，不能静默改变语义', async () => {
    await expect(facade.analyze({ analysis: 'VALUES', factorNames: ['pe_ttm'], forwardDays: 5 })).rejects.toMatchObject(
      { code: 'INVALID_ARGUMENT' },
    )
    expect(prisma.factorDefinition.findMany).not.toHaveBeenCalled()
  })

  it('自定义或未启用因子不能进入分析服务', async () => {
    prisma.factorDefinition.findMany.mockResolvedValueOnce([])
    await expect(facade.analyze({ analysis: 'VALUES', factorNames: ['custom_factor'] })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    })
    expect(compute.getFactorValues).not.toHaveBeenCalled()
  })
})
