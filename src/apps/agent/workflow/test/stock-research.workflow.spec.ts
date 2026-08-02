/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AiAgentRunStatus,
  AiAgentStepStatus,
  AiMessageRole,
  AiModelPolicy,
  AiVersionStatus,
  UserRole,
  UserStatus,
} from '@prisma/client'
import { buildAgentExecutionConfig } from 'src/config/agent-execution.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { AgentRunCompletionRepository } from '../../execution/agent-run-completion.repository'
import { AgentRunRepository, type AgentExecutionRun } from '../../execution/agent-run.repository'
import { AgentOrchestratorService } from '../../orchestrator/agent-orchestrator.service'
import { ToolExecutionError } from '../../tools/contracts/tool-error'
import { WorkflowToolService } from '../workflow-tool.service'
import { CitationCoverageService } from '../citation-coverage.service'
import { AuthorizeToolsNode } from '../nodes/authorize-tools.node'
import { CompleteNode } from '../nodes/complete.node'
import { ExecuteToolsNode } from '../nodes/execute-tools.node'
import { LoadContextNode } from '../nodes/load-context.node'
import { PersistNode } from '../nodes/persist.node'
import { PlanNode } from '../nodes/plan.node'
import { SynthesizeNode } from '../nodes/synthesize.node'
import { ValidateCitationsNode } from '../nodes/validate-citations.node'
import { ResearchPlanCompilerService } from '../research-plan-compiler.service'
import { WorkflowBudgetService } from '../workflow-budget.service'
import { WorkflowContextService } from '../workflow-context.service'
import { WorkflowEngineService } from '../workflow-engine.service'
import {
  WorkflowBudgetError,
  WorkflowCancelledError,
  WorkflowCitationError,
  WorkflowVersionError,
} from '../workflow.errors'
import { WorkflowFinalizationService } from '../workflow-finalization.service'
import { WorkflowRegistryService } from '../workflow-registry.service'
import type {
  FactPacket,
  FinalAnswerDraft,
  FrozenWorkflowDefinition,
  LoadedWorkflowContext,
  ResearchPlan,
  WorkflowCheckpoint,
} from '../workflow.types'
import { STOCK_RESEARCH_WORKFLOW_V1 } from '../workflows/stock-research.v1'
import { STOCK_RESEARCH_WORKFLOW_DEFINITIONS, STOCK_RESEARCH_WORKFLOW_V2 } from '../workflows/stock-research.v2'

const config = buildAgentExecutionConfig({})
const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService

