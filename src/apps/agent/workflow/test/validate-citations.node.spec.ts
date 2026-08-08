import { CitationCoverageService } from '../citation-coverage.service'
import { ValidateCitationsNode, selectCitationRepairFacts } from '../nodes/validate-citations.node'
import { WorkflowCitationError, WorkflowValidationError } from '../workflow.errors'
import { WorkflowModelService } from '../workflow-model.service'
import type { FactPacket, FinalAnswerDraft } from '../workflow.types'

describe('ValidateCitationsNode', () => {
  const coverage = { validate: jest.fn() }
  const models = {
    resolveModelProfile: jest.fn(),
    resolveMaxOutputTokens: jest.fn(),
    generateStructured: jest.fn(),
  }
  const profile = {
    selectedProvider: 'fake',
    selectedModel: 'fake-v1',
    candidates: [],
  }

  let node: ValidateCitationsNode

  beforeEach(() => {
    jest.clearAllMocks()
    models.resolveModelProfile.mockReturnValue(profile)
    models.resolveMaxOutputTokens.mockReturnValue(512)
    node = new ValidateCitationsNode(
      coverage as unknown as CitationCoverageService,
      models as unknown as WorkflowModelService,
    )
  })

  it('[ERR] 缺少回答草稿时在调用模型前稳定拒绝', async () => {
    const input = executionContext()
    input.state.draft = null

    await expect(node.execute(input as never)).rejects.toBeInstanceOf(WorkflowValidationError)
    expect(coverage.validate).not.toHaveBeenCalled()
    expect(models.generateStructured).not.toHaveBeenCalled()
  })

  it('[BIZ] 初次引用已合法时原样返回，不发起 VERIFY', async () => {
    coverage.validate.mockReturnValue({ valid: true, coverage: 1, issues: [] })
    const input = executionContext()
    input.state.modelProfile = undefined

    await expect(node.execute(input as never)).resolves.toBe(input.state)

    expect(models.resolveModelProfile).toHaveBeenCalledWith(input.run)
    expect(models.generateStructured).not.toHaveBeenCalled()
  })

  it('[ERR] 已修复过一次仍不合法时停止重试', async () => {
    coverage.validate.mockReturnValue({ valid: false, coverage: 0, issues: ['Claim quote 缺少有效引用'] })
    const input = executionContext()
    input.state.citationRepairAttempts = 1

    await expect(node.execute(input as never)).rejects.toBeInstanceOf(WorkflowCitationError)
    expect(models.generateStructured).not.toHaveBeenCalled()
  })

  it('[CITE][BUDGET] VERIFY 只接收失败 Claim 所需事实并保留已合法事实', async () => {
    coverage.validate
      .mockReturnValueOnce({
        valid: false,
        coverage: 0.5,
        issues: ['Claim quote 包含无法由引用事实支持的数字或日期：1.99%'],
      })
      .mockReturnValueOnce({ valid: true, coverage: 1, issues: [] })
    models.generateStructured.mockResolvedValue({
      data: repairedDraft(),
      usage: { ...executionContext().state.budget, inputTokens: 20, outputTokens: 5 },
      modelCallId: 'model_verify',
      modelName: 'fake-v1',
      repaired: true,
    })
    const input = executionContext()

    const result = await node.execute(input as never)

    const command = models.generateStructured.mock.calls[0][0]
    const repairPayload = JSON.parse(command.messages[1].content)
    expect(repairPayload.allowedFacts).toEqual([{ factId: 'fact_quote', summary: '{"pctChg":-1.9986}' }])
    expect(repairPayload.instruction).toContain('Preserve already-valid claims')
    expect(result).toMatchObject({
      draft: repairedDraft(),
      finalModelCallId: 'model_verify',
      modelName: 'fake-v1',
      citationRepairAttempts: 1,
    })
  })

  it('[ERR] VERIFY 输出仍不合法时不得进入持久化', async () => {
    coverage.validate
      .mockReturnValueOnce({ valid: false, coverage: 0, issues: ['Claim quote 数字不受支持'] })
      .mockReturnValueOnce({ valid: false, coverage: 0, issues: ['Claim quote 仍不受支持'] })
    models.generateStructured.mockResolvedValue({
      data: repairedDraft(),
      usage: executionContext().state.budget,
      modelCallId: 'model_verify',
      modelName: 'fake-v1',
      repaired: true,
    })

    await expect(node.execute(executionContext() as never)).rejects.toBeInstanceOf(WorkflowCitationError)
  })
})

