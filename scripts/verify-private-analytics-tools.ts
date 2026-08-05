import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PrismaClient, UserRole, UserStatus } from '@prisma/client'
import { BacktestAnalyticsRepository } from 'src/apps/backtest/backtest-analytics.repository'
import { BacktestAnalyticsToolFacade } from 'src/apps/backtest/backtest-analytics-tool.facade'
import { BacktestMonteCarloService } from 'src/apps/backtest/services/backtest-monte-carlo.service'
import { PortfolioAnalyticsRepository } from 'src/apps/portfolio/portfolio-analytics.repository'
import { PortfolioAnalyticsToolFacade } from 'src/apps/portfolio/portfolio-analytics-tool.facade'
import {
  PORTFOLIO_NAV_ALGORITHM_VERSION,
  PortfolioSnapshotService,
} from 'src/apps/portfolio/portfolio-snapshot.service'
import { buildAgentToolsConfig } from 'src/config/agent-tools.config'
import type { PrismaService } from 'src/shared/prisma.service'
import { createSaveResearchReportToolDefinition } from 'src/apps/agent/tools/adapters/save-research-report.tool'
import { ToolPolicyDeniedError, ToolPolicyService } from 'src/apps/agent/tools/tool-policy.service'

loadDatabaseUrl()
const prisma = new PrismaClient()
const shared = prisma as unknown as PrismaService

const thresholds = { backtestAnalytics: 5_000, portfolioAnalytics: 1_000 } as const
type Measurement = keyof typeof thresholds

async function main(): Promise<void> {
  const snapshotBuild = await new PortfolioSnapshotService(shared).rebuildLatestForAll()
  const portfolio = await prisma.portfolio.findFirst({
    where: { isArchived: false, dailySnapshots: { some: { algorithmVersion: PORTFOLIO_NAV_ALGORITHM_VERSION } } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, userId: true },
  })
  if (!portfolio) throw new Error('缺少可验收的组合点时快照')

  const runRows = await prisma.$queryRaw<Array<{ id: string; userId: number }>>`
    SELECT r.id, r.user_id AS "userId"
    FROM backtest_runs r
    WHERE r.status = 'COMPLETED' AND r.deleted_at IS NULL
      AND (SELECT COUNT(*) FROM backtest_daily_navs n WHERE n.run_id = r.id) >= 2
    ORDER BY r.completed_at DESC NULLS LAST, r.id
    LIMIT 1
  `
  const run = runRows[0]
  if (!run) throw new Error('缺少至少两个 NAV 点的已完成回测')

  const monteCarlo = new BacktestMonteCarloService(shared)
  const readPort = {
    monteCarlo: (
      runId: string,
      userId: number,
      input: { simulations: number; seed: number; confidenceLevels: number[] },
    ) =>
      monteCarlo.runMonteCarloSimulation(
        runId,
        { numSimulations: input.simulations, seed: input.seed, confidenceLevels: input.confidenceLevels },
        userId,
      ),
    brinson: () => Promise.reject(new Error('本验收不调用 Brinson')),
    costSensitivity: () => Promise.reject(new Error('本验收不调用成本敏感度')),
    getParamSweepResult: () => Promise.reject(new Error('本验收不读参数扫描')),
    getWalkForwardResult: () => Promise.reject(new Error('本验收不读 Walk Forward')),
    getComparisonResult: () => Promise.reject(new Error('本验收不读回测对比')),
  }
  const backtestTool = new BacktestAnalyticsToolFacade(new BacktestAnalyticsRepository(shared), readPort)
  const portfolioTool = new PortfolioAnalyticsToolFacade(new PortfolioAnalyticsRepository(shared))
  const durations: Record<Measurement, number[]> = { backtestAnalytics: [], portfolioAnalytics: [] }

  const backtestResults = []
  for (let index = 0; index < 5; index += 1) {
    backtestResults.push(
      await measure('backtestAnalytics', durations, () =>
        backtestTool.analyze(run.userId, {
          analyses: ['MONTE_CARLO'],
          backtestRunId: run.id,
          monteCarlo: { simulations: 100, seed: 42, maxSeriesPoints: 20 },
        }),
      ),
    )
  }
  const monteCarloData = backtestResults.map((result) => result.data.monteCarlo)
  if (monteCarloData.some((section) => section.status !== 'OK')) throw new Error('Monte Carlo 真实库验收失败')
  if (new Set(monteCarloData.map((value) => JSON.stringify(value))).size !== 1) {
    throw new Error('相同 seed 的 Monte Carlo 结果不可复现')
  }

  let portfolioResult: Awaited<ReturnType<PortfolioAnalyticsToolFacade['analyze']>> | null = null
  for (let index = 0; index < 10; index += 1) {
    portfolioResult = await measure('portfolioAnalytics', durations, () =>
      portfolioTool.analyze(portfolio.userId, { portfolioId: portfolio.id, sections: ['OVERVIEW', 'PERFORMANCE'] }),
    )
  }
  if (!portfolioResult || portfolioResult.data.overview.status !== 'OK') {
    throw new Error('组合概览真实库验收失败')
  }

  const latestDate = await prisma.portfolioDailySnapshot.findFirst({
    where: { portfolioId: portfolio.id },
    orderBy: { tradeDate: 'desc' },
    select: { tradeDate: true },
  })
  if (!latestDate) throw new Error('组合快照水位不存在')
  const explain = await explainQueries(portfolio.id, portfolio.userId, latestDate.tradeDate)
  const reportPreview = verifyReportPreviewPolicy()
  const performance = Object.fromEntries(
    (Object.keys(thresholds) as Measurement[]).map((name) => [
      name,
      {
        samples: durations[name].length,
        p50Ms: percentile(durations[name], 0.5),
        p95Ms: percentile(durations[name], 0.95),
        targetP95Ms: thresholds[name],
      },
    ]),
  )
  const counts = await Promise.all([
    prisma.portfolioHoldingEvent.count(),
    prisma.portfolioDailySnapshot.count(),
    prisma.portfolioPositionSnapshot.count(),
  ])
  process.stdout.write(
    `${JSON.stringify(
      {
        samples: { completedBacktestRuns: 1, portfolios: 1 },
        pointInTimeData: {
          holdingEvents: counts[0],
          dailySnapshots: counts[1],
          positionSnapshots: counts[2],
          dataThrough: portfolioResult.asOf,
          algorithmVersion: PORTFOLIO_NAV_ALGORITHM_VERSION,
          latestBuild: snapshotBuild,
        },
        gates: {
          backtestAnalytics: true,
          portfolioAnalytics: true,
          reportPreview,
        },
        behavior: {
          monteCarloDeterministic: true,
          portfolioPerformanceStatus: portfolioResult.data.performance.status,
        },
        explain,
        performance,
      },
      null,
      2,
    )}\n`,
  )

  for (const name of Object.keys(thresholds) as Measurement[]) {
    const p95 = percentile(durations[name], 0.95)
    if (p95 === null || p95 > thresholds[name]) throw new Error(`${name} P95 ${p95}ms 超过 ${thresholds[name]}ms`)
  }
}