describe('Stock research workflow v1', () => {
  it('冻结固定节点、Workflow hash 与 Prompt hash', () => {
    const registry = createRegistry()
    const definition = registry.resolve('stock_research', 1)

    expect(definition.nodes.map((node) => node.key)).toEqual([
      'load_context',
      'plan',
      'authorize_tools',
      'execute_tools',
      'synthesize',
      'validate_citations',
      'persist',
      'complete',
    ])
    expect(definition.contentHash).toBe('d3c8f8f62d420105790f0a5ea30745da5475880686a514703a58c1ea0bbc5676')
    expect(definition.promptContentHash).toBe('b66049e69d902b3e81da94ac5b8d2e6964715c50ec9767df2745c622118418ed')
    expect(() => registry.register(STOCK_RESEARCH_WORKFLOW_V1)).toThrow('Workflow Registry 已冻结')
  })

  it('V1 保持只读 Tool hash；V2 独立纳入受控写 Tool', () => {
    const registry = new WorkflowRegistryService(STOCK_RESEARCH_WORKFLOW_DEFINITIONS)
    registry.onModuleInit()

    const v1 = registry.resolve('stock_research', 1)
    const v2 = registry.resolve('stock_research', 2)

    expect(v1.toolAllowlist).not.toContain('save_research_report')
    expect(v1.contentHash).toBe('d3c8f8f62d420105790f0a5ea30745da5475880686a514703a58c1ea0bbc5676')
    expect(v2.toolAllowlist).toContain('save_research_report')
    expect(v2.contentHash).toBe('40bb600a69c34204d72dab4fb7cc2e444c12f66bbdad45f4d790ea85ca4319b8')
    expect(v2.promptContentHash).toBe(v1.promptContentHash)
    expect(() => registry.register(STOCK_RESEARCH_WORKFLOW_V2)).toThrow('Workflow Registry 已冻结')
  })

  it('只接受白名单、已授权 capability、无环且不超预算的 Tool 计划', () => {
    const compiler = new ResearchPlanCompilerService()
    const workflow = createRegistry().resolve('stock_research', 1)
    const valid = plan([
      toolCall('resolve', 'resolve_security'),
      toolCall('overview', 'get_stock_overview', ['resolve']),
    ])

    expect(compiler.compile(valid, workflow, ['INTERNAL_DATA'], 2).executionLevels).toEqual([['resolve'], ['overview']])
    expect(() => compiler.compile(plan([toolCall('search', 'search_web')]), workflow, ['INTERNAL_DATA'], 2)).toThrow(
      'capability 未授权',
    )
    expect(() =>
      compiler.compile(
        plan([toolCall('a', 'resolve_security', ['b']), toolCall('b', 'get_stock_overview', ['a'])]),
        workflow,
        ['INTERNAL_DATA'],
        2,
      ),
    ).toThrow('存在环')
    expect(() => compiler.compile(valid, workflow, ['INTERNAL_DATA'], 1)).toThrow(WorkflowBudgetError)
    expect(() => compiler.compile(valid, workflow, ['INTERNAL_DATA'], 1)).toThrow('超过预算')
    expect(() =>
      compiler.compile(
        plan([{ ...toolCall('bad', 'resolve_security'), toolKey: 'query_database' } as never]),
        workflow,
        ['INTERNAL_DATA'],
        1,
      ),
    ).toThrow('未知 Tool')

    const chained = plan([
      { ...toolCall('search', 'search_web'), input: { query: '贵州茅台 公告', resultLimit: 1 } },
      {
        ...toolCall('fetch', 'fetch_web_page', ['search']),
        input: {
          urlToken: { $toolResult: { callId: 'search', path: ['results', 0, 'urlToken'] } },
        },
      },
    ])
    expect(compiler.compile(chained, workflow, ['WEB_SEARCH'], 2).executionLevels).toEqual([['search'], ['fetch']])
    expect(() =>
      compiler.compile(
        plan([
          { ...toolCall('search', 'search_web'), input: { query: '贵州茅台 公告', resultLimit: 1 } },
          {
            ...toolCall('fetch', 'fetch_web_page'),
            input: {
              urlToken: { $toolResult: { callId: 'search', path: ['results', 0, 'urlToken'] } },
            },
          },
        ]),
        workflow,
        ['WEB_SEARCH'],
        2,
      ),
    ).toThrow('必须是当前调用的直接依赖')
    expect(() =>
      compiler.compile(
        plan([
          { ...toolCall('search', 'search_web'), input: { query: '贵州茅台 公告', resultLimit: 1 } },
          {
            ...toolCall('fetch', 'fetch_web_page', ['search']),
            input: {
              urlToken: { $toolResult: { callId: 'search', path: ['results', 0, '__proto__'] } },
            },
          },
        ]),
        workflow,
        ['WEB_SEARCH'],
        2,
      ),
    ).toThrow('path 非法')
    expect(() =>
      compiler.compile(
        plan([
          { ...toolCall('search', 'search_web'), input: { query: '贵州茅台 公告', resultLimit: 1 } },
          {
            ...toolCall('fetch', 'fetch_web_page', ['search']),
            input: {
              urlToken: {
                $toolResult: { callId: 'search', path: Array.from({ length: 17 }, () => 'results') },
              },
            },
          },
        ]),
        workflow,
        ['WEB_SEARCH'],
        2,
      ),
    ).toThrow('path 非法')
  })

  it('预算上限无法通过 Run 自定义值放大，并在 0..N 边界稳定拒绝超额 Tool', () => {
    const budgets = new WorkflowBudgetService(config)
    const workflow = createRegistry().resolve('stock_research', 1)
    const limits = budgets.resolveLimits(workflow, {
      maxSteps: 999,
      maxToolCalls: 999,
      maxParallelTools: 999,
      maxInputTokens: 999_999,
      maxCost: 999,
    })
    expect(limits).toMatchObject({ maxSteps: 8, maxToolCalls: 20, maxParallelTools: 3, maxInputTokens: 32_768 })
    const usage = budgets.initialUsage(limits)
    for (let count = 0; count <= limits.maxToolCalls; count += 1) {
      expect(() => budgets.assertCanPlanToolCalls(usage, count, limits)).not.toThrow()
    }
    expect(() => budgets.assertCanPlanToolCalls(usage, limits.maxToolCalls + 1, limits)).toThrow('超过预算')
  })

  it('fake Model + fake Tool 完成 8 节点全链，最终消息、引用、usage 一次提交', async () => {
    const harness = createHarness({
      plan: plan([toolCall('overview', 'get_stock_overview')]),
      synthesize: answer('fact_overview'),
      facts: [fact('fact_overview')],
    })

    const result = await harness.engine.execute({
      run: harness.run,
      workflow: harness.workflow,
      workerId: 'worker_1',
    })

    expect(result).toEqual({
      status: 'COMPLETED',
      runId: harness.run.id,
      finalMessageId: harness.run.responseMessageId,
    })
    expect(harness.steps.size).toBe(8)
    expect(harness.toolExecutions).toBe(1)
    expect(harness.completionCommand.contentText).toContain('基于已验证事实')
    expect(harness.completionCommand.citations).toHaveLength(1)
    expect(harness.completionCommand.citations[0]).toMatchObject({
      claimKey: 'overview_claim',
      toolCallId: 'tool_call_overview',
    })
    expect(harness.completionCommand.completedEventPayload.usage).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    })
  })

  it('普通问答可零 Tool 完成；多只读 Tool 同层并行且可选失败降级为 warning', async () => {
    const ordinary = createHarness({
      plan: plan([]),
      synthesize: {
        markdown: '这是不依赖外部事实的能力说明。',
        claims: [],
        warnings: [],
        dataCutoff: null,
      },
      facts: [],
    })
    await expect(
      ordinary.engine.execute({ run: ordinary.run, workflow: ordinary.workflow, workerId: 'worker_1' }),
    ).resolves.toMatchObject({ status: 'COMPLETED' })
    expect(ordinary.toolExecutions).toBe(0)
    expect(ordinary.completionCommand.citations).toEqual([])

    const budgets = new WorkflowBudgetService(config)
    const workflow = createRegistry().resolve('stock_research', 1)
    const compiled = new ResearchPlanCompilerService().compile(
      plan([toolCall('overview', 'get_stock_overview'), { ...toolCall('news', 'search_web'), optional: true }]),
      workflow,
      ['INTERNAL_DATA', 'WEB_SEARCH'],
      2,
    )
    let active = 0
    let maxActive = 0
    const executor = {
      execute: jest.fn(async (command: any) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setImmediate(resolve))
        active -= 1
        if (command.toolKey === 'search_web') {
          throw new ToolExecutionError({
            ok: false,
            toolCallId: 'tool_call_news',
            toolKey: 'search_web',
            toolVersion: 1,
            code: 'UPSTREAM_FAILED',
            message: '搜索暂不可用',
            retryable: true,
          })
        }
        return {
          ok: true,
          toolCallId: 'tool_call_overview',
          toolKey: 'get_stock_overview',
          toolVersion: 1,
          data: { name: '贵州茅台' },
          provenance: {
            sourceType: 'DATABASE',
            sourceServices: ['stock'],
            sourceModels: ['daily'],
            asOf: { tradeDate: '2026-07-17', retrievedAt: '2026-07-20T00:00:00.000Z' },
            timezone: 'Asia/Shanghai',
          },
          citationSourceIds: [],
          warnings: [],
          truncated: false,
        }
      }),
    }
    const registry = {
      freezeSnapshot: jest.fn((pins: any) => ({ entries: pins, signature: 'multi_snapshot' })),
      get: jest.fn((key: string, version: number) => ({
        key,
        version,
        policy: { sideEffect: 'READ', idempotent: true },
      })),
    }
    const toolService = new WorkflowToolService(registry as never, executor as never, budgets)
    const authorized = toolService.authorize(compiled)
    const run = makeRun(workflow)
    const result = await toolService.execute({
      run,
      stepId: 'step_execute_tools',
      authorized,
      context: { ...loadedContext(), allowedCapabilities: ['INTERNAL_DATA', 'WEB_SEARCH'] },
      usage: budgets.initialUsage(budgets.resolveLimits(workflow, {})),
      limits: budgets.resolveLimits(workflow, { maxParallelTools: 2, maxToolCalls: 2 }),
    })
    expect(maxActive).toBe(2)
    expect(result.facts).toHaveLength(1)
    expect(result.warnings).toEqual(['可选 Tool search_web 失败：搜索暂不可用'])
    expect(result.usage.toolCalls).toBe(2)
  })

  it('同会话追问加载最近 10 条有界历史，不改写上一轮消息', async () => {
    const previousAnswer = `上一轮结论：${'证'.repeat(4_100)}`
    const items = [
      { role: AiMessageRole.USER, contentText: '上一轮问题：比较盈利质量' },
      { role: AiMessageRole.ASSISTANT, contentText: previousAnswer },
      { role: AiMessageRole.USER, contentText: '本轮追问：继续比较现金流' },
    ]
    const messages = {
      listMessages: jest.fn().mockResolvedValue({ items, nextCursor: null }),
    }
    const contextService = new WorkflowContextService(messages as never)
    const run = makeRun(createRegistry().resolve('stock_research', 1))
    run.triggerMessage.contentText = '本轮追问：继续比较现金流'

    const context = await contextService.load(run)

    expect(messages.listMessages).toHaveBeenCalledWith(run.userId, run.conversationId, { limit: 10 })
    expect(context.userText).toBe('本轮追问：继续比较现金流')
    expect(context.recentMessages).toEqual([
      { role: AiMessageRole.USER, content: '上一轮问题：比较盈利质量' },
      { role: AiMessageRole.ASSISTANT, content: previousAnswer.slice(0, 4_000) },
      { role: AiMessageRole.USER, content: '本轮追问：继续比较现金流' },
    ])
    expect(items[1].contentText).toBe(previousAnswer)
  })

  it('依赖 Tool 成功后解析受控结果绑定；依赖失败时跳过可选下游并汇总安全 warning', async () => {
    const budgets = new WorkflowBudgetService(config)
    const workflow = createRegistry().resolve('stock_research', 1)
    const chainedPlan = plan([
      {
        ...toolCall('search', 'search_web'),
        input: { query: '贵州茅台 公告', resultLimit: 1 },
      },
      {
        ...toolCall('fetch', 'fetch_web_page', ['search']),
        input: {
          urlToken: { $toolResult: { callId: 'search', path: ['results', 0, 'urlToken'] } },
          maxCharacters: 3_000,
        },
      },
    ])
    const compiled = new ResearchPlanCompilerService().compile(chainedPlan, workflow, ['WEB_SEARCH'], 2)
    const executor = {
      execute: jest.fn(async (command: any) => {
        if (command.toolKey === 'search_web') {
          return {
            ok: true,
            toolCallId: 'tool_call_search',
            toolKey: 'search_web',
            toolVersion: 1,
            data: { results: [{ urlToken: 'run-bound-url-token-1234567890' }] },
            provenance: {
              sourceType: 'MEDIA',
              sourceServices: ['search'],
              sourceModels: ['AiSearchSource'],
              asOf: { retrievedAt: '2026-07-20T00:00:00.000Z' },
              timezone: 'UTC',
            },
            citationSourceIds: [],
            warnings: [{ code: 'SEARCH_SNIPPET_NOT_CITABLE', message: '搜索摘要不可引用' }],
            truncated: false,
          }
        }
        expect(command.input).toEqual({ urlToken: 'run-bound-url-token-1234567890', maxCharacters: 3_000 })
        return {
          ok: true,
          toolCallId: 'tool_call_fetch',
          toolKey: 'fetch_web_page',
          toolVersion: 1,
          data: { text: '每股现金分红 30 元' },
          provenance: {
            sourceType: 'OFFICIAL',
            sourceServices: ['fetch'],
            sourceModels: ['AiSearchSource'],
            asOf: { retrievedAt: '2026-07-20T00:00:01.000Z' },
            timezone: 'UTC',
          },
          citationSourceIds: ['source_fetch'],
          warnings: [{ code: 'PROMPT_INJECTION_SUSPECTED', message: '网页包含疑似 Prompt Injection' }],
          truncated: false,
        }
      }),
    }
    const registry = {
      freezeSnapshot: jest.fn((pins: any) => ({ entries: pins, signature: 'web_snapshot' })),
      get: jest.fn((key: string, version: number) => ({
        key,
        version,
        policy: { sideEffect: 'READ', idempotent: true },
      })),
    }
    const toolService = new WorkflowToolService(registry as never, executor as never, budgets)
    const result = await toolService.execute({
      run: makeRun(workflow),
      stepId: 'step_execute_tools',
      authorized: toolService.authorize(compiled),
      context: { ...loadedContext(), allowedCapabilities: ['WEB_SEARCH'] },
      usage: budgets.initialUsage(budgets.resolveLimits(workflow, {})),
      limits: budgets.resolveLimits(workflow, { maxToolCalls: 2 }),
    })
    expect(executor.execute).toHaveBeenCalledTimes(2)
    expect(result.facts.map((item) => item.factId)).toEqual(['fact_search', 'fact_fetch'])
    expect(result.warnings).toEqual(['搜索摘要不可引用', '网页包含疑似 Prompt Injection'])

    const optionalPlan = new ResearchPlanCompilerService().compile(
      plan([
        { ...chainedPlan.toolCalls[0], optional: true },
        { ...chainedPlan.toolCalls[1], optional: true },
      ]),
      workflow,
      ['WEB_SEARCH'],
      2,
    )
    const failedExecutor = {
      execute: jest.fn(async () => {
        throw new ToolExecutionError({
          ok: false,
          toolCallId: 'tool_call_search',
          toolKey: 'search_web',
          toolVersion: 1,
          code: 'TIMEOUT',
          message: '联网研究超时',
          retryable: true,
        })
      }),
    }
    const degraded = await new WorkflowToolService(registry as never, failedExecutor as never, budgets).execute({
      run: makeRun(workflow),
      stepId: 'step_execute_tools',
      authorized: toolService.authorize(optionalPlan),
      context: { ...loadedContext(), allowedCapabilities: ['WEB_SEARCH'] },
      usage: budgets.initialUsage(budgets.resolveLimits(workflow, {})),
      limits: budgets.resolveLimits(workflow, { maxToolCalls: 2 }),
    })
    expect(failedExecutor.execute).toHaveBeenCalledTimes(1)
    expect(degraded.facts).toEqual([])
    expect(degraded.warnings).toEqual([
      '可选 Tool search_web 失败：联网研究超时',
      '可选 Tool fetch_web_page 已跳过：依赖 Tool search 无可用结果',
    ])
    expect(degraded.usage.toolCalls).toBe(1)
  })

  it('引用缺失时只 repair 一次；repair 后仍引用未知 fact 则 typed failure', async () => {
    const coverage = new CitationCoverageService()
    const searchFact = { ...fact('fact_search'), toolKey: 'search_web' as const }
    expect(coverage.validate(answer('fact_search'), [searchFact])).toMatchObject({
      valid: false,
      coverage: 0,
      issues: expect.arrayContaining([expect.stringContaining('搜索摘要事实不可引用')]),
    })
    expect(
      coverage.validate({ markdown: '联网核验未完成。', claims: [], warnings: [], dataCutoff: null }, [searchFact]),
    ).toMatchObject({ valid: true, coverage: 1 })

    const repaired = createHarness({
      plan: plan([toolCall('overview', 'get_stock_overview')]),
      synthesize: answer('unknown_fact'),
      verify: answer('fact_overview'),
      facts: [fact('fact_overview')],
    })
    await expect(
      repaired.engine.execute({ run: repaired.run, workflow: repaired.workflow, workerId: 'worker_1' }),
    ).resolves.toMatchObject({ status: 'COMPLETED' })
    expect(repaired.modelPurposes).toEqual(['PLAN', 'SYNTHESIZE', 'VERIFY'])

    const invalid = createHarness({
      plan: plan([toolCall('overview', 'get_stock_overview')]),
      synthesize: answer('unknown_fact'),
      verify: answer('still_unknown'),
      facts: [fact('fact_overview')],
    })
    await expect(
      invalid.engine.execute({ run: invalid.run, workflow: invalid.workflow, workerId: 'worker_1' }),
    ).rejects.toBeInstanceOf(WorkflowCitationError)
    expect(invalid.modelPurposes.filter((purpose) => purpose === 'VERIFY')).toHaveLength(1)
    expect(invalid.steps.get('validate_citations')?.status).toBe(AiAgentStepStatus.FAILED)
  })

  it('从 checkpoint 恢复时不重复 load/plan/authorize/Tool 副作用', async () => {
    const workflow = createRegistry().resolve('stock_research', 1)
    const context = loadedContext()
    const compiled = new ResearchPlanCompilerService().compile(
      plan([toolCall('overview', 'get_stock_overview')]),
      workflow,
      ['INTERNAL_DATA'],
      20,
    )
    const run = makeRun(workflow)
    run.checkpoint = {
      schemaVersion: 1,
      workflowKey: workflow.key,
      workflowVersion: workflow.version,
      workflowHash: workflow.contentHash,
      nextNodeIndex: 4,
      state: {
        context,
        plan: plan([toolCall('overview', 'get_stock_overview')]),
        compiledPlan: compiled,
        toolSnapshotSignature: 'snapshot_v1',
        facts: [fact('fact_overview')],
        draft: null,
        finalModelCallId: null,
        modelName: 'fake-model',
        finalization: null,
        warnings: [],
        citationRepairAttempts: 0,
        budget: {
          steps: 4,
          toolCalls: 1,
          inputTokens: 10,
          outputTokens: 5,
          cost: 0,
          costCurrency: 'CNY',
        },
      },
    } satisfies WorkflowCheckpoint as never
    run.checkpointVersion = 4
    const harness = createHarness({
      run,
      plan: plan([]),
      synthesize: answer('fact_overview'),
      facts: [fact('fact_overview')],
    })

    await harness.engine.execute({ run: harness.run, workflow, workerId: 'worker_1' })

    expect(harness.modelPurposes).toEqual(['SYNTHESIZE'])
    expect(harness.toolExecutions).toBe(0)
    expect([...harness.steps.keys()]).toEqual(['synthesize', 'validate_citations', 'persist', 'complete'])
  })

  it('Orchestrator 将版本缺失映射为 FAILED，将 CANCEL_REQUESTED 映射为 CANCELLED', async () => {
    const workflow = createRegistry().resolve('stock_research', 1)
    const versionRun = makeRun(workflow)
    const transitions: any[] = []
    const versionRuns = {
      claimRun: jest.fn(async () => versionRun),
      findForExecution: jest.fn(async () => versionRun),
      findById: jest.fn(async () => versionRun),
      transition: jest.fn(async (_runId: string, command: any) => {
        transitions.push(command)
        return versionRun
      }),
    }
    const versionOrchestrator = new AgentOrchestratorService(
      versionRuns as never,
      {
        resolvePublished: () => {
          throw new WorkflowVersionError('版本不存在')
        },
      } as never,
      { execute: jest.fn() } as never,
      logger,
    )
    await expect(versionOrchestrator.resume(versionRun.id, { workerId: 'worker_1' })).resolves.toEqual({
      status: 'FAILED',
      runId: versionRun.id,
    })
    expect(transitions[0]).toMatchObject({ targetStatus: AiAgentRunStatus.FAILED, errorCode: 6024 })

    const cancelRun = makeRun(workflow)
    cancelRun.status = AiAgentRunStatus.CANCEL_REQUESTED
    cancelRun.cancelReason = '用户停止'
    const cancelTransitions: any[] = []
    const cancelOrchestrator = new AgentOrchestratorService(
      {
        claimRun: jest.fn(async () => cancelRun),
        findForExecution: jest.fn(async () => cancelRun),
        findById: jest.fn(async () => cancelRun),
        transition: jest.fn(async (_runId: string, command: any) => {
          cancelTransitions.push(command)
          return cancelRun
        }),
      } as never,
      { resolvePublished: jest.fn(() => workflow) } as never,
      {
        execute: jest.fn(async () => {
          throw new WorkflowCancelledError()
        }),
      } as never,
      logger,
    )
    await expect(cancelOrchestrator.resume(cancelRun.id, { workerId: 'worker_1' })).resolves.toEqual({
      status: 'CANCELLED',
      runId: cancelRun.id,
    })
    expect(cancelTransitions[0]).toMatchObject({
      targetStatus: AiAgentRunStatus.CANCELLED,
      event: { eventType: 'agent.cancelled', payload: { cancelledBy: 'USER', reason: '用户停止' } },
    })
  })
})

