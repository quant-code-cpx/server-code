import { FundService } from '../fund.service'
import { FundInstitutionalSummaryQueryDto } from '../dto/fund-institutional-summary-query.dto'
import { FundEtfFlowQueryDto } from '../dto/fund-etf-flow-query.dto'

function buildPrismaMock() {
  return {
    fundPortfolio: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    fundShare: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    fundBasic: { findMany: jest.fn(async () => []) },
  }
}

function createService(prismaMock = buildPrismaMock()) {
  return new FundService(prismaMock as any)
}

describe('FundService', () => {
  describe('getInstitutionalSummary()', () => {
    it('[手算验证] 多只基金同持一只股票 → 正确聚合 mkv/amount/avgRatio', async () => {
      const prisma = buildPrismaMock()
      prisma.fundPortfolio.findMany.mockResolvedValue([
        { tsCode: 'F1', endDate: new Date('2024-06-30'), annDate: new Date('2024-08-01'), symbol: '000001', mkv: 1000, amount: 100, stkMkvRatio: 0.05, stkFloatRatio: 0.03 },
        { tsCode: 'F2', endDate: new Date('2024-06-30'), annDate: new Date('2024-08-01'), symbol: '000001', mkv: 2000, amount: 200, stkMkvRatio: 0.08, stkFloatRatio: 0.05 },
        { tsCode: 'F3', endDate: new Date('2024-06-30'), annDate: new Date('2024-08-01'), symbol: '000001', mkv: 3000, amount: 300, stkMkvRatio: 0.10, stkFloatRatio: 0.07 },
      ])
      prisma.fundBasic.findMany.mockResolvedValue([
        { tsCode: 'F1', name: '基金A' }, { tsCode: 'F2', name: '基金B' }, { tsCode: 'F3', name: '基金C' },
      ])
      const svc = createService(prisma)
      const result = await svc.getInstitutionalSummary({ end_date: '20240630' } as FundInstitutionalSummaryQueryDto)
      expect(result).toHaveLength(1)
      expect(result[0].symbol).toBe('000001')
      expect(result[0].fund_count).toBe(3)
      expect(result[0].total_mkv).toBe(6000)
      expect(result[0].total_amount).toBe(600)
      expect(result[0].avg_stk_float_ratio).toBeCloseTo(0.05, 5)
      expect(result[0].holders).toHaveLength(3)
    })

    it('[手算验证] 多只股票 → 按 total_mkv 降序排列', async () => {
      const prisma = buildPrismaMock()
      prisma.fundPortfolio.findMany.mockResolvedValue([
        { tsCode: 'F1', endDate: new Date('2024-06-30'), annDate: new Date('2024-08-01'), symbol: 'S1', mkv: 1000, amount: 100, stkMkvRatio: 0.05, stkFloatRatio: 0.03 },
        { tsCode: 'F2', endDate: new Date('2024-06-30'), annDate: new Date('2024-08-01'), symbol: 'S2', mkv: 5000, amount: 500, stkMkvRatio: 0.08, stkFloatRatio: 0.05 },
        { tsCode: 'F3', endDate: new Date('2024-06-30'), annDate: new Date('2024-08-01'), symbol: 'S3', mkv: 3000, amount: 300, stkMkvRatio: 0.10, stkFloatRatio: 0.07 },
      ])
      prisma.fundBasic.findMany.mockResolvedValue([
        { tsCode: 'F1', name: 'A' }, { tsCode: 'F2', name: 'B' }, { tsCode: 'F3', name: 'C' },
      ])
      const svc = createService(prisma)
      const result = await svc.getInstitutionalSummary({ end_date: '20240630' } as FundInstitutionalSummaryQueryDto)
      expect(result).toHaveLength(3)
      expect(result[0].symbol).toBe('S2')
      expect(result[1].symbol).toBe('S3')
      expect(result[2].symbol).toBe('S1')
    })
  })

  describe('getEtfFlow()', () => {
    it('[手算验证] 连续两天份额变化 → delta + 流向正确', async () => {
      const prisma = buildPrismaMock()
      prisma.fundShare.findFirst.mockResolvedValue({ tradeDate: new Date('2024-01-02') })
      prisma.fundShare.findMany.mockResolvedValue([
        { tsCode: 'ETF1', tradeDate: new Date('2024-01-01'), fdShare: 1000 },
        { tsCode: 'ETF1', tradeDate: new Date('2024-01-02'), fdShare: 1500 },
      ])
      prisma.fundBasic.findMany.mockResolvedValue([{ tsCode: 'ETF1', name: 'ETF基金' }])
      const svc = createService(prisma)
      const result = await svc.getEtfFlow({} as FundEtfFlowQueryDto)
      expect(result).toHaveLength(2)
      expect(result[0].flow_direction).toBe('flat')
      expect(result[1].flow_direction).toBe('inflow')
    })

    it('[手算验证] 份额减少 → outflow', async () => {
      const prisma = buildPrismaMock()
      prisma.fundShare.findFirst.mockResolvedValue({ tradeDate: new Date('2024-01-02') })
      prisma.fundShare.findMany.mockResolvedValue([
        { tsCode: 'ETF1', tradeDate: new Date('2024-01-01'), fdShare: 2000 },
        { tsCode: 'ETF1', tradeDate: new Date('2024-01-02'), fdShare: 1800 },
      ])
      prisma.fundBasic.findMany.mockResolvedValue([{ tsCode: 'ETF1', name: 'ETF' }])
      const svc = createService(prisma)
      const result = await svc.getEtfFlow({} as FundEtfFlowQueryDto)
      expect(result[1].flow_direction).toBe('outflow')
    })
  })
})