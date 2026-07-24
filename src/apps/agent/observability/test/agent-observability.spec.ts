import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { UserRole } from '@prisma/client'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { ROLES_KEY } from 'src/common/decorators/roles.decorator'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { RolesGuard } from 'src/lifecycle/guard/roles.guard'
import { AgentEvaluationAdminController } from '../../api/agent-evaluation-admin.controller'
import { AgentStrictBodyGuard } from '../../api/agent-strict-body.guard'
import { AgentCostService } from '../agent-cost.service'
import { AgentMetricsService } from '../agent-metrics.service'
import { AgentTracingService } from '../agent-tracing.service'
import { AgentEvaluationService } from '../evaluation/agent-evaluation.service'
import { evaluateAgentRegression } from '../evaluation/agent-evaluation-runner'

describe('Agent observability business contracts', () => {
  it('OBS-BIZ-002: provider 原始成本优先于价格表，且只记一次 provider 成本', () => {
    const metrics = { observeCost: jest.fn() }
    const service = new AgentCostService(
      {
        enabled: true,
        traceSampleRate: 1,
        priceCatalogVersion: 'catalog-v1',
        priceCatalog: [
          {
            provider: 'fake',
            model: 'fake-v1',
            currency: 'CNY',
            inputPerMillion: 2,
            outputPerMillion: 4,
            cachedPerMillion: 0,
            reasoningPerMillion: 0,
          },
        ],
      },
      metrics as never,
    )

    const cost = service.estimate(
      { provider: 'fake', model: 'fake-v1' },
      {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        providerCost: { amount: '0.42', currency: 'USD', estimated: false },
      },
    )

    expect(cost).toEqual({
      amount: 0.42,
      currency: 'USD',
      estimated: false,
      source: 'provider',
      priceCatalogVersion: null,
    })
    expect(metrics.observeCost).toHaveBeenCalledTimes(1)
    expect(metrics.observeCost).toHaveBeenCalledWith(expect.objectContaining({ amount: 0.42, source: 'provider' }))
  })

  it('OBS-EDGE-001: usage 或价目缺失时返回 unknown，不伪造 0 成本', () => {
    const metrics = { observeCost: jest.fn() }
    const service = new AgentCostService(
      { enabled: true, traceSampleRate: 1, priceCatalogVersion: 'empty', priceCatalog: [] },
      metrics as never,
    )

    expect(service.estimate({ provider: 'unknown', model: 'unknown-v1' }, null)).toEqual({
      amount: null,
      currency: null,
      estimated: false,
      source: null,
      priceCatalogVersion: null,
    })
    expect(metrics.observeCost).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'unknown', amount: null, currency: null }),
    )
  })

  it('OBS-SEC-001: Tool 指标仅含稳定 tool label，不泄露 run/user/trace 标识', () => {
    const counter = { inc: jest.fn() }
    const histogram = { observe: jest.fn() }
    const gauge = { set: jest.fn() }
    const metrics = new AgentMetricsService(
      counter as never,
      histogram as never,
      histogram as never,
      counter as never,
      histogram as never,
      histogram as never,
      counter as never,
      counter as never,
      counter as never,
      counter as never,
      histogram as never,
      histogram as never,
      gauge as never,
      counter as never,
    )

    metrics.onCompleted({
      toolKey: 'get_stock_overview',
      durationMs: 20,
      resultBytes: 40,
      dataAsOf: null,
    })

    expect(counter.inc).toHaveBeenCalledWith({ tool: 'get_stock_overview', status: 'SUCCEEDED' })
    expect(JSON.stringify(counter.inc.mock.calls)).not.toContain('runId')
  })

  it('OBS-ERR-001: trace exporter 关闭时不影响受包裹业务', async () => {
    const work = jest.fn().mockResolvedValue({ status: 'ok' })
    const tracing = new AgentTracingService(
      { enabled: false, traceSampleRate: 0, priceCatalogVersion: 'unused', priceCatalog: [] },
      { observeSpan: jest.fn() } as never,
      { log: jest.fn(), warn: jest.fn() } as never,
    )

    await expect(tracing.span('agent.workflow', { traceId: 'trace_1', runId: 'run_1' }, work)).resolves.toEqual({
      status: 'ok',
    })
    expect(work).toHaveBeenCalledTimes(1)
  })

  it('OBS-REG-001: versioned dataset 阈值退化会让 gate 失败', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-evaluation-'))
    try {
      const datasetDir = join(root, 'test/agent/evaluation-datasets')
      const fixturesDir = join(root, 'test/agent/fixtures')
      mkdirSync(datasetDir, { recursive: true })
      mkdirSync(fixturesDir, { recursive: true })
      writeFileSync(
        join(datasetDir, 'mvp.json'),
        JSON.stringify({
          schemaVersion: 1,
          id: 'mvp',
          version: 'test-v1',
          workflowVersion: 'stock_research@1',
          promptVersion: 'test-prompt',
          modelVersion: 'fake-v1',
          provider: 'fake',
          financialFixture: 'test/agent/fixtures/financial-golden-cases.json',
          modelFixture: 'test/agent/fixtures/model-regression-cases.jsonl',
          thresholds: {
            minFactScore: 1,
            minCitationCoverage: 1,
            requireToolTraceMatch: true,
            maxLatencyMs: 10,
            maxTotalCost: 0,
          },
        }),
      )
      writeFileSync(
        join(fixturesDir, 'financial-golden-cases.json'),
        readFileSync('test/agent/fixtures/financial-golden-cases.json'),
      )
      writeFileSync(
        join(fixturesDir, 'model-regression-cases.jsonl'),
        readFileSync('test/agent/fixtures/model-regression-cases.jsonl'),
      )

      const summary = evaluateAgentRegression(root, { provider: 'fake', dataset: 'mvp' })
      expect(summary.pass).toBe(false)
      expect(summary.gate.failures).toContain('capability-overview: latency 120 exceeds gate')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('OBS-RACE-001: 相同管理员幂等键复用同一评测运行', async () => {
    const existing = evaluationRun({ id: 'evaluation_existing' })
    const prisma = {
      aiEvaluationRun: { findUnique: jest.fn().mockResolvedValue(existing) },
    }
    const service = new AgentEvaluationService(prisma as never)

    const first = await service.run(7, {
      clientRequestId: '036d7d3b-cced-41a2-a1cc-4e0131300c82',
      dataset: 'mvp',
      provider: 'fake',
    })
    const second = await service.run(7, {
      clientRequestId: '036d7d3b-cced-41a2-a1cc-4e0131300c82',
      dataset: 'mvp',
      provider: 'fake',
    })

    expect(first.evaluationRunId).toBe('evaluation_existing')
    expect(second.evaluationRunId).toBe(first.evaluationRunId)
    expect(prisma.aiEvaluationRun.findUnique).toHaveBeenCalledTimes(2)
  })

  it('OBS-SEC-002: 管理员评测端点绑定 JWT、RolesGuard、ADMIN 与严格 DTO', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AgentEvaluationAdminController)).toEqual([UserRole.ADMIN])
    expect(Reflect.getMetadata(GUARDS_METADATA, AgentEvaluationAdminController)).toEqual([
      JwtAuthGuard,
      RolesGuard,
      AgentStrictBodyGuard,
    ])
  })
})

function evaluationRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evaluation_1',
    requestedByUserId: 7,
    clientRequestId: '036d7d3b-cced-41a2-a1cc-4e0131300c82',
    datasetId: 'mvp',
    datasetVersion: '2026-07-22',
    datasetHash: 'a'.repeat(64),
    workflowVersion: 'stock_research@1',
    promptVersion: 'mvp-20260720',
    modelVersion: 'fake-v1',
    provider: 'fake',
    status: 'COMPLETED',
    gatePassed: true,
    totalCases: 4,
    passedCases: 4,
    failedCases: 0,
    totalCost: { toNumber: () => 0 },
    costCurrency: 'CNY',
    summary: { pass: true },
    artifactRef: 'agent-evaluation://mvp',
    errorMessage: null,
    startedAt: new Date('2026-07-22T00:00:00.000Z'),
    endedAt: new Date('2026-07-22T00:00:01.000Z'),
    ...overrides,
  }
}