async function explainQueries(portfolioId: string, userId: number, tradeDate: Date) {
  const events = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM portfolio_holding_events WHERE portfolio_id = $1 AND user_id = $2 AND effective_date <= $3::date ORDER BY effective_date, occurred_at, id',
    portfolioId,
    userId,
    tradeDate,
  )
  const snapshots = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT s.* FROM portfolio_daily_snapshots s JOIN portfolios p ON p.id = s.portfolio_id WHERE s.portfolio_id = $1 AND p."userId" = $2 AND s.trade_date <= $3::date ORDER BY s.trade_date',
    portfolioId,
    userId,
    tradeDate,
  )
  return { eventsExecutionMs: executionTime(events), snapshotsExecutionMs: executionTime(snapshots) }
}

function executionTime(rows: Array<Record<string, unknown>>): number | null {
  const plan = rows[0]?.['QUERY PLAN']
  if (!Array.isArray(plan) || !plan[0] || typeof plan[0] !== 'object') return null
  const value = (plan[0] as Record<string, unknown>)['Execution Time']
  return typeof value === 'number' ? value : null
}

function verifyReportPreviewPolicy() {
  const definition = createSaveResearchReportToolDefinition()
  const config = buildAgentToolsConfig({ AGENT_TOOLS_ENABLED: 'save_research_report' })
  try {
    new ToolPolicyService(config).authorize(definition, {
      userId: 1,
      role: UserRole.USER,
      userStatus: UserStatus.ACTIVE,
      scopeId: 'verification',
      conversationId: 'verification',
      runId: 'verification-run',
      stepId: 'verification-step',
      traceId: 'verification-trace',
      workflowAllowedTools: ['save_research_report'],
      allowedScopes: ['USER_PRIVATE'],
      callsUsed: 0,
      deadlineAt: new Date(Date.now() + 60_000),
    })
  } catch (error) {
    if (
      error instanceof ToolPolicyDeniedError &&
      error.code === 'CONFIRMATION_REQUIRED' &&
      error.details?.action === 'OPEN_REPORT_PREVIEW' &&
      error.details.runId === 'verification-run'
    ) {
      return { enabled: true, confirmationTokenExposed: false }
    }
    throw error
  }
  throw new Error('报告保存未被确认策略拦截')
}

async function measure<T>(name: Measurement, durations: Record<Measurement, number[]>, operation: () => Promise<T>) {
  const startedAt = performance.now()
  const result = await operation()
  durations[name].push(performance.now() - startedAt)
  return result
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  return Math.round(sorted[Math.ceil(sorted.length * quantile) - 1] * 100) / 100
}

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return
  const envPath = resolve('.env')
  if (!existsSync(envPath)) throw new Error('缺少 DATABASE_URL，且未找到 .env')
  const match = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(?:"([^"]+)"|([^#\r\n]+))/m)
  const value = match?.[1] ?? match?.[2]?.trim()
  if (!value) throw new Error('.env 中缺少 DATABASE_URL')
  process.env.DATABASE_URL = value
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
