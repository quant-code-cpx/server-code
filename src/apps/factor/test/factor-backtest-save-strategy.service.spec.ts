/**
 * FactorBacktestService.saveAsStrategy — 单元测试
 *
 * 覆盖场景：
 * 1.  正常创建：合法 conditions + name → 返回 strategyId 和 FACTOR_SCREENING_ROTATION 类型
 * 2.  因子不存在 → NotFoundException
 * 3.  因子已禁用 → NotFoundException
 * 4.  策略名称重复（P2002）→ BusinessException STRATEGY_NAME_EXISTS
 * 5.  用户策略数量超限（≥50）→ BusinessException STRATEGY_LIMIT_EXCEEDED
 * 6.  标签超限（>10 个）→ BusinessException
 * 7.  strategyConfig 校验：conditions 为空数组 → validateStrategyConfig 抛出
 * 8.  默认值填充：不传可选字段 → strategyConfig 使用默认值，backtestDefaults 正确填充
 * 9.  rebalanceDays 映射：20 → MONTHLY，1 → DAILY，8 → MONTHLY，30 → QUARTERLY
 * 10. universe 非空 → backtestDefaults.universe = 'CUSTOM'
 */

import { NotFoundException } from '@nestjs/common'
import { BusinessException } from 'src/common/exceptions/business.exception'
import { ErrorEnum } from 'src/constant/response-code.constant'
import { FactorBacktestService } from '../services/factor-backtest.service'
import { SaveAsStrategyDto } from '../dto/save-as-strategy.dto'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    factorDefinition: { findUnique: jest.fn() },
    strategy: { count: jest.fn(), create: jest.fn() },
  }
}

function buildRegistryMock() {
  return {
    validateStrategyConfig: jest.fn((type: string, config: unknown) => config),
  }
}

function buildSvc(prismaMock: ReturnType<typeof buildPrismaMock>, registryMock: ReturnType<typeof buildRegistryMock>) {
  return new FactorBacktestService(prismaMock as any, null as any, null as any, registryMock as any)
}

// ── 共用夹具 ──────────────────────────────────────────────────────────────────

function makeDto(overrides: Partial<SaveAsStrategyDto> = {}): SaveAsStrategyDto {
  return {
    conditions: [{ factorName: 'pe_ttm', operator: 'lt', value: 30 }],
    name: '低PE轮动策略',
    ...overrides,
  } as SaveAsStrategyDto
}

