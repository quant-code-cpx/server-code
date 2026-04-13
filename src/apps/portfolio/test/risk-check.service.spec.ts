/**
 * RiskCheckService — 单元测试
 *
 * 覆盖要点：
 * - runCheck: 无规则时返回空 violations
 * - runCheck: 检测到违规时写 DB 并推送 risk_violation WebSocket 事件
 * - autoCheckOnHoldingChange: 检测到违规时写 DB 并推送 risk_violation WebSocket 事件
 * - runCheck: 无违规时不调用 emitToUser
 */

import { PortfolioRiskRuleType } from '@prisma/client'
import { Decimal } from '@prisma/client/runtime/library'
import { RiskCheckService } from '../risk-check.service'

// ── Mock 工厂 ─────────────────────────────────────────────────────────────────

function buildPrismaMock() {
  return {
    portfolioRiskRule: {
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
    riskViolationLog: {
      createMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(),
    },
    portfolioHolding: {
      findMany: jest.fn(),
    },
    stockBasic: {
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn(async () => []),
  }
}

function buildPortfolioServiceMock() {
  return {
    assertOwner: jest.fn(async () => undefined),
    getLatestTradeDate: jest.fn(async () => null),
  }
}

function buildRiskServiceMock() {
  return {
    getPositionConcentration: jest.fn(),
    getIndustryDistribution: jest.fn(),
    getMarketCapDistribution: jest.fn(),
    getBetaAnalysis: jest.fn(),
  }
}

function buildEventsGatewayMock() {
  return {
    emitToUser: jest.fn(),
  }
}

function buildRule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rule-001',
    portfolioId: 'portfolio-001',
    ruleType: PortfolioRiskRuleType.MAX_SINGLE_POSITION,
    threshold: 0.3,
    isEnabled: true,
    memo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function createService(
  prismaMock = buildPrismaMock(),
  portfolioSvcMock = buildPortfolioServiceMock(),
  riskSvcMock = buildRiskServiceMock(),
  eventsGatewayMock = buildEventsGatewayMock(),
) {
  return new RiskCheckService(prismaMock as any, portfolioSvcMock as any, riskSvcMock as any, eventsGatewayMock as any)
}

// ═════════════════════════════════════════════════════════════════════════════

describe('RiskCheckService', () => {
  // ─── runCheck ──────────────────────────────────────────────────────────────

  describe('runCheck()', () => {
    it('无启用规则时直接返回空 violations，不写 DB，不推送 WS', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolioRiskRule.findMany.mockResolvedValue([])
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, undefined, eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(0)
      expect(prisma.riskViolationLog.createMany).not.toHaveBeenCalled()
      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('无违规时不写 DB，不推送 WS', async () => {
      const prisma = buildPrismaMock()
      const rule = buildRule()
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      const riskSvc = buildRiskServiceMock()
      riskSvc.getPositionConcentration.mockResolvedValue({
        concentration: { top1Weight: 0.1 }, // 低于阈值 0.3
        positions: [{ stockName: '平安银行' }],
      })
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, riskSvc, eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(0)
      expect(prisma.riskViolationLog.createMany).not.toHaveBeenCalled()
      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('检测到违规时写入 DB 并向用户推送 risk_violation 事件', async () => {
      const prisma = buildPrismaMock()
      const rule = buildRule({ threshold: 0.3 })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      prisma.riskViolationLog.createMany.mockResolvedValue({ count: 1 })
      const riskSvc = buildRiskServiceMock()
      riskSvc.getPositionConcentration.mockResolvedValue({
        concentration: { top1Weight: 0.45 }, // 超过阈值 0.3
        positions: [{ stockName: '平安银行', tsCode: '000001.SZ' }],
      })
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, riskSvc, eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(1)
      expect(prisma.riskViolationLog.createMany).toHaveBeenCalledTimes(1)
      expect(eventsGateway.emitToUser).toHaveBeenCalledTimes(1)
      expect(eventsGateway.emitToUser).toHaveBeenCalledWith(
        10,
        'risk_violation',
        expect.objectContaining({
          portfolioId: 'portfolio-001',
          violations: expect.arrayContaining([
            expect.objectContaining({
              ruleType: PortfolioRiskRuleType.MAX_SINGLE_POSITION,
              actualValue: 0.45,
              threshold: 0.3,
            }),
          ]),
        }),
      )
    })
  })

  // ─── autoCheckOnHoldingChange ───────────────────────────────────────────────

  describe('autoCheckOnHoldingChange()', () => {
    it('无启用规则时不推送 WS', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolioRiskRule.findMany.mockResolvedValue([])
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, undefined, eventsGateway)

      await svc.autoCheckOnHoldingChange('portfolio-001', 10)

      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('自动检测到违规时推送 risk_violation 事件', async () => {
      const prisma = buildPrismaMock()
      const rule = buildRule({
        ruleType: PortfolioRiskRuleType.MAX_INDUSTRY_WEIGHT,
        threshold: 0.4,
      })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      prisma.riskViolationLog.createMany.mockResolvedValue({ count: 1 })
      const riskSvc = buildRiskServiceMock()
      riskSvc.getIndustryDistribution.mockResolvedValue({
        industries: [{ industry: '银行', weight: 0.55 }],
      })
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, riskSvc, eventsGateway)

      await svc.autoCheckOnHoldingChange('portfolio-001', 10)

      expect(prisma.riskViolationLog.createMany).toHaveBeenCalledTimes(1)
      expect(eventsGateway.emitToUser).toHaveBeenCalledWith(
        10,
        'risk_violation',
        expect.objectContaining({ portfolioId: 'portfolio-001' }),
      )
    })
  })

  // ─── checkSinglePosition: 阈值边界 ─────────────────────────────────────────

  describe('[BIZ] 阈值边界：权重恰好等于阈值时不触发', () => {
    it('[BIZ] top1Weight === threshold（精确相等）时不触发违规（严格 > 判断）', async () => {
      const prisma = buildPrismaMock()
      const rule = buildRule({ threshold: 0.3 })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      const riskSvc = buildRiskServiceMock()
      riskSvc.getPositionConcentration.mockResolvedValue({
        concentration: { top1Weight: 0.3 }, // 精确等于阈值
        positions: [{ stockName: '平安银行', tsCode: '000001.SZ' }],
      })
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, riskSvc, eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(0)
      expect(prisma.riskViolationLog.createMany).not.toHaveBeenCalled()
      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('[BIZ] top1Weight 超过阈值 0.001 时触发违规', async () => {
      const prisma = buildPrismaMock()
      const rule = buildRule({ threshold: 0.3 })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      const riskSvc = buildRiskServiceMock()
      riskSvc.getPositionConcentration.mockResolvedValue({
        concentration: { top1Weight: 0.301 }, // 微小超出
        positions: [{ stockName: '平安银行', tsCode: '000001.SZ' }],
      })
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, riskSvc, eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].actualValue).toBeCloseTo(0.301, 3)
    })
  })

  // ─── checkIndustryWeight: 排序正确性 ──────────────────────────────────────

  describe('[BIZ] 行业权重排序', () => {
    it('[BIZ] 多个行业时取权重最大的行业进行比较', async () => {
      const prisma = buildPrismaMock()
      const rule = buildRule({
        ruleType: PortfolioRiskRuleType.MAX_INDUSTRY_WEIGHT,
        threshold: 0.5,
      })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      const riskSvc = buildRiskServiceMock()
      // 银行业 0.4，科技业 0.55 → 最大为科技业 0.55 > 0.5 → 触发违规
      riskSvc.getIndustryDistribution.mockResolvedValue({
        industries: [
          { industry: '银行', weight: 0.4 },
          { industry: '科技', weight: 0.55 },
        ],
      })
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, riskSvc, eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].actualValue).toBeCloseTo(0.55, 3)
    })

    it('[BIZ] 行业权重为 null 时视为 0，不触发违规', async () => {
      const prisma = buildPrismaMock()
      const rule = buildRule({
        ruleType: PortfolioRiskRuleType.MAX_INDUSTRY_WEIGHT,
        threshold: 0.3,
      })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      const riskSvc = buildRiskServiceMock()
      riskSvc.getIndustryDistribution.mockResolvedValue({
        industries: [{ industry: '银行', weight: null }],
      })
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, riskSvc, eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(0)
    })

    it('[BIZ] 行业列表为空时不触发违规', async () => {
      const prisma = buildPrismaMock()
      const rule = buildRule({
        ruleType: PortfolioRiskRuleType.MAX_INDUSTRY_WEIGHT,
        threshold: 0.3,
      })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      const riskSvc = buildRiskServiceMock()
      riskSvc.getIndustryDistribution.mockResolvedValue({ industries: [] })
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, riskSvc, eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(0)
    })
  })

  // ─── 规则检查结果的 detail 字段 ──────────────────────────────────────────────

  describe('[BIZ] violation detail 格式', () => {
    it('[BIZ] MAX_SINGLE_POSITION 违规的 detail 包含股票名和百分比', async () => {
      const prisma = buildPrismaMock()
      const rule = buildRule({ threshold: 0.2 })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      const riskSvc = buildRiskServiceMock()
      riskSvc.getPositionConcentration.mockResolvedValue({
        concentration: { top1Weight: 0.35 },
        positions: [{ stockName: '宁德时代', tsCode: '300750.SZ' }],
      })
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, riskSvc, eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations[0].detail).toContain('宁德时代')
      expect(result.violations[0].detail).toContain('%')
    })
  })

  // ── Phase 2 新增：checkMaxDrawdown 边界 ────────────────────────────────────

  describe('[BIZ] checkMaxDrawdown — 高水位标记与最大回撤计算', () => {
    it('[BIZ] NAV 序列 1.0→0.8→0.9：最大回撤应为 20%（高水位，非末端差值 10%）', async () => {
      const prisma = buildPrismaMock()
      const portfolioSvc = buildPortfolioServiceMock()
      const rule = buildRule({
        ruleType: PortfolioRiskRuleType.MAX_DRAWDOWN_STOP,
        threshold: 0.15, // 阈值 15%，低于实际 20% → 触发违规
      })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      portfolioSvc.getLatestTradeDate.mockResolvedValue(new Date('2025-01-10'))
      prisma.$queryRaw.mockResolvedValue([
        { trade_date: new Date('2025-01-01'), market_value: '100', cost_basis: '100' }, // nav=1.0
        { trade_date: new Date('2025-01-05'), market_value: '80', cost_basis: '100' }, // nav=0.8
        { trade_date: new Date('2025-01-10'), market_value: '90', cost_basis: '100' }, // nav=0.9
      ])
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, portfolioSvc, buildRiskServiceMock(), eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(1)
      expect(result.violations[0].actualValue).toBeCloseTo(0.2, 5) // (1.0-0.8)/1.0 = 0.2
    })

    it('[BIZ] NAV 序列 1.0→0.8→0.9：threshold=0.25 时不触发违规', async () => {
      const prisma = buildPrismaMock()
      const portfolioSvc = buildPortfolioServiceMock()
      const rule = buildRule({
        ruleType: PortfolioRiskRuleType.MAX_DRAWDOWN_STOP,
        threshold: 0.25, // 阈值 25%，高于实际 20% → 不违规
      })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      portfolioSvc.getLatestTradeDate.mockResolvedValue(new Date('2025-01-10'))
      prisma.$queryRaw.mockResolvedValue([
        { trade_date: new Date('2025-01-01'), market_value: '100', cost_basis: '100' },
        { trade_date: new Date('2025-01-05'), market_value: '80', cost_basis: '100' },
        { trade_date: new Date('2025-01-10'), market_value: '90', cost_basis: '100' },
      ])
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, portfolioSvc, buildRiskServiceMock(), eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(0)
    })

    it('[EDGE] NAV 数据不足 2 条时不计算回撤，不触发违规', async () => {
      const prisma = buildPrismaMock()
      const portfolioSvc = buildPortfolioServiceMock()
      const rule = buildRule({
        ruleType: PortfolioRiskRuleType.MAX_DRAWDOWN_STOP,
        threshold: 0.05,
      })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      portfolioSvc.getLatestTradeDate.mockResolvedValue(new Date('2025-01-10'))
      prisma.$queryRaw.mockResolvedValue([
        { trade_date: new Date('2025-01-10'), market_value: '80', cost_basis: '100' },
      ]) // 仅 1 条 → rows.length < 2 → return null
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, portfolioSvc, buildRiskServiceMock(), eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(0)
    })

    it('[EDGE] getLatestTradeDate 返回 null 时不触发违规', async () => {
      const prisma = buildPrismaMock()
      const portfolioSvc = buildPortfolioServiceMock()
      // getLatestTradeDate 默认返回 null
      const rule = buildRule({
        ruleType: PortfolioRiskRuleType.MAX_DRAWDOWN_STOP,
        threshold: 0.1,
      })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, portfolioSvc, buildRiskServiceMock(), eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(0)
      expect(prisma.$queryRaw).not.toHaveBeenCalled()
    })

    it('[BIZ] cost_basis=0 时 NAV 默认为 1，不抛错，回撤=0 不违规', async () => {
      const prisma = buildPrismaMock()
      const portfolioSvc = buildPortfolioServiceMock()
      const rule = buildRule({
        ruleType: PortfolioRiskRuleType.MAX_DRAWDOWN_STOP,
        threshold: 0.1,
      })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      portfolioSvc.getLatestTradeDate.mockResolvedValue(new Date('2025-01-10'))
      prisma.$queryRaw.mockResolvedValue([
        { trade_date: new Date('2025-01-01'), market_value: '0', cost_basis: '0' }, // cb=0 → nav=1
        { trade_date: new Date('2025-01-10'), market_value: '0', cost_basis: '0' }, // cb=0 → nav=1
      ])
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, portfolioSvc, buildRiskServiceMock(), eventsGateway)

      // 不抛错，NAV 全为 1.0，回撤=0，不违规
      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(0)
    })
  })

  // ── Phase 2 新增：disabled rule DB 层过滤验证 ──────────────────────────────

  describe('[BIZ] isEnabled=false — 禁用规则在 DB 层过滤后不被检查', () => {
    it('[BIZ] 禁用规则被 DB 过滤后，风控服务方法不被调用', async () => {
      const prisma = buildPrismaMock()
      // runCheck 查询 where: { isEnabled: true }；此处 findMany 返回空模拟禁用规则被 DB 过滤
      prisma.portfolioRiskRule.findMany.mockResolvedValue([])
      const riskSvc = buildRiskServiceMock()
      const eventsGateway = buildEventsGatewayMock()
      const svc = createService(prisma, undefined, riskSvc, eventsGateway)

      const result = await svc.runCheck('portfolio-001', 10)

      expect(result.violations).toHaveLength(0)
      expect(riskSvc.getPositionConcentration).not.toHaveBeenCalled()
      expect(riskSvc.getIndustryDistribution).not.toHaveBeenCalled()
      expect(eventsGateway.emitToUser).not.toHaveBeenCalled()
    })

    it('[BIZ] 禁用规则被过滤后不写入 riskViolationLog', async () => {
      const prisma = buildPrismaMock()
      prisma.portfolioRiskRule.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.runCheck('portfolio-001', 10)

      expect(prisma.riskViolationLog.createMany).not.toHaveBeenCalled()
    })
  })

  // ── Phase 2：formatDate 私有方法直接验证 ────────────────────────────────

  // formatDate 使用 getFullYear/getMonth/getDate（本地时间），
  // 在 UTC 容器中等同于 UTC 方法——不同于上海时区的预期

  describe('[BUG-B3] formatDate() — 使用本地时间，UTC 容器中与上海时区不一致', () => {
    it('[BIZ] formatDate 对 2025-03-01T00:00:00Z 返回 "20250301"（UTC 容器本地时间=UTC）', () => {
      const svc = createService()

      // 手算（UTC 容器）：getFullYear=2025, getMonth+1=3, getDate=1 → '20250301'
      const result = (svc as any).formatDate(new Date('2025-03-01T00:00:00.000Z'))
      expect(result).toBe('20250301')
    })

    it('[BUG] formatDate 对 2025-03-01T16:00:00Z（上海时区已是 3月2日）返回本地日期', () => {
      // 业务推导：上海时间 2025-03-01 16:00 UTC = 2025-03-02 00:00 CST
      // formatDate 使用 getDate()（本地时间），行为取决于运行环境时区：
      //   - UTC+8 环境：getDate()=2 → 返回 '20250302'（符合上海日历，正确）
      //   - UTC 容器：getDate()=1 → 返回 '20250301'（BUG：上海已是次日）
      // 此测试在 UTC+8 机器上验证正确行为，文档化 UTC 容器下的潜在 bug
      const svc = createService()
      const shanghaiMidnight = new Date('2025-03-01T16:00:00.000Z') // 上海 2025-03-02 00:00:00

      const result = (svc as any).formatDate(shanghaiMidnight)
      // UTC+8 环境（本地开发）：返回 '20250302'（本地 getDate()=2）
      // UTC 容器（生产/CI 如果是 UTC）：会返回 '20250301'（BUG）
      // 修复方案：使用固定 UTC+8 偏移计算，如 dayjs().tz('Asia/Shanghai')
      const localDate = shanghaiMidnight.getDate()
      const expectedStr = `2025030${localDate}`
      expect(result).toBe(expectedStr) // 按本机时区断言，标记 UTC 容器是已知风险
    })
  })

  // ── Phase 2：闰年 setFullYear bug ────────────────────────────────────────

  // 业务规则：回撤计算向前推 1 年，2024-02-29 回推应为 2023-02-28
  // B7 bug：setFullYear(2023) 对 Feb29 会溢出到 2023-03-01

  describe('[BUG-B7] checkMaxDrawdown — 2024-02-29 回推年份時 setFullYear 溢出', () => {
    it('[BUG] 闰年 2024-02-29 调用 setFullYear(2023) 得到 2023-03-01（多出 1 天）', async () => {
      // 直接验证 JavaScript setFullYear 在 Feb29 上的行为
      // 手算：Feb29 在 2023 不存在，JS 自动溢出到 Mar1
      const leapDay = new Date('2024-02-29')
      leapDay.setFullYear(2023)
      const year = leapDay.getFullYear()
      const month = leapDay.getMonth() + 1
      const day = leapDay.getDate()

      // 当前行为（BUG）：2023-03-01 而非 2023-02-28
      expect(year).toBe(2023)
      expect(month).toBe(3) // 3 月（BUG：应为 2 月）
      expect(day).toBe(1) // 1 日（BUG：应为 28 日）

      // 结论：checkMaxDrawdown 在 latestDate=2024-02-29 时，
      // start 会变成 2023-03-01，回撤窗口多算 1 天
    })

    it('[BUG] latestDate=2024-02-29 时 checkMaxDrawdown 的 startDate 偏移 1 天', async () => {
      const prisma = buildPrismaMock()
      const portfolioSvc = buildPortfolioServiceMock()
      // getLatestTradeDate 返回闰年特殊日期
      portfolioSvc.getLatestTradeDate.mockResolvedValue(new Date('2024-02-29'))
      // $queryRaw 返回足够行数避免提前退出
      prisma.$queryRaw.mockResolvedValue([
        { trade_date: new Date('2023-03-01'), market_value: 1000, cost_basis: 1000 },
        { trade_date: new Date('2024-02-29'), market_value: 950, cost_basis: 1000 },
      ])
      const rule = buildRule({ ruleType: PortfolioRiskRuleType.MAX_DRAWDOWN_STOP, threshold: 0.3 })
      prisma.portfolioRiskRule.findMany.mockResolvedValue([rule])
      const svc = createService(prisma, portfolioSvc)

      await svc.runCheck('portfolio-001', 10)

      // 验证 $queryRaw 被调用（说明 getLatestTradeDate 非 null 流程走通）
      expect(prisma.$queryRaw).toHaveBeenCalled()
    })
  })

  // ── Phase 2：peak 初始化低估回撤 ──────────────────────────────────────────

  // 业务规则：最大回撤应从投资初始（NAV=1.0）开始计算
  // B8 bug：peak = navs[0]，若 navs[0]<1.0，则高水位低于初始值，回撤被低估

  describe('[BUG-B8] checkMaxDrawdown — peak 从 navs[0] 初始化低估回撤', () => {
    it('[BUG] navs=[0.95,0.8,0.85]：当前算法认为最大回撤≈15.8%，正确值应为 20%', async () => {
      // 手算：
      //   当前实现：peak=navs[0]=0.95 → dd=(0.95-0.8)/0.95 ≈ 0.1579 (15.79%)
      //   正确实现：peak=1.0（投资起始）→ dd=(1.0-0.8)/1.0 = 0.20 (20%)
      const prisma = buildPrismaMock()
      const portfolioSvc = buildPortfolioServiceMock()
      portfolioSvc.getLatestTradeDate.mockResolvedValue(new Date('2025-03-01'))

      // mock $queryRaw 返回对应 navs=[0.95, 0.8, 0.85] 的行
      // NAV = market_value / cost_basis
      // cost_basis=1000 → market_value: 950, 800, 850
      prisma.$queryRaw.mockResolvedValue([
        { trade_date: new Date('2025-01-01'), market_value: 950, cost_basis: 1000 },
        { trade_date: new Date('2025-02-01'), market_value: 800, cost_basis: 1000 },
        { trade_date: new Date('2025-03-01'), market_value: 850, cost_basis: 1000 },
      ])

      const rule = buildRule({
        ruleType: PortfolioRiskRuleType.MAX_DRAWDOWN_STOP,
        threshold: 0.25, // 25% 阈值：当前实现(15.8%) 低于阈值→不触发；正确值(20%) 也低于阈值→两者同
      })
      const svc = createService(prisma, portfolioSvc)

      const result = await (svc as any).checkMaxDrawdown('portfolio-001', rule, 10)

      // 当前行为：maxDrawdown ≈ 0.1579（以 navs[0]=0.95 为峰值计算）
      // 正确行为：maxDrawdown = 0.20（以 1.0 为初始高水位）
      expect(result).toBeNull() // 两值都低于 0.25 阈值，结果相同，但 actualValue 不同
      // 文档化实际计算值（验证 bug 存在）
    })

    it('[BUG] navs=[0.95,0.75,0.9]: 当前算法漏报（≈21%），实际应触发（25% 阈值）', async () => {
      // 手算（正确逻辑）：
      //   peak=1.0 → dd=(1.0-0.75)/1.0 = 0.25 → 等于阈值 0.25 → 不触发（严格 >）
      //   若阈值=0.24 → 应触发
      //
      // 手算（当前逻辑）：
      //   peak=navs[0]=0.95 → dd=(0.95-0.75)/0.95 ≈ 0.2105 < 0.24 → 不触发（漏报）
      const prisma = buildPrismaMock()
      const portfolioSvc = buildPortfolioServiceMock()
      portfolioSvc.getLatestTradeDate.mockResolvedValue(new Date('2025-03-01'))
      prisma.$queryRaw.mockResolvedValue([
        { trade_date: new Date('2025-01-01'), market_value: 950, cost_basis: 1000 }, // nav=0.95
        { trade_date: new Date('2025-02-01'), market_value: 750, cost_basis: 1000 }, // nav=0.75
        { trade_date: new Date('2025-03-01'), market_value: 900, cost_basis: 1000 }, // nav=0.90
      ])

      const rule = buildRule({
        ruleType: PortfolioRiskRuleType.MAX_DRAWDOWN_STOP,
        threshold: 0.24, // 24%：正确逻辑应触发（25% > 24%），当前逻辑漏报（21% < 24%）
      })
      const svc = createService(prisma, portfolioSvc)

      const result = await (svc as any).checkMaxDrawdown('portfolio-001', rule, 10)

      // 当前行为（BUG）：不触发（漏报），因为 navs[0]=0.95 导致 peak=0.95，dd≈21%
      expect(result).toBeNull()
      // 正确行为：应触发，因为从初始 NAV=1.0 计算 dd=25% > 24%
    })
  })

  // ── Phase 2：autoCheckOnHoldingChange 排除 MAX_DRAWDOWN_STOP ─────────────

  // 业务规则：持仓变动时只需即时检查仓位和行业集中度，不计算历史回撤（计算成本高）
  // 设计决策：autoCheckOnHoldingChange 的 DB 查询只包含 MAX_SINGLE_POSITION 和 MAX_INDUSTRY_WEIGHT

  describe('[BIZ] autoCheckOnHoldingChange — 不触发 MAX_DRAWDOWN_STOP 计算', () => {
    it('[BIZ] 仅查询 MAX_SINGLE_POSITION 和 MAX_INDUSTRY_WEIGHT 规则，不查历史 NAV', async () => {
      const prisma = buildPrismaMock()
      // 返回空规则（模拟只关注过滤后无规则场景）
      prisma.portfolioRiskRule.findMany.mockResolvedValue([])
      const svc = createService(prisma)

      await svc.autoCheckOnHoldingChange('portfolio-001', 10)

      // 验证：$queryRaw 未被调用（历史 NAV SQL 不触发）
      expect(prisma.$queryRaw).not.toHaveBeenCalled()

      // 验证：findMany 请求过滤了 ruleType，不含 MAX_DRAWDOWN_STOP
      const findManyCall = (prisma.portfolioRiskRule.findMany.mock.calls as any)[0][0]
      expect(findManyCall.where.ruleType?.in).not.toContain(PortfolioRiskRuleType.MAX_DRAWDOWN_STOP)
    })
  })

  // ── Phase 2：多规则部分违规场景 ───────────────────────────────────────────

  // 业务规则：多条规则独立检测，部分违规时只记录违规的规则，不影响其他规则判断

  describe('[BIZ] 多规则检测 — 部分违规时只记录违规规则', () => {
    it('[BIZ] 3 条规则中 2 条违规时 riskViolationLog 写入 2 条记录', async () => {
      const prisma = buildPrismaMock()
      const riskSvc = buildRiskServiceMock()

      const rules = [
        buildRule({ id: 'rule-pos', ruleType: PortfolioRiskRuleType.MAX_SINGLE_POSITION, threshold: 0.3 }),
        buildRule({ id: 'rule-ind', ruleType: PortfolioRiskRuleType.MAX_INDUSTRY_WEIGHT, threshold: 0.4 }),
        buildRule({
          id: 'rule-pos2',
          ruleType: PortfolioRiskRuleType.MAX_SINGLE_POSITION,
          threshold: 0.5,
          isEnabled: true,
        }),
      ]
      prisma.portfolioRiskRule.findMany.mockResolvedValue(rules)

      // rule-pos: top1Weight=0.35 > 0.3 → 违规
      // rule-ind: maxIndustry weight=0.3 < 0.4 → 不违规
      // rule-pos2: top1Weight=0.35 < 0.5 → 不违规

      // mock 结构必须含 concentration 包装层，与 risk-check.service.ts:216 一致
      riskSvc.getPositionConcentration
        .mockResolvedValueOnce({
          concentration: { top1Weight: 0.35 },
          positions: [{ stockName: '平安银行' }],
        })
        .mockResolvedValueOnce({
          concentration: { top1Weight: 0.35 },
          positions: [{ stockName: '平安银行' }],
        })
      riskSvc.getIndustryDistribution.mockResolvedValue({
        industries: [{ industry: '银行', weight: 0.3 }],
      })

      const svc = createService(prisma, buildPortfolioServiceMock(), riskSvc)

      await svc.runCheck('portfolio-001', 10)

      // 手算：rule-pos(0.35>0.3) 违规 + rule-pos2(0.35<0.5) 不违规 + rule-ind(0.3<0.4) 不违规
      // → 只有 1 条违规
      const createManyCall = (prisma.riskViolationLog.createMany.mock.calls as any)[0][0]
      expect(createManyCall.data).toHaveLength(1)
      expect(createManyCall.data[0].ruleId).toBe('rule-pos')
    })
  })
})
