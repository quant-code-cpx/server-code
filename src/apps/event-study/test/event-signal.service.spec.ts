/**
 * EventSignalService — 单元测试
 *
 * 覆盖要点：
 * - createRule(): 创建规则，调用正确的 Prisma 方法
 * - listRules(): 分页查询，过滤 DELETED 状态
 * - updateRule(): 找不到规则时抛出 NotFoundException
 * - deleteRule(): 软删除（status → DELETED）
 * - querySignals(): 先拿用户规则 ID，再查信号
 * - scanAndGenerate(): 无 ACTIVE 规则时跳过扫描；有规则时调用正确逻辑
 * - matchConditions() [private]: 通过 scanAndGenerate 间接测试或 (svc as any) 调用
 */

import { NotFoundException } from '@nestjs/common'
import { EventSignalRuleStatus } from '@prisma/client'
import { EventSignalService } from '../event-signal.service'
import { EventType } from '../event-type.registry'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    eventSignalRule: {
      create: jest.fn(),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      findFirst: jest.fn(async () => null),
      update: jest.fn(),
    },
    eventSignal: {
      create: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    forecast: { findMany: jest.fn(async () => []) },
    dividend: { findMany: jest.fn(async () => []) },
    stkHolderTrade: { findMany: jest.fn(async () => []) },
    shareFloat: { findMany: jest.fn(async () => []) },
    repurchase: { findMany: jest.fn(async () => []) },
    finaAudit: { findMany: jest.fn(async () => []) },
    disclosureDate: { findMany: jest.fn(async () => []) },
  }
}

function buildGatewayMock() {
  return { emitToUser: jest.fn() }
}

function buildEventStudyMock() {
  return { extractEventSamples: jest.fn(async () => []) }
}

function createService(
  prismaMock = buildPrismaMock(),
  gatewayMock = buildGatewayMock(),
  eventStudyMock = buildEventStudyMock(),
) {
  return new EventSignalService(prismaMock as any, gatewayMock as any, eventStudyMock as any)
}

// ── 规则数据助手 ──────────────────────────────────────────────────────────────

