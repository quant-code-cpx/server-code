/**
 * Calendar 真实 DB 集成测试（无 mock）
 */
import { Test, TestingModule } from '@nestjs/testing'
import { CalendarService } from '../calendar.service'
import { PrismaService } from 'src/shared/prisma.service'
import { LoggerService } from 'src/shared/logger/logger.service'

describe('Calendar — 真实 DB 集成测试', () => {
  let service: CalendarService
  let prisma: PrismaService
  let dbAvailable = true

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarService, PrismaService,
        { provide: LoggerService, useValue: { log: () => {}, warn: () => {}, error: () => {}, debug: () => {}, verbose: () => {}, devLog: () => {} } },
      ],
    }).compile()
    service = module.get<CalendarService>(CalendarService)
    prisma = module.get<PrismaService>(PrismaService)

    try {
      await prisma.$connect()
      await prisma.$queryRaw`SELECT 1`
    } catch {
      dbAvailable = false
    }
  }, 15000)

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.$disconnect()
    }
  })

  function skipWhenDbUnavailable() {
    if (!dbAvailable) return true
    return false
  }

  it('range 查询：一个月范围不抛异常', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.getEventsByDateRange('20260501', '20260531', undefined, undefined, 2)
    expect(result).toBeDefined()
    expect(Array.isArray(result)).toBe(true)
  }, 30000)

  it('range 按类型过滤 DIVIDEND', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.getEventsByDateRange('20260501', '20260531', ['DIVIDEND'], undefined, 2)
    expect(Array.isArray(result)).toBe(true)
  }, 30000)

  it('range keyword 搜索', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.getEventsByDateRange('20260101', '20260523', undefined, undefined, 2, '银行')
    expect(Array.isArray(result)).toBe(true)
  }, 30000)

  it('upcoming 默认 30 天', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.getUpcomingEvents(30)
    expect(Array.isArray(result)).toBe(true)
  }, 30000)

  it('upcoming 7 天', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.getUpcomingEvents(7)
    expect(Array.isArray(result)).toBe(true)
  }, 30000)

  it('upcoming 365 天', async () => {
    if (skipWhenDbUnavailable()) return
    const result = await service.getUpcomingEvents(365)
    expect(Array.isArray(result)).toBe(true)
  }, 30000)
})

jest.setTimeout(60000)