function createRegistry(): WorkflowRegistryService {
  const registry = new WorkflowRegistryService([STOCK_RESEARCH_WORKFLOW_V1])
  registry.onModuleInit()
  return registry
}

function createHarness(options: {
  run?: AgentExecutionRun
  plan: ResearchPlan
  synthesize: FinalAnswerDraft
  verify?: FinalAnswerDraft
  facts: FactPacket[]
}) {
  const workflow = createRegistry().resolve('stock_research', 1)
  const run = options.run ?? makeRun(workflow)
  const steps = new Map<string, any>()
  const modelPurposes: string[] = []
  let completionCommand: any = null
  let toolExecutions = 0

  const runRepository = {
    findById: jest.fn(async () => run),
    heartbeat: jest.fn(async () => {
      run.leaseExpiresAt = new Date(Date.now() + 30_000)
      return run
    }),
    createStep: jest.fn(async (_runId: string, _workerId: string, command: any) => {
      const existing = steps.get(command.stepKey)
      if (existing) return existing
      const step = {
        id: `step_${command.stepKey}`,
        runId: run.id,
        stepKey: command.stepKey,
        kind: command.kind,
        ordinal: command.ordinal,
        attempt: 1,
        status: AiAgentStepStatus.PENDING,
        outputSummary: null,
      }
      steps.set(command.stepKey, step)
      return step
    }),
    transitionStep: jest.fn(async (_runId: string, stepId: string, command: any) => {
      const step = [...steps.values()].find((item) => item.id === stepId)
      step.status = command.targetStatus
      if (command.output) step.outputSummary = command.output
      return step
    }),
    saveCheckpoint: jest.fn(async (_runId: string, command: any) => {
      run.checkpoint = command.checkpoint
      run.checkpointVersion += 1
      return run
    }),
  } as unknown as AgentRunRepository

  const completion = {
    complete: jest.fn(async (_runId: string, command: any) => {
      completionCommand = command
      run.status = AiAgentRunStatus.COMPLETED
      run.statusVersion += 1
      return run
    }),
  } as unknown as AgentRunCompletionRepository

  const budgets = new WorkflowBudgetService(config)
  const model = {
    resolveInputTokenBudget: jest.fn(
      (_run: unknown, usage: any, limits: any) => limits.maxInputTokens - usage.inputTokens,
    ),
    generateStructured: jest.fn(async (command: any) => {
      modelPurposes.push(command.purpose)
      const data =
        command.purpose === 'PLAN'
          ? options.plan
          : command.purpose === 'VERIFY'
            ? (options.verify ?? options.synthesize)
            : options.synthesize
      return {
        data,
        modelCallId: `model_call_${command.purpose.toLowerCase()}`,
        modelName: 'fake-model',
        repaired: false,
        usage: {
          ...command.usage,
          inputTokens: command.usage.inputTokens + 10,
          outputTokens: command.usage.outputTokens + 5,
        },
      }
    }),
  }
  const registry = {
    freezeSnapshot: jest.fn(() => ({ entries: [{ key: 'get_stock_overview', version: 1 }], signature: 'enabled' })),
    toModelSchemas: jest.fn(() => [
      { name: 'get_stock_overview', description: 'overview', parameters: { type: 'object' } },
    ]),
  }
  const toolService = {
    authorize: jest.fn((compiled: any) => ({
      plan: compiled,
      snapshotSignature: 'snapshot_v1',
      allowedTools: compiled.toolPins.map((pin: any) => pin.key),
    })),
    execute: jest.fn(async (command: any) => {
      toolExecutions += command.authorized.plan.toolCalls.length
      return {
        facts: options.facts,
        warnings: [],
        usage: {
          ...command.usage,
          toolCalls: command.usage.toolCalls + command.authorized.plan.toolCalls.length,
        },
      }
    }),
  }
  const contextService = {
    build: jest.fn(async () => loadedContext()),
    prepareModelCall: jest.fn((command: any) => ({
      context: command.context,
      messages: [
        { role: 'system', content: command.context.workflowPrompt.template },
        { role: 'user', content: JSON.stringify({ instruction: command.instruction, ...command.stageData }) },
      ],
      manifest: command.context.manifest,
      warnings: command.context.warnings,
    })),
  }
  const summaryGenerator = {
    maybeCompact: jest.fn(async (command: any) => ({
      status: 'SKIPPED',
      reason: 'BELOW_THRESHOLD',
      usage: command.usage,
    })),
  }

  const engine = new WorkflowEngineService(
    runRepository,
    completion,
    budgets,
    config,
    logger,
    new LoadContextNode(contextService as never, summaryGenerator as never),
    new PlanNode(model as never, registry as never, contextService as never),
    new AuthorizeToolsNode(new ResearchPlanCompilerService(), toolService as never, budgets),
    new ExecuteToolsNode(toolService as never),
    new SynthesizeNode(model as never, contextService as never),
    new ValidateCitationsNode(new CitationCoverageService(), model as never),
    new PersistNode(new WorkflowFinalizationService()),
    new CompleteNode(),
  )

  return {
    engine,
    run,
    workflow,
    steps,
    modelPurposes,
    get completionCommand() {
      return completionCommand
    },
    get toolExecutions() {
      return toolExecutions
    },
  }
}

