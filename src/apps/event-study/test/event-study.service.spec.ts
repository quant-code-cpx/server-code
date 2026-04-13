/**
 * EventStudyService — 单元测试
 *
 * 覆盖要点：
 * - getEventTypes(): 返回所有事件类型配置
 * - queryEvents(): 各事件类型路由到正确的 Prisma 模型
 * - extractEventSamples(): 事件样本提取与日期转换
 * - analyze(): 完整事件研究流程（AR/AAR/CAAR/tTest）
 * - 私有方法通过 analyze() 的输出间接验证
 */

import { EventStudyService } from '../event-study.service'
import { EventType } from '../event-type.registry'
import { EventStudyAnalyzeDto } from '../dto/event-study-analyze.dto'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    forecast: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    dividend: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    stkHolderTrade: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    shareFloat: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    repurchase: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    finaAudit: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    disclosureDate: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
    },
    tradeCal: {
      findMany: jest.fn(async () => []),
    },
    indexDaily: {
      findMany: jest.fn(async () => []),
    },
    daily: {
      findMany: jest.fn(async () => []),
    },
    stockBasic: {
      findMany: jest.fn(async () => []),
    },
  }
}

function createService(prismaMock = buildPrismaMock()) {
  return new EventStudyService(prismaMock as any)
}

// ── 数据构造助手 ───────────────────────────────────────────────────────────────

/** 生成 n 个连续交易日（从 startDate 起） */
function makeTradeDays(startDate: string, n: number) {
  const result: { calDate: Date; exchange: string; isOpen: string }[] = []
  const d = new Date(startDate)
  for (let i = 0; i < n; i++) {
    const day = new Date(d)
    day.setUTCDate(day.getUTCDate() + i)
    result.push({ calDate: day, exchange: 'SSE', isOpen: '1' })
  }
  return result
}

/** 构造带 pctChg 的 daily 行 */
function makeDailyRow(tsCode: string, tradeDateStr: string, pctChg: number) {
  return { tsCode, tradeDate: new Date(tradeDateStr), pctChg }
}