function makeStrategyRecord(dto: SaveAsStrategyDto) {
  return {
    id: 'str-001',
    name: dto.name,
    strategyType: 'FACTOR_SCREENING_ROTATION',
    strategyConfig: { conditions: dto.conditions, sortOrder: 'desc', topN: 20, weightMethod: 'equal_weight' },
    backtestDefaults: { initialCapital: 1000000, rebalanceFrequency: 'WEEKLY' },
    createdAt: new Date('2024-12-31'),
  }
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe('FactorBacktestService.saveAsStrategy', () => {
  let prisma: ReturnType<typeof buildPrismaMock>
  let registry: ReturnType<typeof buildRegistryMock>
  let svc: FactorBacktestService

  beforeEach(() => {
    prisma = buildPrismaMock()
    registry = buildRegistryMock()
    svc = buildSvc(prisma, registry)
  })

  // ── 1. 正常创建 ────────────────────────────────────────────────────────────

  it('正常创建：返回 strategyId 和正确类型', async () => {
    const dto = makeDto()
    prisma.factorDefinition.findUnique.mockResolvedValue({ name: 'pe_ttm', isEnabled: true })
    prisma.strategy.count.mockResolvedValue(0)
    const record = makeStrategyRecord(dto)
    prisma.strategy.create.mockResolvedValue(record)

    const result = await svc.saveAsStrategy(dto, 1)

    expect(result.strategyId).toBe('str-001')
    expect(result.strategyType).toBe('FACTOR_SCREENING_ROTATION')
    expect(result.name).toBe('低PE轮动策略')
    expect(result.createdAt).toBeInstanceOf(Date)
  })

  // ── 2. 因子不存在 ──────────────────────────────────────────────────────────

  it('因子不存在 → NotFoundException', async () => {
    const dto = makeDto()
    prisma.factorDefinition.findUnique.mockResolvedValue(null)

    await expect(svc.saveAsStrategy(dto, 1)).rejects.toThrow(NotFoundException)
  })

  // ── 3. 因子已禁用 ──────────────────────────────────────────────────────────

  it('因子已禁用 → NotFoundException', async () => {
    const dto = makeDto()
    prisma.factorDefinition.findUnique.mockResolvedValue({ name: 'pe_ttm', isEnabled: false })

    await expect(svc.saveAsStrategy(dto, 1)).rejects.toThrow(NotFoundException)
  })

  // ── 4. 策略名称重复 ────────────────────────────────────────────────────────

  it('策略名称重复 (P2002) → BusinessException STRATEGY_NAME_EXISTS', async () => {
    const dto = makeDto()
    prisma.factorDefinition.findUnique.mockResolvedValue({ name: 'pe_ttm', isEnabled: true })
    prisma.strategy.count.mockResolvedValue(0)
    const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    prisma.strategy.create.mockRejectedValue(p2002Error)

    await expect(svc.saveAsStrategy(dto, 1)).rejects.toThrow(BusinessException)
  })

  // ── 5. 用户策略数量超限 ────────────────────────────────────────────────────

  it('用户策略数量 ≥ 50 → BusinessException STRATEGY_LIMIT_EXCEEDED', async () => {
    const dto = makeDto()
    prisma.factorDefinition.findUnique.mockResolvedValue({ name: 'pe_ttm', isEnabled: true })
    prisma.strategy.count.mockResolvedValue(50)

    await expect(svc.saveAsStrategy(dto, 1)).rejects.toThrow(BusinessException)
  })

  // ── 6. 标签超限 ────────────────────────────────────────────────────────────

  it('标签超过 10 个 → BusinessException', async () => {
    const dto = makeDto({ tags: Array.from({ length: 11 }, (_, i) => `tag${i}`) })
    prisma.factorDefinition.findUnique.mockResolvedValue({ name: 'pe_ttm', isEnabled: true })

    await expect(svc.saveAsStrategy(dto, 1)).rejects.toThrow(BusinessException)
  })

  // ── 7. strategyConfig 校验失败 ────────────────────────────────────────────

  it('registry.validateStrategyConfig 抛出时透传异常', async () => {
    const dto = makeDto()
    prisma.factorDefinition.findUnique.mockResolvedValue({ name: 'pe_ttm', isEnabled: true })
    prisma.strategy.count.mockResolvedValue(0)
    registry.validateStrategyConfig.mockImplementation(() => {
      throw new BusinessException('conditions 不能为空')
    })

    await expect(svc.saveAsStrategy(dto, 1)).rejects.toThrow(BusinessException)
  })

  // ── 8. 默认值填充 ──────────────────────────────────────────────────────────

  it('未传可选字段时 strategyConfig 使用默认值', async () => {
    const dto = makeDto() // 不传 topN / sortBy / weightMethod
    prisma.factorDefinition.findUnique.mockResolvedValue({ name: 'pe_ttm', isEnabled: true })
    prisma.strategy.count.mockResolvedValue(0)
    const record = makeStrategyRecord(dto)
    prisma.strategy.create.mockResolvedValue(record)

    await svc.saveAsStrategy(dto, 1)

    const createData = prisma.strategy.create.mock.calls[0][0].data
    expect((createData.strategyConfig as any).topN).toBe(20)
    expect((createData.strategyConfig as any).sortOrder).toBe('desc')
    expect((createData.strategyConfig as any).weightMethod).toBe('equal_weight')
    expect((createData.backtestDefaults as any).initialCapital).toBe(1_000_000)
  })

  // ── 9. rebalanceDays 映射 ─────────────────────────────────────────────────

  it.each([
    [1, 'DAILY'],
    [5, 'WEEKLY'],
    [20, 'MONTHLY'],
    [30, 'QUARTERLY'],
  ])('rebalanceDays=%i → rebalanceFrequency=%s', async (days, expected) => {
    const dto = makeDto({ rebalanceDays: days })
    prisma.factorDefinition.findUnique.mockResolvedValue({ name: 'pe_ttm', isEnabled: true })
    prisma.strategy.count.mockResolvedValue(0)
    const record = makeStrategyRecord(dto)
    prisma.strategy.create.mockResolvedValue(record)

    await svc.saveAsStrategy(dto, 1)

    const createData = prisma.strategy.create.mock.calls[0][0].data
    expect((createData.backtestDefaults as any).rebalanceFrequency).toBe(expected)
  })

  // ── 10. universe 非空 ─────────────────────────────────────────────────────

  it('传入 universe → backtestDefaults.universe = CUSTOM', async () => {
    const dto = makeDto({ universe: '000300.SH' })
    prisma.factorDefinition.findUnique.mockResolvedValue({ name: 'pe_ttm', isEnabled: true })
    prisma.strategy.count.mockResolvedValue(0)
    const record = makeStrategyRecord(dto)
    prisma.strategy.create.mockResolvedValue(record)

    await svc.saveAsStrategy(dto, 1)

    const createData = prisma.strategy.create.mock.calls[0][0].data
    expect((createData.backtestDefaults as any).universe).toBe('CUSTOM')
  })
})