function makeRun(workflow: FrozenWorkflowDefinition): AgentExecutionRun {
  const now = new Date()
  return {
    id: 'run_workflow_fixture',
    userId: 1,
    conversationId: 'conversation_fixture',
    triggerMessageId: 'trigger_fixture',
    responseMessageId: 'response_fixture',
    clientRequestId: 'client_fixture',
    requestHash: '0'.repeat(64),
    traceId: 'trace_fixture',
    status: AiAgentRunStatus.RUNNING,
    statusVersion: 2,
    workflowVersionId: 'workflow_version_fixture',
    promptVersionId: 'prompt_version_fixture',
    toolPolicyVersion: 'tool-policy-v1',
    modelPolicy: AiModelPolicy.AUTO,
    preferredModel: null,
    inputSnapshot: { allowedCapabilities: ['INTERNAL_DATA'], allowedScopes: ['MARKET_DATA'] },
    budget: {},
    resultSummary: null,
    errorCode: null,
    errorClass: null,
    errorMessage: null,
    attempt: 1,
    maxAttempts: 3,
    nextEventSequence: 2n,
    checkpoint: {},
    checkpointVersion: 0,
    cancelRequestedAt: null,
    cancelRequestedBy: null,
    cancelReason: null,
    leaseOwner: 'worker_1',
    leaseExpiresAt: new Date(Date.now() + 30_000),
    heartbeatAt: now,
    deadlineAt: new Date(Date.now() + 120_000),
    queuedAt: now,
    startedAt: now,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    user: { role: UserRole.USER, status: UserStatus.ACTIVE },
    triggerMessage: { id: 'trigger_fixture', contentText: '分析 600519.SH' },
    workflowVersion: {
      id: 'workflow_version_fixture',
      workflowKey: workflow.key,
      version: workflow.version,
      status: AiVersionStatus.PUBLISHED,
      definition: {},
      toolAllowlist: [...workflow.toolAllowlist],
      inputSchema: {},
      outputSchema: {},
      contentHash: workflow.contentHash,
      createdBy: 1,
      publishedBy: 1,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
      retiredAt: null,
    },
    promptVersion: {
      id: 'prompt_version_fixture',
      promptKey: workflow.prompt.key,
      version: workflow.prompt.version,
      status: AiVersionStatus.PUBLISHED,
      template: workflow.prompt.template,
      inputSchema: {},
      outputSchema: {},
      contentHash: workflow.promptContentHash,
      createdBy: 1,
      publishedBy: 1,
      createdAt: now,
      updatedAt: now,
      publishedAt: now,
      retiredAt: null,
    },
  }
}

