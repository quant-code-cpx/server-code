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
})
