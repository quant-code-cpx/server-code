/**
 * OPT-4.2 策略研究报告 — 单元测试
 *
 * 覆盖要点：
 * - ReportDataCollectorService.collectStrategyResearchData:
 *   - 回测记录不存在时抛异常（findFirstOrThrow）
 *   - 正常返回 overview + backtestPerformance + holdingsAnalysis
 *   - sections.performance=false 时跳过 backtestPerformance
 *   - portfolioId 存在且 tradeLog=true 时返回 tradeLogs
 *   - portfolioId 不存在时 tradeLogs 为 null
 * - ReportService.createStrategyResearchReport:
 *   - 回测不存在时抛异常
 *   - 正常调用 generateReport 并使用 STRATEGY_RESEARCH 类型
 */

import { BusinessException } from 'src/common/exceptions/business.exception'
import { ReportDataCollectorService } from '../services/report-data-collector.service'
import { ReportService } from '../report.service'
import { CreateStrategyResearchReportDto } from '../dto/create-report.dto'
import { ReportFormat, ReportStatus, ReportType } from '@prisma/client'
import dayjs from 'dayjs'

// ─── Prisma Mock ─────────────────────────────────────────────────────────────

function buildPrismaMock(overrides: Record<string, unknown> = {}) {
  const now = new Date()
  const runData = {
    id: 'run-1',
    userId: 1,
    name: '动量策略',
    strategyType: 'MOMENTUM',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    benchmarkTsCode: '000300.SH',
    benchmarkReturn: 0.08,
    totalReturn: 0.25,
    annualizedReturn: 0.23,
    maxDrawdown: -0.12,
    sharpeRatio: 1.5,
    volatility: 0.18,
    winRate: 0.55,
    excessReturn: 0.17,
    beta: 0.9,
    alpha: 0.15,
    sortinoRatio: 2.0,
    calmarRatio: 1.9,
    tradeCount: 120,
    createdAt: now,
    initialCapital: 1000000,
    strategyConfig: {},
  }

  return {
    backtestRun: {
      findFirstOrThrow: jest.fn(async () => runData),
      findFirst: jest.fn(async () => runData),
    },
    backtestPositionSnapshot: {
      findFirst: jest.fn(async () => ({ tradeDate: new Date('2024-12-31') })),
      findMany: jest.fn(async () => [
        { tsCode: '000001.SZ', weight: 0.15, quantity: 1000, unrealizedPnl: 500 },
        { tsCode: '600036.SH', weight: 0.12, quantity: 800, unrealizedPnl: 300 },
      ]),
    },
    stockBasic: {
      findMany: jest.fn(async () => [
        { tsCode: '000001.SZ', name: '平安银行', industry: '银行' },
        { tsCode: '600036.SH', name: '招商银行', industry: '银行' },
      ]),
    },
    portfolioTradeLog: {
      findMany: jest.fn(async () => [
        {
          tsCode: '000001.SZ',
          stockName: '平安银行',
          action: 'ADD',
          quantity: 100,
          price: 10.5,
          reason: 'MANUAL',
          createdAt: now,
        },
      ]),
      groupBy: jest.fn(async () => [
        { action: 'ADD', reason: 'MANUAL', tsCode: '000001.SZ', stockName: '平安银行', _count: { id: 5 } },
      ]),
    },
    report: {
      create: jest.fn(async (args) => ({ id: 'report-1', ...args.data })),
      update: jest.fn(async (args) => ({ id: 'report-1', ...args.data })),
    },
    ...overrides,
  }
}

// ─── ReportDataCollectorService Tests ────────────────────────────────────────

