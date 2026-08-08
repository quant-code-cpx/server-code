import { buildAgentExecutionConfig } from 'src/config/agent-execution.config'
import { estimateModelRequestTokens, estimateTextTokens } from '../../model-gateway/model-token-estimator'
import { WorkflowBudgetService } from '../workflow-budget.service'
import type { FrozenWorkflowDefinition, WorkflowBudgetLimits, WorkflowBudgetUsage } from '../workflow.types'

describe('Agent Run 可靠性预算回归', () => {
  it('累计输入护栏默认关闭；新旧变量来源显式且禁止双重配置', () => {
    expect(buildAgentExecutionConfig({})).toMatchObject({
      maxCumulativeInputTokens: null,
      inputTokenGuardrailSource: 'DISABLED_BY_DEFAULT',
    })
    expect(buildAgentExecutionConfig({ AGENT_RUN_MAX_CUMULATIVE_INPUT_TOKENS: '128000' })).toMatchObject({
      maxCumulativeInputTokens: 128_000,
      inputTokenGuardrailSource: 'ENV',
    })
    expect(buildAgentExecutionConfig({ AGENT_MAX_INPUT_TOKENS: '32768' })).toMatchObject({
      maxCumulativeInputTokens: 32_768,
      inputTokenGuardrailSource: 'LEGACY_ENV',
    })
    expect(() =>
      buildAgentExecutionConfig({
        AGENT_RUN_MAX_CUMULATIVE_INPUT_TOKENS: '128000',
        AGENT_MAX_INPUT_TOKENS: '32768',
      }),
    ).toThrow('不能同时配置')
  })

  it('Run 创建快照是权威来源，不受进程后续配置变化覆盖', () => {
    const service = new WorkflowBudgetService(
      buildAgentExecutionConfig({ AGENT_RUN_MAX_CUMULATIVE_INPUT_TOKENS: '32000' }),
    )

    const limits = service.resolveLimits(workflow(), {
      runPolicy: {
        schemaVersion: 1,
        maxSteps: 20,
        maxToolCalls: 30,
        maxParallelTools: 4,
        maxCumulativeInputTokens: 128_000,
        maxCost: 20,
        costCurrency: 'CNY',
      },
    })

    expect(limits).toMatchObject({
      maxCumulativeInputTokens: 128_000,
      inputTokenGuardrailSource: 'RUN_SNAPSHOT',
      maxCost: 20,
    })
  })

  it('成功调用的真实 usage 即使越过累计护栏也只记账；下一次调用在请求前停止', () => {
    const service = new WorkflowBudgetService(buildAgentExecutionConfig({}))
    const limits: WorkflowBudgetLimits = {
      maxSteps: 8,
      maxToolCalls: 10,
      maxParallelTools: 3,
      maxCumulativeInputTokens: 1_000,
      inputTokenGuardrailSource: 'RUN_SNAPSHOT',
      maxCost: 10,
      costCurrency: 'CNY',
    }
    const actual: WorkflowBudgetUsage = {
      steps: 1,
      toolCalls: 0,
      inputTokens: 1_050,
      outputTokens: 20,
      cost: 0,
      costCurrency: 'CNY',
    }

    expect(() => service.assertUsage(actual, limits)).not.toThrow()
    expect(() => service.assertCanCallModel(actual, 1, limits)).toThrow(expect.objectContaining({ agentCode: 6018 }))
  })

  it('本地回退按中文、JSON、工具与 Schema 计数，并明确标记非精确与安全余量', () => {
    const content = '比较贵州茅台与五粮液的收入、毛利率和现金流。'
    const request = {
      modelPolicy: 'AUTO' as const,
      purpose: 'SYNTHESIZE' as const,
      messages: [{ role: 'user' as const, content }],
      tools: [
        {
          name: 'finance_lookup',
          description: '查询财务 JSON 数据',
          parameters: {
            type: 'object',
            properties: { tsCodes: { type: 'array', items: { type: 'string' } } },
            required: ['tsCodes'],
          },
        },
      ],
      responseSchema: {
        type: 'object',
        properties: { conclusion: { type: 'string' }, citations: { type: 'array', items: { type: 'string' } } },
        required: ['conclusion', 'citations'],
      },
      maxOutputTokens: 2_048,
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      trace: { runId: 'run-1', modelCallId: 'call-1', traceId: 'trace-1' },
    }

    const estimate = estimateModelRequestTokens(request)

    expect(estimateTextTokens(content)).toBeGreaterThan(Math.ceil(content.length / 4))
    expect(estimate.rawInputTokens).toBeGreaterThan(estimateTextTokens(content))
    expect(estimate.inputTokens).toBe(estimate.rawInputTokens + estimate.safetyMarginTokens)
    expect(estimate).toMatchObject({ source: 'LOCAL_CONSERVATIVE_V1', exact: false })
    expect(estimate.safetyMarginTokens).toBeGreaterThanOrEqual(32)
  })
})

function workflow(): FrozenWorkflowDefinition {
  return {
    id: 'workflow-1',
    key: 'stock_research',
    version: 1,
    name: '股票研究',
    description: 'test',
    schemaVersion: 1,
    startNodeKey: 'load_context',
    maxSteps: 64,
    maxParallelTools: 8,
    nodes: [],
    edges: [],
    promptVersions: {},
    frozenAt: new Date().toISOString(),
  } as unknown as FrozenWorkflowDefinition
}
