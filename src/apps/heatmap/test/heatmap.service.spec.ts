/**
 * HeatmapService — 单元测试
 *
 * 覆盖要点：
 * - getHeatmap(): industry / concept 维度返回 HeatmapItemDto[]
 * - resolveTradeDate(): 显式日期解析 / 无数据抛出 NotFoundException / 从 DB 取最新日期
 */
import { NotFoundException } from '@nestjs/common'
import { HeatmapService } from '../heatmap.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    $queryRaw: jest.fn(async () => []),
    daily: {
      findFirst: jest.fn(async () => null),
    },
  }
}

// ── 测试套件 ──────────────────────────────────────────────────────────────────

describe('HeatmapService', () => {
  let service: HeatmapService
  let mockPrisma: ReturnType<typeof buildPrismaMock>

  beforeEach(() => {
    mockPrisma = buildPrismaMock()
    service = new HeatmapService(mockPrisma as any)
  })

  // ── resolveTradeDate() ───────────────────────────────────────────────────

  describe('resolveTradeDate()', () => {
    it('显式传入 YYYYMMDD → 正确解析为本地 Date', async () => {
      const result = await service.resolveTradeDate('20240103')

      expect(result).toBeInstanceOf(Date)
      expect(result.getFullYear()).toBe(2024)
      expect(result.getMonth()).toBe(0) // 0-indexed
      expect(result.getDate()).toBe(3)
    })

    it('无日期且数据库无数据 → 抛出 NotFoundException', async () => {
      mockPrisma.daily.findFirst.mockResolvedValueOnce(null)

      await expect(service.resolveTradeDate()).rejects.toThrow(NotFoundException)
    })

    it('无日期且数据库有数据 → 返回最新交易日', async () => {
      const latestDate = new Date('2024-01-05')
      mockPrisma.daily.findFirst.mockResolvedValueOnce({ tradeDate: latestDate })

      const result = await service.resolveTradeDate()

      expect(result).toEqual(latestDate)
    })
  })

  // ── getHeatmap() ─────────────────────────────────────────────────────────

  describe('getHeatmap()', () => {
    it('group_by=industry → 返回 HeatmapItemDto 数组（数据来自 $queryRaw）', async () => {
      const tradeDate = new Date('2024-01-02')
      mockPrisma.daily.findFirst.mockResolvedValueOnce({ tradeDate })
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { tsCode: '000001.SZ', name: '平安银行', groupName: '银行', pctChg: 1.5, totalMv: 500000, amount: 10000 },
        { tsCode: '000002.SZ', name: '万科A', groupName: '房地产', pctChg: -0.5, totalMv: 300000, amount: 5000 },
      ])

      const result = await service.getHeatmap({ group_by: 'industry' })

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        tsCode: '000001.SZ',
        name: '平安银行',
        groupName: '银行',
        pctChg: 1.5,
      })
      expect(result[0].industry).toBe('银行') // 向后兼容字段
    })

    it('$queryRaw 返回空数组 → getHeatmap 返回空数组', async () => {
      const tradeDate = new Date('2024-01-02')
      mockPrisma.daily.findFirst.mockResolvedValueOnce({ tradeDate })
      mockPrisma.$queryRaw.mockResolvedValueOnce([])

      const result = await service.getHeatmap({ group_by: 'industry' })

      expect(result).toHaveLength(0)
    })

    it('group_by=concept → 返回 HeatmapItemDto 数组', async () => {
      const tradeDate = new Date('2024-01-02')
      mockPrisma.daily.findFirst.mockResolvedValueOnce({ tradeDate })
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { tsCode: '885001.TI', name: '新能源', groupName: '新能源', pctChg: 2.0, totalMv: null, amount: null },
      ])

      const result = await service.getHeatmap({ group_by: 'concept' })

      expect(result).toHaveLength(1)
      expect(result[0].tsCode).toBe('885001.TI')
      expect(result[0].totalMv).toBeNull()
    })

    it('显式 trade_date → 不调用 daily.findFirst', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([])

      await service.getHeatmap({ trade_date: '20240102', group_by: 'industry' })

      expect(mockPrisma.daily.findFirst).not.toHaveBeenCalled()
    })

    it('每条结果包含 HeatmapItemDto 所有必需字段', async () => {
      const tradeDate = new Date('2024-01-02')
      mockPrisma.daily.findFirst.mockResolvedValueOnce({ tradeDate })
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        { tsCode: '000001.SZ', name: '平安银行', groupName: '银行', pctChg: 1.0, totalMv: 200000, amount: 8000 },
      ])

      const [item] = await service.getHeatmap({ group_by: 'industry' })

      expect(item).toHaveProperty('tsCode')
      expect(item).toHaveProperty('name')
      expect(item).toHaveProperty('groupName')
      expect(item).toHaveProperty('industry')
      expect(item).toHaveProperty('pctChg')
      expect(item).toHaveProperty('totalMv')
      expect(item).toHaveProperty('amount')
    })
  })
})