describe('ReportDataCollectorService.collectStrategyResearchData()', () => {
  it('should throw if backtestRun not found (findFirstOrThrow)', async () => {
    const prisma = buildPrismaMock()
    prisma.backtestRun.findFirstOrThrow = jest.fn(async () => {
      throw new Error('Not found')
    })
    const svc = new ReportDataCollectorService(prisma as any)

    await expect(svc.collectStrategyResearchData('bad-id', 1, {})).rejects.toThrow()
  })

  it('should return overview with correct strategy name', async () => {
    const prisma = buildPrismaMock()
    const svc = new ReportDataCollectorService(prisma as any)

    const result = await svc.collectStrategyResearchData('run-1', 1, {})

    expect(result.sections.overview).toMatchObject({
      strategyName: '动量策略',
      strategyType: 'MOMENTUM',
      backtestRunId: 'run-1',
    })
  })

  it('should include backtestPerformance by default', async () => {
    const prisma = buildPrismaMock()
    const svc = new ReportDataCollectorService(prisma as any)

    const result = await svc.collectStrategyResearchData('run-1', 1, {})

    expect(result.sections.backtestPerformance).not.toBeNull()
    expect(result.sections.backtestPerformance?.sharpe).toBeCloseTo(1.5, 1)
  })

  it('should skip backtestPerformance when sections.performance=false', async () => {
    const prisma = buildPrismaMock()
    const svc = new ReportDataCollectorService(prisma as any)

    const result = await svc.collectStrategyResearchData('run-1', 1, {
      sections: { performance: false },
    })

    expect(result.sections.backtestPerformance).toBeNull()
  })

  it('should include holdingsAnalysis by default (top10 + industry)', async () => {
    const prisma = buildPrismaMock()
    const svc = new ReportDataCollectorService(prisma as any)

    const result = await svc.collectStrategyResearchData('run-1', 1, {})

    expect(result.sections.holdingsAnalysis).not.toBeNull()
    expect(result.sections.holdingsAnalysis?.topHoldings).toHaveLength(2)
    expect(result.sections.holdingsAnalysis?.industryDistribution).toHaveLength(1) // both in 银行
  })

  it('should return null tradeLogs when portfolioId not provided', async () => {
    const prisma = buildPrismaMock()
    const svc = new ReportDataCollectorService(prisma as any)

    const result = await svc.collectStrategyResearchData('run-1', 1, {})

    expect(result.sections.tradeLogs).toBeNull()
  })

  it('should return tradeLogs when portfolioId + tradeLog=true', async () => {
    const prisma = buildPrismaMock()
    const svc = new ReportDataCollectorService(prisma as any)

    const result = await svc.collectStrategyResearchData('run-1', 1, {
      portfolioId: 'port-1',
      sections: { tradeLog: true },
    })

    expect(result.sections.tradeLogs).not.toBeNull()
    expect(result.sections.tradeLogs?.recentLogs).toHaveLength(1)
    expect(prisma.portfolioTradeLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { portfolioId: 'port-1', userId: 1 } }),
    )
  })

  it('should skip tradeLogs when tradeLog=false even with portfolioId', async () => {
    const prisma = buildPrismaMock()
    const svc = new ReportDataCollectorService(prisma as any)

    const result = await svc.collectStrategyResearchData('run-1', 1, {
      portfolioId: 'port-1',
      sections: { tradeLog: false },
    })

    expect(result.sections.tradeLogs).toBeNull()
    expect(prisma.portfolioTradeLog.findMany).not.toHaveBeenCalled()
  })

  it('should include generatedAt in ISO-like format', async () => {
    const prisma = buildPrismaMock()
    const svc = new ReportDataCollectorService(prisma as any)

    const result = await svc.collectStrategyResearchData('run-1', 1, {})

    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

// ─── ReportService.createStrategyResearchReport Tests ────────────────────────

describe('ReportService.createStrategyResearchReport()', () => {
  function buildService(prisma = buildPrismaMock()) {
    const dataCollector = new ReportDataCollectorService(prisma as any)
    const rendererMock = {
      renderToHtmlFile: jest.fn(async () => ({ filePath: '/tmp/test.html', fileSize: 100 })),
      renderToPdf: jest.fn(async () => ({ filePath: '/tmp/test.pdf', fileSize: 200 })),
    }
    return { svc: new ReportService(prisma as any, dataCollector, rendererMock as any), prisma }
  }

  it('should throw BusinessException if backtestRun not owned', async () => {
    const prisma = buildPrismaMock()
    prisma.backtestRun.findFirst = jest.fn(async () => null)
    const { svc } = buildService(prisma)

    const dto: CreateStrategyResearchReportDto = { backtestRunId: 'run-99' }
    await expect(svc.createStrategyResearchReport(dto, 1)).rejects.toThrow(BusinessException)
  })

  it('should create report record with STRATEGY_RESEARCH type', async () => {
    const prisma = buildPrismaMock()
    const { svc } = buildService(prisma)

    const dto: CreateStrategyResearchReportDto = { backtestRunId: 'run-1' }
    await svc.createStrategyResearchReport(dto, 1)

    expect(prisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: ReportType.STRATEGY_RESEARCH,
          status: ReportStatus.PENDING,
          userId: 1,
        }),
      }),
    )
  })

  it('should auto-generate title from strategy name', async () => {
    const prisma = buildPrismaMock()
    const { svc } = buildService(prisma)

    const dto: CreateStrategyResearchReportDto = { backtestRunId: 'run-1' }
    await svc.createStrategyResearchReport(dto, 1)

    expect(prisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: expect.stringContaining('动量策略'),
        }),
      }),
    )
  })

  it('should use custom title when provided', async () => {
    const prisma = buildPrismaMock()
    const { svc } = buildService(prisma)

    const dto: CreateStrategyResearchReportDto = { backtestRunId: 'run-1', title: '自定义研究报告' }
    await svc.createStrategyResearchReport(dto, 1)

    expect(prisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ title: '自定义研究报告' }),
      }),
    )
  })
})