/** 构造带 pctChg 的 indexDaily 行 */
function makeIndexRow(tradeDateStr: string, pctChg: number) {
  return { tradeDate: new Date(tradeDateStr), pctChg }
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('EventStudyService', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── getEventTypes() ──────────────────────────────────────────────────────

  describe('getEventTypes()', () => {
    it('返回所有支持的事件类型配置', () => {
      const svc = createService()
      const types = svc.getEventTypes()

      expect(types).toHaveLength(Object.values(EventType).length)
    })

    it('每个事件类型配置包含 type / label / description', () => {
      const svc = createService()
      const types = svc.getEventTypes()

      types.forEach((t) => {
        expect(t).toHaveProperty('type')
        expect(t).toHaveProperty('label')
        expect(t).toHaveProperty('description')
      })
    })

    it('FORECAST 事件类型有正确的 label', () => {
      const svc = createService()
      const types = svc.getEventTypes()
      const forecast = types.find((t) => t.type === EventType.FORECAST)

      expect(forecast).toBeDefined()
      expect(forecast!.label).toBe('业绩预告')
    })
  })

  // ── queryEvents() ─────────────────────────────────────────────────────────

  describe('queryEvents()', () => {
    it('FORECAST → 查询 forecast 模型', async () => {
      const prisma = buildPrismaMock()
      prisma.forecast.count.mockResolvedValue(2)
      prisma.forecast.findMany.mockResolvedValue([{ tsCode: '000001.SZ', annDate: new Date('2024-01-15') }] as any)
      const svc = createService(prisma)

      const result = await svc.queryEvents({
        eventType: EventType.FORECAST,
        startDate: '20240101',
        endDate: '20240131',
      })

      expect(result.total).toBe(2)
      expect(result.items).toHaveLength(1)
      expect(prisma.forecast.findMany).toHaveBeenCalledTimes(1)
    })

    it('DIVIDEND_EX → 查询 dividend 模型', async () => {
      const prisma = buildPrismaMock()
      prisma.dividend.count.mockResolvedValue(1)
      prisma.dividend.findMany.mockResolvedValue([{ tsCode: '000002.SZ', exDate: new Date('2024-01-10') }] as any)
      const svc = createService(prisma)

      const result = await svc.queryEvents({ eventType: EventType.DIVIDEND_EX })

      expect(prisma.dividend.findMany).toHaveBeenCalledTimes(1)
      expect(result.total).toBe(1)
    })

    it('HOLDER_INCREASE → 查询 stkHolderTrade 模型（inDe=IN）', async () => {
      const prisma = buildPrismaMock()
      prisma.stkHolderTrade.count.mockResolvedValue(3)
      prisma.stkHolderTrade.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.queryEvents({ eventType: EventType.HOLDER_INCREASE })

      expect(prisma.stkHolderTrade.findMany).toHaveBeenCalledTimes(1)
      const callArgs = (prisma.stkHolderTrade.findMany.mock.calls[0] as any)[0]
      expect(callArgs.where.inDe).toBe('IN')
    })

    it('HOLDER_DECREASE → 查询 stkHolderTrade（inDe=DE）', async () => {
      const prisma = buildPrismaMock()
      prisma.stkHolderTrade.count.mockResolvedValue(0)
      prisma.stkHolderTrade.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.queryEvents({ eventType: EventType.HOLDER_DECREASE })

      const callArgs = (prisma.stkHolderTrade.findMany.mock.calls[0] as any)[0]
      expect(callArgs.where.inDe).toBe('DE')
    })

    it('SHARE_FLOAT → 查询 shareFloat 模型', async () => {
      const prisma = buildPrismaMock()
      prisma.shareFloat.count.mockResolvedValue(0)
      prisma.shareFloat.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.queryEvents({ eventType: EventType.SHARE_FLOAT })

      expect(prisma.shareFloat.findMany).toHaveBeenCalledTimes(1)
    })

    it('REPURCHASE → 查询 repurchase 模型', async () => {
      const prisma = buildPrismaMock()
      prisma.repurchase.count.mockResolvedValue(0)
      prisma.repurchase.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.queryEvents({ eventType: EventType.REPURCHASE })

      expect(prisma.repurchase.findMany).toHaveBeenCalledTimes(1)
    })

    it('AUDIT_QUALIFIED → 查询 finaAudit 模型', async () => {
      const prisma = buildPrismaMock()
      prisma.finaAudit.count.mockResolvedValue(0)
      prisma.finaAudit.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.queryEvents({ eventType: EventType.AUDIT_QUALIFIED })

      expect(prisma.finaAudit.findMany).toHaveBeenCalledTimes(1)
    })

    it('DISCLOSURE → 查询 disclosureDate 模型', async () => {
      const prisma = buildPrismaMock()
      prisma.disclosureDate.count.mockResolvedValue(0)
      prisma.disclosureDate.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.queryEvents({ eventType: EventType.DISCLOSURE })

      expect(prisma.disclosureDate.findMany).toHaveBeenCalledTimes(1)
    })

    it('tsCode 过滤条件被传入 Prisma 查询', async () => {
      const prisma = buildPrismaMock()
      prisma.forecast.count.mockResolvedValue(0)
      prisma.forecast.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.queryEvents({ eventType: EventType.FORECAST, tsCode: '000001.SZ' })

      const callArgs = (prisma.forecast.findMany.mock.calls[0] as any)[0]
      expect(callArgs.where.tsCode).toBe('000001.SZ')
    })

    it('分页参数 page/pageSize 正确传入 skip/take', async () => {
      const prisma = buildPrismaMock()
      prisma.forecast.count.mockResolvedValue(0)
      prisma.forecast.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.queryEvents({ eventType: EventType.FORECAST, page: 2, pageSize: 10 })

      const callArgs = (prisma.forecast.findMany.mock.calls[0] as any)[0]
      expect(callArgs.skip).toBe(10)
      expect(callArgs.take).toBe(10)
    })
  })

  // ── analyze() — 空事件样本 ─────────────────────────────────────────────────

  describe('analyze() — 空事件集合', () => {
    it('无事件时返回空结构', async () => {
      const prisma = buildPrismaMock()
      // extractEventSamples → no forecast rows
      prisma.forecast.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const dto: EventStudyAnalyzeDto = { eventType: EventType.FORECAST }
      const result = await svc.analyze(dto)

      expect(result.sampleCount).toBe(0)
      expect(result.aarSeries).toHaveLength(0)
      expect(result.caarSeries).toHaveLength(0)
      expect(result.caar).toBe(0)
      expect(result.tStatistic).toBe(0)
      expect(result.pValue).toBe(1)
      expect(result.topSamples).toHaveLength(0)
      expect(result.bottomSamples).toHaveLength(0)
    })
  })

  // ── analyze() — 有效样本流程 ───────────────────────────────────────────────

  describe('analyze() — 有效样本', () => {
    /**
     * 构建最小完整测试场景：
     *   单事件：000001.SZ，事件日 2024-01-15，preDays=2，postDays=2
     *   交易日：2024-01-11 到 2024-01-17（7个交易日）
     *   事件日 index=2（满足 index >= preDays=2）
     *   股票收益：已知值
     *   基准收益：已知值
     *   期望 AR[i] = stock[i] - bench[i]
     */

    function buildScenario() {
      const prisma = buildPrismaMock()
      const tsCode = '000001.SZ'
      const eventDate = '2024-01-15'

      // forecast.findMany → 一条事件记录
      prisma.forecast.findMany.mockResolvedValue([{ tsCode, annDate: new Date(eventDate) }] as any)

      // 7 个交易日：11, 12, 15, 16, 17, 18, 19
      const tradeDateStrs = [
        '2024-01-11',
        '2024-01-12',
        '2024-01-15',
        '2024-01-16',
        '2024-01-17',
        '2024-01-18',
        '2024-01-19',
      ]
      prisma.tradeCal.findMany.mockResolvedValue(
        tradeDateStrs.map((d) => ({ calDate: new Date(d), exchange: 'SSE', isOpen: '1' })),
      )

      // 基准收益（000300.SH）
      const benchReturns = [0.5, 1.0, 0.2, -0.5, 0.3, -0.1, 0.2]
      prisma.indexDaily.findMany.mockResolvedValue(tradeDateStrs.map((d, i) => makeIndexRow(d, benchReturns[i])))

      // 股票收益
      const stockReturns = [1.0, 2.0, 0.5, -1.0, 0.8, 0.1, 0.3]
      prisma.daily.findMany.mockResolvedValue(tradeDateStrs.map((d, i) => makeDailyRow(tsCode, d, stockReturns[i])))

      // 股票名称
      prisma.stockBasic.findMany.mockResolvedValue([{ tsCode, name: '平安银行' }] as any)

      return prisma
    }

    it('单事件场景：sampleCount=1，arSeries 长度=windowSize', async () => {
      const prisma = buildScenario()
      const svc = createService(prisma)

      const dto: EventStudyAnalyzeDto = {
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
        startDate: '20240101',
        endDate: '20240131',
      }
      const result = await svc.analyze(dto)

      expect(result.sampleCount).toBe(1)
      expect(result.topSamples[0].tsCode).toBe('000001.SZ')
      expect(result.topSamples[0].arSeries).toHaveLength(5) // preDays+1+postDays=5
    })

    it('单事件 AR = stock_return - bench_return，逐日验证', async () => {
      const prisma = buildScenario()
      const svc = createService(prisma)

      const dto: EventStudyAnalyzeDto = {
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
      }
      const result = await svc.analyze(dto)

      const sample = result.topSamples[0]
      // window: 2024-01-11 ~ 2024-01-17（index 0~4）
      // AR = [1.0-0.5, 2.0-1.0, 0.5-0.2, -1.0-(-0.5), 0.8-0.3]
      //    = [0.5, 1.0, 0.3, -0.5, 0.5]
      expect(sample.arSeries[0]).toBeCloseTo(0.5, 3)
      expect(sample.arSeries[1]).toBeCloseTo(1.0, 3)
      expect(sample.arSeries[2]).toBeCloseTo(0.3, 3)
      expect(sample.arSeries[3]).toBeCloseTo(-0.5, 3)
      expect(sample.arSeries[4]).toBeCloseTo(0.5, 3)
    })

    it('单事件 CAR = AR 之和', async () => {
      const prisma = buildScenario()
      const svc = createService(prisma)

      const dto: EventStudyAnalyzeDto = {
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
      }
      const result = await svc.analyze(dto)

      const sample = result.topSamples[0]
      const expectedCar = sample.arSeries.reduce((s, v) => s + v, 0)
      expect(sample.car).toBeCloseTo(expectedCar, 3)
    })

    it('单事件 AAR=AR, CAAR 为累积和', async () => {
      const prisma = buildScenario()
      const svc = createService(prisma)

      const dto: EventStudyAnalyzeDto = {
        eventType: EventType.FORECAST,
        preDays: 2,
        postDays: 2,
      }
      const result = await svc.analyze(dto)

      const sample = result.topSamples[0]
      // 单事件：AAR[t] = AR[t] / 1 = AR[t]
      result.aarSeries.forEach((aar, i) => {
        expect(aar).toBeCloseTo(sample.arSeries[i], 3)
      })

      // CAAR 为 AAR 的累积和
      let cumSum = 0
      result.caarSeries.forEach((caar, i) => {
        cumSum += result.aarSeries[i]
        expect(caar).toBeCloseTo(cumSum, 3)
      })
    })

    it('stock name 被正确填充到 sample', async () => {
      const prisma = buildScenario()
      const svc = createService(prisma)

      const result = await svc.analyze({ eventType: EventType.FORECAST, preDays: 2, postDays: 2 })

      expect(result.topSamples[0].name).toBe('平安银行')
    })

    it('结果包含 eventType / eventLabel / benchmark / window', async () => {
      const prisma = buildScenario()
      const svc = createService(prisma)

      const result = await svc.analyze({ eventType: EventType.FORECAST, preDays: 2, postDays: 2 })

      expect(result.eventType).toBe(EventType.FORECAST)
      expect(result.eventLabel).toBe('业绩预告')
      expect(result.benchmark).toBe('000300.SH')
      expect(result.window).toBe('[-2, +2]')
    })
  })

  // ── tTest 行为验证（通过 analyze 间接测试） ────────────────────────────────

  describe('analyze() — tTest 行为', () => {
    it('n=1 样本 → tStatistic=0, pValue=1（不足以做 t 检验）', async () => {
      const prisma = buildPrismaMock()
      prisma.forecast.findMany.mockResolvedValue([{ tsCode: '000001.SZ', annDate: new Date('2024-01-15') }] as any)

      const tradeDateStrs = ['2024-01-11', '2024-01-12', '2024-01-15', '2024-01-16', '2024-01-17']
      prisma.tradeCal.findMany.mockResolvedValue(
        tradeDateStrs.map((d) => ({ calDate: new Date(d), exchange: 'SSE', isOpen: '1' })),
      )
      prisma.indexDaily.findMany.mockResolvedValue(tradeDateStrs.map((d) => makeIndexRow(d, 0)))
      prisma.daily.findMany.mockResolvedValue(tradeDateStrs.map((d) => makeDailyRow('000001.SZ', d, 0)))
      prisma.stockBasic.findMany.mockResolvedValue([{ tsCode: '000001.SZ', name: '平安银行' }] as any)

      const svc = createService(prisma)
      const result = await svc.analyze({ eventType: EventType.FORECAST, preDays: 2, postDays: 2 })

      expect(result.tStatistic).toBe(0)
      expect(result.pValue).toBe(1)
    })

    it('[P3-B3] n>=2 且所有 CAR 完全相同 → variance=0 → tStatistic=0', async () => {
      // 准备 2 只股票，相同的 AR 序列（CAR 相同）
      const prisma = buildPrismaMock()
      prisma.forecast.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', annDate: new Date('2024-01-15') },
        { tsCode: '000002.SZ', annDate: new Date('2024-01-15') },
      ] as any)

      const tradeDateStrs = ['2024-01-11', '2024-01-12', '2024-01-15', '2024-01-16', '2024-01-17']
      prisma.tradeCal.findMany.mockResolvedValue(
        tradeDateStrs.map((d) => ({ calDate: new Date(d), exchange: 'SSE', isOpen: '1' })),
      )
      prisma.indexDaily.findMany.mockResolvedValue(tradeDateStrs.map((d) => makeIndexRow(d, 0)))
      // 两只股票收益相同 → 相同 CAR
      prisma.daily.findMany.mockResolvedValue([
        ...tradeDateStrs.map((d) => makeDailyRow('000001.SZ', d, 1.0)),
        ...tradeDateStrs.map((d) => makeDailyRow('000002.SZ', d, 1.0)),
      ])
      prisma.stockBasic.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', name: '平安银行' },
        { tsCode: '000002.SZ', name: '万科A' },
      ] as any)

      const svc = createService(prisma)
      const result = await svc.analyze({ eventType: EventType.FORECAST, preDays: 2, postDays: 2 })

      // [BUG P3-B3] 所有CAR相同时方差=0，tStat被设为0（实际均值>0，经济显著但统计不显著）
      expect(result.tStatistic).toBe(0)
      expect(result.sampleCount).toBe(2)
    })
  })

  // ── extractEventSamples() — 日期转换 ──────────────────────────────────────

  describe('extractEventSamples()', () => {
    it('FORECAST 事件日期 toDateStr 使用 UTC 时间', async () => {
      const prisma = buildPrismaMock()
      // 使用 UTC 2024-01-15T00:00:00Z（任何时区下 toISOString 均返回 2024-01-15）
      prisma.forecast.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', annDate: new Date('2024-01-15T00:00:00.000Z') },
      ] as any)
      const svc = createService(prisma)

      const samples = await svc.extractEventSamples({ eventType: EventType.FORECAST })

      expect(samples).toHaveLength(1)
      // toDateStr 使用 toISOString().slice(0,10) 基于 UTC
      expect(samples[0].eventDate).toBe('2024-01-15')
      expect(samples[0].tsCode).toBe('000001.SZ')
    })

    it('[P3-B1] toDateStr 基于 UTC — 非 UTC 午夜时间可能偏移一天', async () => {
      const prisma = buildPrismaMock()
      // 2024-01-15T23:00:00Z = 2024-01-16 07:00 CST（当地时间为 1-16，但 UTC 仍是 1-15）
      // toDateStr(d) = d.toISOString().slice(0,10) 返回 '2024-01-15'
      // 若 Prisma 实际存入 CST，DB存 2024-01-16，返回值可能是 2024-01-15T16:00:00Z (即CST 2024-01-16)
      prisma.forecast.findMany.mockResolvedValue([
        { tsCode: '000002.SZ', annDate: new Date('2024-01-15T16:00:00.000Z') }, // CST: 2024-01-16 00:00
      ] as any)
      const svc = createService(prisma)

      const samples = await svc.extractEventSamples({ eventType: EventType.FORECAST })

      // [BUG P3-B1] toDateStr 用 UTC 时间：2024-01-15T16:00:00Z → '2024-01-15'
      // 但 CST 时区下该时刻已是 2024-01-16，事件日期偏早一天
      expect(samples[0].eventDate).toBe('2024-01-15') // 实际在CST应为 2024-01-16
    })

    it('SHARE_FLOAT floatDate 字符串直接转换为 YYYY-MM-DD', async () => {
      const prisma = buildPrismaMock()
      prisma.shareFloat.findMany.mockResolvedValue([{ tsCode: '000003.SZ', floatDate: '20240201' }] as any)
      const svc = createService(prisma)

      const samples = await svc.extractEventSamples({ eventType: EventType.SHARE_FLOAT })

      expect(samples[0].eventDate).toBe('2024-02-01')
    })

    it('返回空数组时不报错', async () => {
      const svc = createService()
      const result = await svc.extractEventSamples({ eventType: EventType.FORECAST })
      expect(result).toHaveLength(0)
    })
  })
})