function makeRule(
  overrides: Partial<{
    id: number
    userId: number
    name: string
    eventType: string
    conditions: Record<string, unknown>
    signalType: string
    status: string
  }> = {},
) {
  return {
    id: 1,
    userId: 42,
    name: '测试规则',
    description: null,
    eventType: EventType.FORECAST,
    conditions: {},
    signalType: 'WATCH',
    status: EventSignalRuleStatus.ACTIVE,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

// ═══════════════════════════════════════════════════════════════════════════════

describe('EventSignalService', () => {
  beforeEach(() => jest.clearAllMocks())

  // ── createRule() ─────────────────────────────────────────────────────────

  describe('createRule()', () => {
    it('调用 eventSignalRule.create 并返回创建结果', async () => {
      const prisma = buildPrismaMock()
      const created = makeRule({ name: '业绩预告增持' })
      prisma.eventSignalRule.create.mockResolvedValue(created)
      const svc = createService(prisma)

      const result = await svc.createRule(42, {
        name: '业绩预告增持',
        eventType: EventType.FORECAST,
      })

      expect(prisma.eventSignalRule.create).toHaveBeenCalledTimes(1)
      expect(result.name).toBe('业绩预告增持')
    })

    it('conditions 默认为空对象', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.create.mockResolvedValue(makeRule())
      const svc = createService(prisma)

      await svc.createRule(42, { name: '规则', eventType: EventType.FORECAST })

      const createData = prisma.eventSignalRule.create.mock.calls[0][0].data
      expect(createData.conditions).toEqual({})
    })

    it('signalType 默认为 WATCH', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.create.mockResolvedValue(makeRule())
      const svc = createService(prisma)

      await svc.createRule(42, { name: '规则', eventType: EventType.FORECAST })

      const createData = prisma.eventSignalRule.create.mock.calls[0][0].data
      expect(createData.signalType).toBe('WATCH')
    })
  })

  // ── listRules() ──────────────────────────────────────────────────────────

  describe('listRules()', () => {
    it('返回分页结构 {items, total, page, pageSize}', async () => {
      const prisma = buildPrismaMock()
      const rules = [makeRule({ id: 1 }), makeRule({ id: 2 })]
      prisma.eventSignalRule.findMany.mockResolvedValue(rules)
      prisma.eventSignalRule.count.mockResolvedValue(2)
      const svc = createService(prisma)

      const result = await svc.listRules(42)

      expect(result.items).toHaveLength(2)
      expect(result.total).toBe(2)
      expect(result.page).toBe(1)
      expect(result.pageSize).toBe(20)
    })

    it('查询条件过滤掉 DELETED 状态', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.findMany.mockResolvedValue([])
      prisma.eventSignalRule.count.mockResolvedValue(0)
      const svc = createService(prisma)

      await svc.listRules(42)

      const where = (prisma.eventSignalRule.findMany.mock.calls[0] as any)[0].where
      expect(where.status).toEqual({ not: EventSignalRuleStatus.DELETED })
    })

    it('page=2, pageSize=5 → skip=5', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.findMany.mockResolvedValue([])
      prisma.eventSignalRule.count.mockResolvedValue(0)
      const svc = createService(prisma)

      await svc.listRules(42, 2, 5)

      const callArgs = (prisma.eventSignalRule.findMany.mock.calls[0] as any)[0]
      expect(callArgs.skip).toBe(5)
      expect(callArgs.take).toBe(5)
    })
  })

  // ── updateRule() ─────────────────────────────────────────────────────────

  describe('updateRule()', () => {
    it('规则不存在或 userId 不匹配 → 抛出 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.updateRule(42, 99, { id: 99, name: '新名称' })).rejects.toThrow(NotFoundException)
    })

    it('规则存在 → 调用 eventSignalRule.update', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.findFirst.mockResolvedValue(makeRule())
      prisma.eventSignalRule.update.mockResolvedValue(makeRule({ name: '新名称' }))
      const svc = createService(prisma)

      await svc.updateRule(42, 1, { id: 1, name: '新名称' })

      expect(prisma.eventSignalRule.update).toHaveBeenCalledTimes(1)
    })
  })

  // ── deleteRule() ─────────────────────────────────────────────────────────

  describe('deleteRule()', () => {
    it('规则不存在 → 抛出 NotFoundException', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.findFirst.mockResolvedValue(null)
      const svc = createService(prisma)

      await expect(svc.deleteRule(42, 99)).rejects.toThrow(NotFoundException)
    })

    it('规则存在 → 执行软删除（status=DELETED）', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.findFirst.mockResolvedValue(makeRule())
      prisma.eventSignalRule.update.mockResolvedValue({} as any)
      const svc = createService(prisma)

      await svc.deleteRule(42, 1)

      const updateData = prisma.eventSignalRule.update.mock.calls[0][0]
      expect(updateData.data.status).toBe(EventSignalRuleStatus.DELETED)
    })
  })

  // ── querySignals() ────────────────────────────────────────────────────────

  describe('querySignals()', () => {
    it('用户无规则 → 直接返回空列表', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.querySignals(42, {})

      expect(result.items).toHaveLength(0)
      expect(result.total).toBe(0)
      expect(prisma.eventSignal.findMany).not.toHaveBeenCalled()
    })

    it('用户有规则 → 查询对应信号', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }] as any)
      prisma.eventSignal.findMany.mockResolvedValue([
        { id: 10, ruleId: 1, tsCode: '000001.SZ', triggeredAt: new Date() },
      ] as any)
      prisma.eventSignal.count.mockResolvedValue(1)
      const svc = createService(prisma)

      const result = await svc.querySignals(42, {})

      expect(result.items).toHaveLength(1)
      expect(result.total).toBe(1)
    })
  })

  // ── scanAndGenerate() ────────────────────────────────────────────────────

  describe('scanAndGenerate()', () => {
    it('无 ACTIVE 规则 → 跳过扫描，返回 signalsGenerated=0', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      const result = await svc.scanAndGenerate('20240115')

      expect(result.signalsGenerated).toBe(0)
      expect(prisma.eventSignal.create).not.toHaveBeenCalled()
    })

    it('有 ACTIVE 规则但当日无事件 → signalsGenerated=0', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.findMany.mockResolvedValue([
        makeRule({ id: 1, eventType: EventType.FORECAST, status: EventSignalRuleStatus.ACTIVE }),
      ] as any)
      prisma.forecast.findMany.mockResolvedValue([]) // queryDateEvents → 无事件
      const svc = createService(prisma)

      const result = await svc.scanAndGenerate('20240115')

      expect(result.signalsGenerated).toBe(0)
    })

    it('有事件且条件匹配 → 创建信号并 WebSocket 推送', async () => {
      const prisma = buildPrismaMock()
      const gateway = buildGatewayMock()

      prisma.eventSignalRule.findMany.mockResolvedValue([
        makeRule({
          id: 1,
          userId: 42,
          eventType: EventType.FORECAST,
          conditions: {},
          status: EventSignalRuleStatus.ACTIVE,
        }),
      ] as any)
      prisma.forecast.findMany.mockResolvedValue([
        { tsCode: '000001.SZ', annDate: new Date('2024-01-15'), type: '预增' },
      ] as any)
      prisma.eventSignal.create.mockResolvedValue({ id: 100 } as any)

      const svc = createService(prisma, gateway)
      const result = await svc.scanAndGenerate('20240115')

      expect(result.signalsGenerated).toBe(1)
      expect(prisma.eventSignal.create).toHaveBeenCalledTimes(1)
      expect(gateway.emitToUser).toHaveBeenCalledWith(
        42,
        'event-signal',
        expect.objectContaining({
          ruleId: 1,
          tsCode: '000001.SZ',
        }),
      )
    })

    it('[P3-B6] 不传 targetDate 时使用当日 UTC 日期（非 CST）', async () => {
      const prisma = buildPrismaMock()
      prisma.eventSignalRule.findMany.mockResolvedValue([
        makeRule({ id: 1, eventType: EventType.FORECAST, status: EventSignalRuleStatus.ACTIVE }),
      ] as any)
      prisma.forecast.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      // 不传 targetDate → 使用 new Date().toISOString().slice(0,10).replace(/-/g,'')
      // 这等于 UTC 日期，在 CST 夜间可能是前一天
      const result = await svc.scanAndGenerate() // 不传参数

      expect(result.signalsGenerated).toBe(0)
      // 验证确实有调用 findMany（说明执行了扫描流程）
      expect(prisma.forecast.findMany).toHaveBeenCalledTimes(1)
    })
  })

  // ── matchConditions() [private] ──────────────────────────────────────────

  describe('matchConditions() [private, via (svc as any)]', () => {
    it('空条件 → 始终匹配', () => {
      const svc = createService()
      const match = (svc as any).matchConditions({ tsCode: '000001.SZ', type: '预增' }, {})
      expect(match).toBe(true)
    })

    it('直接值条件 — 匹配', () => {
      const svc = createService()
      const match = (svc as any).matchConditions({ tsCode: '000001.SZ', type: '预增' }, { type: '预增' })
      expect(match).toBe(true)
    })

    it('直接值条件 — 不匹配', () => {
      const svc = createService()
      const match = (svc as any).matchConditions({ tsCode: '000001.SZ', type: '预减' }, { type: '预增' })
      expect(match).toBe(false)
    })

    it('字段为 null → 返回 false', () => {
      const svc = createService()
      const match = (svc as any).matchConditions({ tsCode: '000001.SZ', pChangeMin: null }, { pChangeMin: { gte: 50 } })
      expect(match).toBe(false)
    })

    it('gte 操作符 — 满足', () => {
      const svc = createService()
      const match = (svc as any).matchConditions({ pChangeMin: 60 }, { pChangeMin: { gte: 50 } })
      expect(match).toBe(true)
    })

    it('gte 操作符 — 不满足', () => {
      const svc = createService()
      const match = (svc as any).matchConditions({ pChangeMin: 30 }, { pChangeMin: { gte: 50 } })
      expect(match).toBe(false)
    })

    it('lte 操作符 — 满足', () => {
      const svc = createService()
      const match = (svc as any).matchConditions({ pChangeMin: 40 }, { pChangeMin: { lte: 50 } })
      expect(match).toBe(true)
    })

    it('gt 操作符 — 等于边界时不满足', () => {
      const svc = createService()
      const match = (svc as any).matchConditions({ value: 50 }, { value: { gt: 50 } })
      expect(match).toBe(false)
    })

    it('lt 操作符 — 等于边界时不满足', () => {
      const svc = createService()
      const match = (svc as any).matchConditions({ value: 50 }, { value: { lt: 50 } })
      expect(match).toBe(false)
    })

    it('in 操作符 — 包含', () => {
      const svc = createService()
      const match = (svc as any).matchConditions({ type: '预增' }, { type: { in: ['预增', '略增'] } })
      expect(match).toBe(true)
    })

    it('in 操作符 — 不包含', () => {
      const svc = createService()
      const match = (svc as any).matchConditions({ type: '预减' }, { type: { in: ['预增', '略增'] } })
      expect(match).toBe(false)
    })

    it('[P3-B7] 多条件：所有满足才返回 true', () => {
      const svc = createService()
      const match = (svc as any).matchConditions(
        { type: '预增', pChangeMin: 80 },
        { type: '预增', pChangeMin: { gte: 50 } },
      )
      expect(match).toBe(true)
    })

    it('[P3-B7] 多条件：任一不满足返回 false', () => {
      const svc = createService()
      const match = (svc as any).matchConditions(
        { type: '预减', pChangeMin: 80 },
        { type: '预增', pChangeMin: { gte: 50 } },
      )
      expect(match).toBe(false)
    })
  })
})
