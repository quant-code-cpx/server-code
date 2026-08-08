import { UserRole, UserStatus } from '@prisma/client'
import { ToolExecutionError } from '../../tools/contracts/tool-error'
import { ToolRegistryError } from '../../tools/tool-registry.service'
import { WorkflowCancelledError, WorkflowExecutionError, WorkflowValidationError } from '../workflow.errors'
import { normalizePlannedToolInput, summarizeFactData, WorkflowToolService } from '../workflow-tool.service'
import type { CompiledResearchPlan } from '../workflow.types'

describe('WorkflowToolService', () => {
  const registry = {
    freezeSnapshot: jest.fn(),
    get: jest.fn(),
  }
  const executor = { execute: jest.fn() }
  const budgets = {
    assertCanPlanToolCalls: jest.fn(),
    assertUsage: jest.fn(),
  }

  let service: WorkflowToolService

  beforeEach(() => {
    jest.clearAllMocks()
    registry.freezeSnapshot.mockImplementation((pins) => ({ entries: pins, signature: 'snapshot' }))
    registry.get.mockImplementation((key, version) => ({
      key,
      version,
      policy: { sideEffect: 'READ', idempotent: true, requiresConfirmation: false },
    }))
    service = new WorkflowToolService(registry as never, executor as never, budgets as never)
  })

  it('[SEC] 只允许幂等只读 Tool 或需确认的报告预览提案', () => {
    expect(service.authorize(plan([{ id: 'read', toolKey: 'get_stock_overview' }]))).toMatchObject({
      snapshotSignature: 'snapshot',
      allowedTools: ['get_stock_overview'],
    })

    registry.get.mockReturnValueOnce({
      key: 'save_research_report',
      version: 1,
      policy: { sideEffect: 'WRITE', idempotent: true, requiresConfirmation: true },
    })
    expect(service.authorize(plan([{ id: 'report', toolKey: 'save_research_report' }]))).toMatchObject({
      allowedTools: ['save_research_report'],
    })

    registry.get.mockReturnValueOnce({
      key: 'save_research_report',
      version: 1,
      policy: { sideEffect: 'WRITE', idempotent: true, requiresConfirmation: false },
    })
    expect(() => service.authorize(plan([{ id: 'unsafe', toolKey: 'save_research_report' }]))).toThrow(
      WorkflowValidationError,
    )
  })

  it('[ERR] Tool Registry 版本缺失映射为稳定 6008', () => {
    registry.freezeSnapshot.mockImplementationOnce(() => {
      throw new ToolRegistryError('tool version missing')
    })

    expect(() => service.authorize(plan([]))).toThrow(expect.objectContaining({ agentCode: 6008, retryable: false }))
  })

  it('[BIZ] 零 Tool 计划不调用执行器且用量不增长', async () => {
    const result = await service.execute(command(plan([])))

    expect(result).toEqual({ facts: [], warnings: [], usage: usage() })
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('[RACE] Run 已取消时不启动 Tool', async () => {
    const abort = new AbortController()
    abort.abort()

    await expect(
      service.execute({ ...command(plan([{ id: 'overview', toolKey: 'get_stock_overview' }])), signal: abort.signal }),
    ).rejects.toBeInstanceOf(WorkflowCancelledError)
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('[DATA] executionLevels 引用不存在调用时稳定拒绝', async () => {
    const invalid = plan([])
    invalid.executionLevels = [['missing']]

    await expect(service.execute(command(invalid))).rejects.toBeInstanceOf(WorkflowValidationError)
  })

  it('[RACE] Tool 返回 CANCELLED 时转换为 Workflow 取消，不进入可选降级', async () => {
    executor.execute.mockRejectedValue(toolError('CANCELLED', 'Tool 已取消', false))

    await expect(
      service.execute(command(plan([{ id: 'overview', toolKey: 'get_stock_overview', optional: true }]))),
    ).rejects.toBeInstanceOf(WorkflowCancelledError)
  })

  it.each([
    [toolError('DATA_NOT_FOUND', '无行情数据', false), 6013, false],
    [new Error('DATABASE_URL=secret'), 6099, true],
  ])('[ERR] required Tool 失败映射为稳定受控错误 %#', async (failure, agentCode, retryable) => {
    executor.execute.mockRejectedValue(failure)

    await expect(
      service.execute(command(plan([{ id: 'overview', toolKey: 'get_stock_overview' }]))),
    ).rejects.toMatchObject({ category: 'TOOL', agentCode, retryable })
  })

  it('[ERR] optional Tool 的未知异常只输出通用 warning', async () => {
    executor.execute.mockRejectedValue(new Error('DATABASE_URL=secret'))

    const result = await service.execute(
      command(plan([{ id: 'overview', toolKey: 'get_stock_overview', optional: true }])),
    )

    expect(result.warnings).toEqual(['可选 Tool get_stock_overview 失败：Tool 执行失败'])
    expect(JSON.stringify(result)).not.toContain('DATABASE_URL')
    expect(result.usage.toolCalls).toBe(1)
  })

  it('[ERR] optional Tool 的受控 Workflow 错误保留安全消息', async () => {
    executor.execute.mockRejectedValue(new WorkflowExecutionError('TOOL', 6013, false, '请求区间无数据'))

    const result = await service.execute(
      command(plan([{ id: 'overview', toolKey: 'get_stock_overview', optional: true }])),
    )

    expect(result.warnings).toEqual(['可选 Tool get_stock_overview 失败：请求区间无数据'])
  })

  it('[BIZ] 因子计划只清理跨分析参数，并为时序分析补全一年窗口', () => {
    expect(
      normalizePlannedToolInput(
        'get_factor_analysis',
        {
          analysis: 'IC',
          factorNames: ['pe_ttm'],
          forwardDays: 5,
          quantiles: 5,
          unexpected: 'preserve-for-schema-validation',
        },
        new Date('2026-08-07T00:00:00.000Z'),
      ),
    ).toEqual({
      analysis: 'IC',
      factorNames: ['pe_ttm'],
      forwardDays: 5,
      unexpected: 'preserve-for-schema-validation',
      startDate: '2025-08-07',
      endDate: '2026-08-07',
    })
  })

  it('[BIZ] 资讯计划只给出时间窗口一端时补齐另一端', () => {
    expect(
      normalizePlannedToolInput(
        'get_market_news',
        { keywords: ['贵州茅台'], publishedAfter: '2026-07-31T04:12:18Z' },
        new Date('2026-08-07T04:12:18.000Z'),
      ),
    ).toEqual({
      keywords: ['贵州茅台'],
      publishedAfter: '2026-07-31T04:12:18Z',
      publishedBefore: '2026-08-07T04:12:18.000Z',
    })
  })

  it('[BIZ] 资讯计划将无时区的上海本地时间确定性规范为 ISO 8601', () => {
    expect(
      normalizePlannedToolInput('get_market_news', {
        securityCodes: ['600036.SH'],
        publishedAfter: '2026-07-01T00:00:00',
        publishedBefore: '2026-08-08T23:59:59',
      }),
    ).toEqual({
      securityCodes: ['600036.SH'],
      publishedAfter: '2026-07-01T00:00:00+08:00',
      publishedBefore: '2026-08-08T23:59:59+08:00',
    })
  })

  it('[ERR] 资讯计划不猜测无法识别的时间', () => {
    expect(
      normalizePlannedToolInput('get_market_news', {
        publishedAfter: '下个月',
        publishedBefore: '2026-08-08T23:59:59',
      }),
    ).toEqual({
      publishedAfter: '下个月',
      publishedBefore: '2026-08-08T23:59:59+08:00',
    })
  })

  it('[BIZ] 市场级数据水位查询移除模型误加的证券作用域', () => {
    expect(
      normalizePlannedToolInput('get_data_availability', {
        datasets: ['INDEX_DAILY'],
        tsCode: '000300.SH',
      }),
    ).toEqual({ datasets: ['INDEX_DAILY'] })

    expect(
      normalizePlannedToolInput('get_data_availability', {
        datasets: ['STOCK_DAILY'],
        tsCode: '600036.SH',
      }),
    ).toEqual({ datasets: ['STOCK_DAILY'], tsCode: '600036.SH' })

    expect(
      normalizePlannedToolInput('get_data_availability', {
        datasets: ['STOCK_DAILY', 'INDEX_DAILY', 'STOCK_MONEYFLOW'],
        tsCode: '600519.SH',
      }),
    ).toEqual({ datasets: ['STOCK_DAILY', 'STOCK_MONEYFLOW'], tsCode: '600519.SH' })
  })

  it('[CITE] 事实摘要超长时保留首尾证据，且始终受长度预算限制', () => {
    const summary = summarizeFactData({ detail: `first-fact:${'x'.repeat(8_000)}:latest-fact` })

    expect(summary).toContain('first-fact')
    expect(summary).toContain('latest-fact')
    expect(summary.length).toBeLessThanOrEqual(8_000)
  })

  it('[CITE][ORACLE] 长时间序列裁剪后保留极值、日期和可重算收益', () => {
    const bars = Array.from({ length: 80 }, (_, index) => ({
      tradeDate: `2026-06-${String((index % 28) + 1).padStart(2, '0')}`,
      close: index === 40 ? 35.91 : index === 60 ? 40.55 : 37.94 + index * 0.01,
      amount: 1_000_000 + index,
      padding: 'x'.repeat(180),
    }))
    const summary = summarizeFactData({ bars })

    expect(summary).toContain('结构化数值摘要V2')
    expect(summary).toContain('35.91')
    expect(summary).toContain('40.55')
    expect(summary).toContain('2026-06-13')
    expect(summary).toContain('changePct')
    expect(summary).toContain('distanceFromMin')
    expect(summary).toContain('distanceFromMax')
    expect(summary).toContain('rangePositionPct')
    expect(summary.length).toBeLessThanOrEqual(8_000)
  })
})

function plan(calls: Array<{ id: string; toolKey: string; optional?: boolean }>): ReturnType<typeof planFixture> {
  return planFixture(calls)
}

function planFixture(calls: Array<{ id: string; toolKey: string; optional?: boolean }>): CompiledResearchPlan {
  return {
    intent: 'stock_research',
    summary: 'test plan',
    toolCalls: calls.map((call) => ({
      id: call.id,
      toolKey: call.toolKey,
      toolVersion: 1,
      input: {},
      dependsOn: [],
      optional: call.optional ?? false,
    })),
    toolPins: calls.map((call) => ({ key: call.toolKey, version: 1 })),
    executionLevels: calls.length ? [calls.map((call) => call.id)] : [],
  } as unknown as CompiledResearchPlan
}

function command(authorizedPlan: ReturnType<typeof planFixture>): Parameters<WorkflowToolService['execute']>[0] {
  return {
    run: {
      id: 'run_1',
      traceId: 'trace_1',
      deadlineAt: new Date(Date.now() + 60_000),
    },
    stepId: 'step_tools',
    authorized: {
      plan: authorizedPlan,
      snapshotSignature: 'snapshot',
      allowedTools: authorizedPlan.toolPins.map((pin) => pin.key),
    },
    context: {
      userId: 7,
      role: UserRole.USER,
      userStatus: UserStatus.ACTIVE,
      conversationId: 'conversation_1',
      allowedScopes: ['MARKET_DATA'],
    },
    usage: usage(),
    limits: {
      maxSteps: 8,
      maxToolCalls: 4,
      maxParallelTools: 2,
      maxCumulativeInputTokens: 10_000,
      inputTokenGuardrailSource: 'RUN_SNAPSHOT',
      maxCost: 10,
      costCurrency: 'CNY',
    },
  } as unknown as Parameters<WorkflowToolService['execute']>[0]
}

function usage() {
  return { steps: 1, toolCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0, costCurrency: 'CNY' }
}

function toolError(code: 'CANCELLED' | 'DATA_NOT_FOUND', message: string, retryable: boolean) {
  return new ToolExecutionError({
    ok: false,
    toolCallId: 'tool_call_1',
    toolKey: 'get_stock_overview',
    toolVersion: 1,
    code,
    message,
    retryable,
  })
}
