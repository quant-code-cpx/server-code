import { WorkflowCancelledError } from '../workflow.errors'
import { LoadContextNode } from '../nodes/load-context.node'

describe('LoadContextNode', () => {
  const baseUsage = { steps: 1, toolCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0, costCurrency: 'CNY' }
  const compactedUsage = { ...baseUsage, inputTokens: 2_100, outputTokens: 120 }
  let order: string[]
  let contexts: { build: jest.Mock }
  let summaries: { maybeCompact: jest.Mock }
  let node: LoadContextNode

  beforeEach(() => {
    order = []
    summaries = {
      maybeCompact: jest.fn(async () => {
        order.push('compact')
        return { status: 'CREATED', summaryId: 'summary_1', summaryVersion: 1, usage: compactedUsage }
      }),
    }
    contexts = {
      build: jest.fn(async () => {
        order.push('build')
        return { warnings: ['CONTEXT_WARNING'] }
      }),
    }
    node = new LoadContextNode(contexts as never, summaries as never)
  })

  it('先滚动摘要再构建 Context，并把摘要模型 usage 计入 workflow', async () => {
    const result = await node.execute(executionContext())

    expect(order).toEqual(['compact', 'build'])
    expect(summaries.maybeCompact).toHaveBeenCalledWith(
      expect.objectContaining({ stepId: 'step_load_context', usage: baseUsage }),
    )
    expect(result.budget).toEqual(compactedUsage)
    expect(result.warnings).toEqual(['CONTEXT_WARNING'])
  })

  it('摘要失败 warning 与 Context warning 去重合并，Run 继续', async () => {
    summaries.maybeCompact.mockResolvedValue({
      status: 'WARNING',
      warning: 'SUMMARY_GENERATION_FAILED',
      usage: baseUsage,
    })
    contexts.build.mockResolvedValue({ warnings: ['SUMMARY_GENERATION_FAILED', 'CONTEXT_WARNING'] })

    const result = await node.execute(executionContext())

    expect(contexts.build).toHaveBeenCalledTimes(1)
    expect(result.warnings).toEqual(['SUMMARY_GENERATION_FAILED', 'CONTEXT_WARNING'])
  })

  it('用户取消直接终止，不继续构建 Context', async () => {
    summaries.maybeCompact.mockRejectedValue(new WorkflowCancelledError('用户取消'))

    await expect(node.execute(executionContext())).rejects.toBeInstanceOf(WorkflowCancelledError)
    expect(contexts.build).not.toHaveBeenCalled()
  })
})

function executionContext() {
  return {
    run: { id: 'run_1' },
    workflow: { key: 'stock_research', version: 1 },
    state: {
      warnings: [],
      budget: { steps: 1, toolCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0, costCurrency: 'CNY' },
    },
    limits: {
      maxSteps: 8,
      maxToolCalls: 10,
      maxParallelTools: 3,
      maxInputTokens: 50_000,
      maxCost: 10,
      costCurrency: 'CNY',
    },
    stepId: 'step_load_context',
    workerId: 'worker_1',
    signal: new AbortController().signal,
  } as never
}