describe('selectCitationRepairFacts', () => {
  it('[EDGE] 只有正文级问题、无法定位 Claim 时返回全部可引用事实', () => {
    const facts = [fact('fact_quote'), fact('fact_technical'), fact('fact_search', 'search_web')]

    expect(
      selectCitationRepairFacts(draft(), facts, ['回答正文包含不受支持的数字：1.99%']).map((item) => item.factId),
    ).toEqual(['fact_quote', 'fact_technical'])
  })

  it('[EDGE] 失败 Claim 引用了未知 factId 时回退全部可引用事实', () => {
    const invalid = draft()
    invalid.claims[0].factIds = ['fact_missing']

    expect(
      selectCitationRepairFacts(invalid, [fact('fact_quote'), fact('fact_technical')], ['Claim quote 引用不存在']).map(
        (item) => item.factId,
      ),
    ).toEqual(['fact_quote', 'fact_technical'])
  })
})

function executionContext() {
  return {
    run: {
      id: 'run_1',
      promptVersion: { template: 'system policy' },
    },
    workflow: { outputSchema: { type: 'object' } },
    state: {
      draft: draft() as FinalAnswerDraft | null,
      modelProfile: profileFixture() as ReturnType<typeof profileFixture> | undefined,
      facts: [fact('fact_quote'), fact('fact_technical')],
      citationRepairAttempts: 0,
      budget: {
        steps: 5,
        toolCalls: 2,
        inputTokens: 10,
        outputTokens: 2,
        cost: 0,
        costCurrency: 'CNY',
      },
    },
    limits: {
      maxSteps: 8,
      maxToolCalls: 4,
      maxParallelTools: 2,
      maxCumulativeInputTokens: 10_000,
      inputTokenGuardrailSource: 'RUN_SNAPSHOT',
      maxCost: 10,
      costCurrency: 'CNY',
    },
    stepId: 'step_verify',
    workerId: 'worker_1',
    signal: undefined,
  }
}

function draft(): FinalAnswerDraft {
  return {
    markdown: '今日下跌1.99%，RSI6为72.6点。',
    claims: [
      { claimKey: 'quote', text: '今日下跌1.99%', factIds: ['fact_quote'] },
      { claimKey: 'technical', text: 'RSI6为72.6点', factIds: ['fact_technical'] },
    ],
    warnings: [],
    dataCutoff: '2026-08-06',
  }
}

function repairedDraft(): FinalAnswerDraft {
  return {
    ...draft(),
    markdown: '今日下跌2.00%，RSI6为72.6点。',
    claims: [
      { claimKey: 'quote', text: '今日下跌2.00%', factIds: ['fact_quote'] },
      { claimKey: 'technical', text: 'RSI6为72.6点', factIds: ['fact_technical'] },
    ],
  }
}

function fact(factId: string, toolKey: FactPacket['toolKey'] = 'get_stock_overview'): FactPacket {
  return {
    factId,
    toolCallId: `tool_${factId}`,
    toolKey,
    title: factId,
    sourceType: toolKey === 'search_web' ? 'MEDIA' : 'DATABASE',
    sourceIds: toolKey === 'search_web' ? ['source_1'] : [],
    summary: factId === 'fact_quote' ? '{"pctChg":-1.9986}' : '{"rsi6":72.6}',
    retrievedAt: '2026-08-06T15:00:00.000Z',
    asOf: { tradeDate: '2026-08-06', retrievedAt: '2026-08-06T15:00:00.000Z' },
    timezone: 'Asia/Shanghai',
    warnings: [],
  }
}

function profileFixture() {
  return {
    selectedProvider: 'fake',
    selectedModel: 'fake-v1',
    candidates: [],
  }
}
