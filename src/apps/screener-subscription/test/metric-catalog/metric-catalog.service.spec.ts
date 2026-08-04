import { MetricCatalogService } from '../../metric-catalog/metric-catalog.service'
import { PrismaService } from 'src/shared/prisma.service'

describe('MetricCatalogService', () => {
  it('为基础选股指标声明执行器可消费的筛选字段，并输出已启用因子目录', async () => {
    const prisma = {
      factorDefinition: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ name: 'pe_ttm', label: '市盈率', description: null, category: 'VALUATION' }]),
      },
    }
    const service = new MetricCatalogService(prisma as unknown as PrismaService)
    const stockCatalog = await service.list(['STOCK'])
    const fullCatalog = await service.list()

    expect(stockCatalog.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'valuation.peTtm', filterKey: 'minPeTtm' }),
        expect.objectContaining({ id: 'technical.macd', filterKey: 'macdSignal' }),
      ]),
    )
    expect(fullCatalog.metrics).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'pe_ttm', source: 'FACTOR', availability: 'ENABLED' })]),
    )
    expect(fullCatalog.catalogVersion).toMatch(/^catalog-v1-/)
  })
})
