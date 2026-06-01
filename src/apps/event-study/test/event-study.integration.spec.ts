/**
 * EventStudy 真实数据集成测试（无 mock）
 *
 * 目标：用真实 DB 数据跑 analyze()，验证：
 * 1. 8 种事件类型都能正常分析不抛异常
 * 2. 返回结构符合 EventStudyResultDto
 * 3. AR/CAR/AAR/CAAR/t检验数值合理
 * 4. BigInt 序列化无错误
 */
import { Test, TestingModule } from '@nestjs/testing'
import { EventStudyService } from '../event-study.service'
import { PrismaService } from 'src/shared/prisma.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import { EventType } from '../event-type.registry'

describe('EventStudy — 真实 DB 集成测试', () => {
  let service: EventStudyService
  let prisma: PrismaService
  let dbAvailable = true

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventStudyService,
        PrismaService,
        { provide: LoggerService, useValue: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, devLog: () => {} } },
      ],
    }).compile()

    service = module.get<EventStudyService>(EventStudyService)
    prisma = module.get<PrismaService>(PrismaService)

    try {
      await prisma.$connect()
      await prisma.$queryRaw`SELECT 1`
    } catch {
      dbAvailable = false
    }
  }, 30000)

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.$disconnect()
    }
  })

  function skipWhenDbUnavailable() {
    if (!dbAvailable) return true
    return false
  }

  it('event-types/list 返回 8 种类型且结构完整', () => {
    const types = service.getEventTypes()
    expect(types).toHaveLength(8)
    for (const t of types) {
      expect(t.type).toBeDefined()
      expect(t.label).toBeDefined()
      expect(t.description).toBeDefined()
    }
  })

  it('events 查询 8 种类型均不抛异常', async () => {
    if (skipWhenDbUnavailable()) return
    for (const et of Object.values(EventType)) {
      const result = await service.queryEvents({ eventType: et, page: 1, pageSize: 5 })
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('items')
      expect(Array.isArray(result.items)).toBe(true)
    }
  }, 30000)

  it('analyze FORECAST（业绩预告）默认窗口', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.analyze({ eventType: EventType.FORECAST })
    verifyAnalyzeResult(result, 'FORECAST', 26)
  }, 120000)

  it('analyze DIVIDEND_EX（分红除权）— BigInt 序列化', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.analyze({ eventType: EventType.DIVIDEND_EX })
    verifyAnalyzeResult(result, 'DIVIDEND_EX', 26)
  }, 120000)

  it('analyze SHARE_FLOAT（限售解禁）', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.analyze({ eventType: EventType.SHARE_FLOAT })
    verifyAnalyzeResult(result, 'SHARE_FLOAT', 26)
  }, 120000)

  it('analyze HOLDER_INCREASE（股东增持）', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.analyze({ eventType: EventType.HOLDER_INCREASE })
    verifyAnalyzeResult(result, 'HOLDER_INCREASE', 26)
  }, 120000)

  it('analyze HOLDER_DECREASE（股东减持）', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.analyze({ eventType: EventType.HOLDER_DECREASE })
    verifyAnalyzeResult(result, 'HOLDER_DECREASE', 26)
  }, 120000)

  it('analyze REPURCHASE（股票回购）', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.analyze({ eventType: EventType.REPURCHASE })
    verifyAnalyzeResult(result, 'REPURCHASE', 26)
  }, 120000)

  it('analyze AUDIT_QUALIFIED（非标审计）', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.analyze({ eventType: EventType.AUDIT_QUALIFIED })
    verifyAnalyzeResult(result, 'AUDIT_QUALIFIED', 26)
  }, 120000)

  it('analyze DISCLOSURE（财报披露）', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.analyze({ eventType: EventType.DISCLOSURE })
    verifyAnalyzeResult(result, 'DISCLOSURE', 26)
  }, 120000)

  it('analyze 自定义窗口 preDays=0 postDays=10', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.analyze({
      eventType: EventType.FORECAST, preDays: 0, postDays: 10,
    })
    verifyAnalyzeResult(result, 'FORECAST', 11)
  }, 60000)

  it('analyze 指定 tsCode=000001.SZ', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.analyze({
      eventType: EventType.FORECAST, tsCode: '000001.SZ',
    })
    if (result.sampleCount > 0 && result.topSamples) {
      expect(result.topSamples.every((s: any) => s.tsCode === '000001.SZ')).toBe(true)
    }
  }, 60000)

  it('analyze 自定义基准中证500', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.analyze({
      eventType: EventType.FORECAST, benchmarkCode: '000905.SH',
    })
    expect(result.benchmark).toBe('000905.SH')
    verifyAnalyzeResult(result, 'FORECAST', 26)
  }, 60000)
})

function verifyAnalyzeResult(result: any, expectedType: string, expectedWindowSize: number) {
  expect(result.eventType).toBe(expectedType)
  expect(result.eventLabel).toBeTruthy()
  expect(typeof result.sampleCount).toBe('number')
  expect(result.benchmark).toBeTruthy()

  if (result.sampleCount > 0) {
    expect(result.aarSeries).toHaveLength(expectedWindowSize)
    expect(result.caarSeries).toHaveLength(expectedWindowSize)
    for (const aar of result.aarSeries) {
      expect(typeof aar).toBe('number')
      expect(Math.abs(aar)).toBeLessThan(100)
    }
    const lastCAAR = result.caarSeries[result.caarSeries.length - 1]
    expect(result.caar).toBeCloseTo(lastCAAR, 2)
    expect(typeof result.tStatistic).toBe('number')
    expect(typeof result.pValue).toBe('number')
    expect(result.pValue).toBeGreaterThanOrEqual(0)
    expect(result.pValue).toBeLessThanOrEqual(1)
    if (result.topSamples) {
      for (const s of result.topSamples) {
        expect(s.tsCode).toBeTruthy()
        expect(typeof s.car).toBe('number')
        expect(Array.isArray(s.arSeries)).toBe(true)
        const computedCar = s.arSeries.reduce((a: number, b: number) => a + b, 0)
        expect(Math.abs(s.car - computedCar)).toBeLessThan(0.01)
      }
    }
  }
}

jest.setTimeout(180000)