function loadedContext(): LoadedWorkflowContext {
  return {
    userId: 1,
    role: UserRole.USER,
    userStatus: UserStatus.ACTIVE,
    conversationId: 'conversation_fixture',
    triggerMessageId: 'trigger_fixture',
    responseMessageId: 'response_fixture',
    userText: '分析 600519.SH',
    systemPolicy: 'system policy',
    workflowPrompt: {
      workflowKey: 'stock_research',
      workflowVersion: 1,
      workflowHash: 'workflow_hash',
      promptVersionId: 'prompt_fixture',
      promptKey: 'stock_research_system',
      promptVersion: 1,
      promptHash: 'prompt_hash',
      template: 'workflow prompt',
    },
    recentMessages: [{ role: AiMessageRole.USER, content: '分析 600519.SH' }],
    allowedCapabilities: ['INTERNAL_DATA'],
    allowedScopes: ['MARKET_DATA'],
    pageContext: {},
    conversationState: {},
    summary: null,
    activeMemories: [],
    retrievedSources: [],
    dataCutoff: null,
    contextTokenCount: 0,
    manifest: {
      schemaVersion: 1,
      runId: 'run_fixture',
      conversationId: 'conversation_fixture',
      budgetTokens: 1_000,
      totalTokens: 0,
      contentHash: 'context_hash',
      segments: [],
      warnings: [],
    },
    warnings: [],
  }
}

function plan(toolCalls: ResearchPlan['toolCalls']): ResearchPlan {
  return { intent: 'stock_research', summary: '读取个股概览并生成回答', toolCalls }
}

function toolCall(id: string, toolKey: ResearchPlan['toolCalls'][number]['toolKey'], dependsOn: string[] = []) {
  return { id, toolKey, toolVersion: 1, input: { tsCode: '600519.SH' }, dependsOn, optional: false }
}

function fact(factId: string): FactPacket {
  return {
    factId,
    toolCallId: 'tool_call_overview',
    toolKey: 'get_stock_overview',
    title: '个股概览',
    sourceType: 'DATABASE',
    sourceIds: [],
    summary: '{"name":"贵州茅台"}',
    retrievedAt: '2026-07-20T00:00:00.000Z',
    asOf: { tradeDate: '2026-07-17', retrievedAt: '2026-07-20T00:00:00.000Z' },
    timezone: 'Asia/Shanghai',
    warnings: [],
  }
}

function answer(factId: string): FinalAnswerDraft {
  return {
    markdown: '基于已验证事实，贵州茅台个股数据已加载。',
    claims: [{ claimKey: 'overview_claim', text: '个股数据已加载', factIds: [factId] }],
    warnings: [],
    dataCutoff: '2026-07-17',
  }
}
