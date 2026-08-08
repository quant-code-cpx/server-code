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
import { selectCitationRepairFacts, ValidateCitationsNode } from '../nodes/validate-citations.node'
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
import {
  STOCK_RESEARCH_WORKFLOW_CURRENT,
  STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V2,
  STOCK_RESEARCH_WORKFLOW_V5,
} from '../workflows/stock-research.v2'

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

  it('[BIZ] Workflow v5 冻结第一批 Tool 路由，并允许 screen_stocks@2', () => {
    const registry = new WorkflowRegistryService(STOCK_RESEARCH_WORKFLOW_DEFINITIONS)
    registry.onModuleInit()
    const v5 = registry.resolve('stock_research', 5)
    const compiler = new ResearchPlanCompilerService()

    expect(STOCK_RESEARCH_WORKFLOW_CURRENT).toBe(STOCK_RESEARCH_WORKFLOW_V5)
    expect(v5.toolAllowlist).toEqual(
      expect.arrayContaining([
        'get_stock_technical_indicators',
        'get_stock_technical_signals',
        'get_data_availability',
        'screen_stocks',
      ]),
    )
    expect(v5.prompt.template).toContain('Never call screen_stocks for an exact single-stock standard-signal question')
    const compiled = compiler.compile(
      plan([{ ...toolCall('screen', 'screen_stocks'), toolVersion: 2 }]),
      v5,
      ['INTERNAL_DATA'],
      1,
    )
    expect(compiled.toolPins).toEqual([{ key: 'screen_stocks', version: 2 }])
  })

  it('[COMPAT] Workflow v1-v4 的计划 schema 仍冻结 toolVersion=1', () => {
    const registry = new WorkflowRegistryService(STOCK_RESEARCH_WORKFLOW_DEFINITIONS)
    registry.onModuleInit()
    const v4 = registry.resolve('stock_research', 4)
    expect(v4.planSchema).toEqual(STOCK_RESEARCH_WORKFLOW_V1.planSchema)
    const planProperties = v4.planSchema.properties as Record<string, Record<string, unknown>>
    const toolCallItems = planProperties.toolCalls.items as Record<string, Record<string, unknown>>
    expect(toolCallItems.properties.toolVersion).toEqual({ const: 1 })
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
      maxCumulativeInputTokens: 999_999,
      inputTokenGuardrailSource: 'ENV',
      maxCost: 999,
    })
    expect(limits).toMatchObject({
      maxSteps: 8,
      maxToolCalls: 20,
      maxParallelTools: 3,
      maxCumulativeInputTokens: null,
    })
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
    expect(harness.modelOutputTokenLimits).toEqual([
      { purpose: 'PLAN', maxOutputTokens: 384_000 },
      { purpose: 'SYNTHESIZE', maxOutputTokens: 384_000 },
    ])
  })

  it('最终数据口径用中文说明数据限制，不暴露工作流告警码', () => {
    const finalization = new WorkflowFinalizationService().build({
      runId: 'run_finalization_fixture',
      context: loadedContext(),
      draft: answer('fact_overview'),
      facts: [fact('fact_overview')],
      warnings: ['行情数据只覆盖最近 250 个交易日'],
      usage: { steps: 1, toolCalls: 1, inputTokens: 1, outputTokens: 1, cost: 0, costCurrency: 'CNY' },
      modelName: 'fake-model',
    })

    expect(finalization.contentBlocks[0]).toMatchObject({
      provenance: {
        qualityFlags: ['数据提示：本回答有 1 项数据限制，具体说明见正文“数据限制”。'],
      },
    })
    expect(JSON.stringify(finalization.contentBlocks[0])).not.toContain('WORKFLOW_WARNING_')
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
    expect(result.facts[0]?.title).toBe('个股基础数据')
    expect(result.warnings).toEqual(['可选 Tool search_web 失败：搜索暂不可用'])
    expect(result.usage.toolCalls).toBe(2)
  })

  it('[DATA][ORACLE] 任一 required Tool 无数据都必须失败，不能被同层无关事实替代', async () => {
    const budgets = new WorkflowBudgetService(config)
    const workflow = createRegistry().resolve('stock_research', 1)
    const compiler = new ResearchPlanCompilerService()
    const registry = {
      freezeSnapshot: jest.fn((pins: any) => ({ entries: pins, signature: 'data_fallback_snapshot' })),
      get: jest.fn((key: string, version: number) => ({
        key,
        version,
        policy: { sideEffect: 'READ', idempotent: true },
      })),
    }
    const executor = {
      execute: jest.fn(async (command: any) => {
        if (command.toolKey === 'get_stock_price_history') {
          throw new ToolExecutionError({
            ok: false,
            toolCallId: 'tool_call_today',
            toolKey: 'get_stock_price_history',
            toolVersion: 1,
            code: 'DATA_NOT_FOUND',
            message: '请求区间无行情数据',
            retryable: false,
          })
        }
        return {
          ok: true,
          toolCallId: 'tool_call_overview',
          toolKey: 'get_stock_overview',
          toolVersion: 1,
          data: { name: '佰维存储', quoteDate: '2026-08-04' },
          provenance: {
            sourceType: 'DATABASE',
            sourceServices: ['stock'],
            sourceModels: ['daily'],
            asOf: { tradeDate: '2026-08-04', retrievedAt: '2026-08-05T13:00:00.000Z' },
            timezone: 'Asia/Shanghai',
          },
          citationSourceIds: [],
          warnings: [],
          truncated: false,
        }
      }),
    }
    const service = new WorkflowToolService(registry as never, executor as never, budgets)
    const execute = (calls: ResearchPlan['toolCalls']) => {
      const compiled = compiler.compile(
        calls.length ? plan(calls) : plan([]),
        workflow,
        ['INTERNAL_DATA'],
        calls.length,
      )
      return service.execute({
        run: makeRun(workflow),
        stepId: 'step_execute_tools',
        authorized: service.authorize(compiled),
        context: loadedContext(),
        usage: budgets.initialUsage(budgets.resolveLimits(workflow, {})),
        limits: budgets.resolveLimits(workflow, { maxParallelTools: 2, maxToolCalls: calls.length }),
      })
    }

    await expect(
      execute([toolCall('today', 'get_stock_price_history'), toolCall('overview', 'get_stock_overview')]),
    ).rejects.toMatchObject({
      category: 'TOOL',
      agentCode: 6013,
    })
    await expect(execute([toolCall('today_only', 'get_stock_price_history')])).rejects.toMatchObject({
      category: 'TOOL',
      agentCode: 6013,
    })
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

  it('依赖 Tool 成功后解析受控结果绑定；空候选或依赖失败时安全跳过下游', async () => {
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

    const emptyExecutor = {
      execute: jest.fn(async () => ({
        ok: true,
        toolCallId: 'tool_call_search_empty',
        toolKey: 'search_web',
        toolVersion: 1,
        data: { results: [] },
        provenance: {
          sourceType: 'MEDIA',
          sourceServices: ['search'],
          sourceModels: ['AiSearchSource'],
          asOf: { retrievedAt: '2026-07-20T00:00:00.000Z' },
          timezone: 'UTC',
        },
        citationSourceIds: [],
        warnings: [],
        truncated: false,
      })),
    }
    const empty = await new WorkflowToolService(registry as never, emptyExecutor as never, budgets).execute({
      run: makeRun(workflow),
      stepId: 'step_execute_tools',
      authorized: toolService.authorize(compiled),
      context: { ...loadedContext(), allowedCapabilities: ['WEB_SEARCH'] },
      usage: budgets.initialUsage(budgets.resolveLimits(workflow, {})),
      limits: budgets.resolveLimits(workflow, { maxToolCalls: 2 }),
    })
    expect(emptyExecutor.execute).toHaveBeenCalledTimes(1)
    expect(empty.facts.map((item) => item.factId)).toEqual(['fact_search'])
    expect(empty.warnings).toEqual(['Tool fetch_web_page 已跳过：依赖查询未返回可用候选'])
    expect(empty.usage.toolCalls).toBe(1)

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
    expect(repaired.modelOutputTokenLimits).toEqual([
      { purpose: 'PLAN', maxOutputTokens: 384_000 },
      { purpose: 'SYNTHESIZE', maxOutputTokens: 384_000 },
      { purpose: 'VERIFY', maxOutputTokens: 384_000 },
    ])

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

  it('[CITE][BUDGET] 引用修复只携带失败 Claim 依赖的事实', () => {
    const overview = {
      ...fact('fact_overview'),
      summary: '{"pctChg":-1.9986,"close":28.93}',
    }
    const technical = {
      ...fact('fact_technical'),
      toolKey: 'get_stock_technical_indicators' as const,
      summary: '{"rsi6":72.6}',
    }
    const draft: FinalAnswerDraft = {
      markdown: '今日下跌1.99%，RSI6为72.6点。',
      claims: [
        { claimKey: 'quote_today', text: '今日下跌1.99%', factIds: ['fact_overview'] },
        { claimKey: 'technical', text: 'RSI6为72.6点', factIds: ['fact_technical'] },
      ],
      warnings: [],
      dataCutoff: '2026-08-06',
    }

    const selected = selectCitationRepairFacts(
      draft,
      [overview, technical],
      [
        'Claim quote_today 包含无法由引用事实支持的数字或日期：1.99%',
        '回答正文包含无法由已声明引用支持的数字或日期：1.99%',
      ],
    )

    expect(selected.map((item) => item.factId)).toEqual(['fact_overview'])
  })

  it('[CITE][ORACLE] 引用 ID 存在但结论数字不受事实支持时仍必须拒绝', () => {
    const coverage = new CitationCoverageService()
    const citedFact = {
      ...fact('fact_overview'),
      summary: '{"name":"贵州茅台","pctChg":1.55,"tradeDate":"2026-08-05"}',
    }

    expect(
      coverage.validate(
        {
          markdown: '贵州茅台上涨 99.9%。',
          claims: [{ claimKey: 'price_move', text: '贵州茅台上涨 99.9%', factIds: ['fact_overview'] }],
          warnings: [],
          dataCutoff: '2026-08-05',
        },
        [citedFact],
      ),
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.stringContaining('99.9')]),
    })

    expect(
      coverage.validate(
        {
          markdown: '贵州茅台上涨 1.55%，数据日为 2026-08-05。',
          claims: [
            {
              claimKey: 'price_move',
              text: '贵州茅台上涨 1.55%，数据日为 2026-08-05',
              factIds: ['fact_overview'],
            },
          ],
          warnings: [],
          dataCutoff: '2026-08-05',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: true })
  })

  it('[CITE][ORACLE] 支持基于事实值的四舍五入与金额单位换算，但拒绝超出展示精度的值', () => {
    const coverage = new CitationCoverageService()
    const citedFact = {
      ...fact('fact_overview'),
      summary:
        '{"pctChg":1.2161,"amount":3239601.343,"turnoverRate":2.9949,"peTtm":17.7255,"pb":1.5196,"dividendYieldTtm":1.6529,"totalMarketValue":10934243.1864}',
    }
    const displayText =
      '上涨1.22%，成交额32.40亿元，换手率2.99%，PE(TTM)17.7倍，PB1.52倍，股息率1.65%，总市值1093亿元。'

    expect(
      coverage.validate(
        {
          markdown: displayText,
          claims: [{ claimKey: 'snapshot', text: displayText, factIds: ['fact_overview'] }],
          warnings: [],
          dataCutoff: '2026-08-05',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: true })

    expect(
      coverage.validate(
        {
          markdown: '成交额32.41亿元。',
          claims: [{ claimKey: 'snapshot', text: '成交额32.41亿元。', factIds: ['fact_overview'] }],
          warnings: [],
          dataCutoff: '2026-08-05',
        },
        [citedFact],
      ),
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.stringContaining('32.41亿元')]),
    })
  })

  it('[CITE][ORACLE] 支持亿元原始值与小数百分比的展示换算', () => {
    const coverage = new CitationCoverageService()
    const citedFact = {
      ...fact('fact_macro_and_performance'),
      summary: '{"GDP":{"gdp":334192.9},"CAGR":10.83315016473197,"MAX_DRAWDOWN":-0.01980198019801982}',
    }
    const draft = {
      markdown: 'GDP 为 334192.9亿元，CAGR 为 1083.3%，最大回撤为 -1.98%。',
      claims: [
        {
          claimKey: 'macro_and_performance',
          text: 'GDP 为 334192.9亿元，CAGR 为 1083.3%，最大回撤为 -1.98%。',
          factIds: [citedFact.factId],
        },
      ],
      warnings: [],
      dataCutoff: null,
    }

    expect(coverage.validate(draft, [citedFact])).toMatchObject({ valid: true, issues: [] })
  })

  it('[CITE][ORACLE] 支持金额时间序列的可追溯累计与万元到亿元换算', () => {
    const coverage = new CitationCoverageService()
    const citedFact = {
      ...fact('fact_moneyflow'),
      toolKey: 'get_stock_moneyflow' as const,
      summary: JSON.stringify({
        data: {
          days: [
            { netAmount: -49304.82 },
            { netAmount: -45332.04 },
            { netAmount: 59796.96 },
            { netAmount: -133056.89 },
            { netAmount: -38842.99 },
          ],
          units: { amount: 'CNY_10K' },
        },
      }),
    }
    const displayText = '最近五日累计净流出20.67亿元（-206,739.78万元）。'

    expect(
      coverage.validate(
        {
          markdown: displayText,
          claims: [{ claimKey: 'cumulative_net_outflow', text: displayText, factIds: [citedFact.factId] }],
          warnings: [],
          dataCutoff: '2026-08-07',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: true, issues: [] })

    expect(
      coverage.validate(
        {
          markdown: '最近五日累计净流出20.68亿元。',
          claims: [
            {
              claimKey: 'wrong_cumulative_net_outflow',
              text: '最近五日累计净流出20.68亿元。',
              factIds: [citedFact.factId],
            },
          ],
          warnings: [],
          dataCutoff: '2026-08-07',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.stringContaining('20.68亿元')]) })
  })

  it('[CITE][ORACLE] 价格区间连字符不得被误识别为负号', () => {
    const coverage = new CitationCoverageService()
    const citedFact = {
      ...fact('fact_history'),
      summary: '{"min":35.91,"max":40.55,"otherMin":10.28,"otherMax":11.63}',
    }
    const displayText = '收盘价波动区间：招商银行35.91-40.55元，平安银行10.28-11.63元。'

    expect(
      coverage.validate(
        {
          markdown: displayText,
          claims: [{ claimKey: 'price_range', text: displayText, factIds: [citedFact.factId] }],
          warnings: [],
          dataCutoff: '2026-08-07',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: true, issues: [] })
  })

  it('[CITE][ORACLE] 中文下行方向可支持负数事实的正数展示', () => {
    const coverage = new CitationCoverageService()
    const citedFact = { ...fact('fact_history'), summary: '{"minPctChange":-3.7688}' }
    const displayText = '工商银行单日下行3.7688%。'

    expect(
      coverage.validate(
        {
          markdown: displayText,
          claims: [{ claimKey: 'downside', text: displayText, factIds: [citedFact.factId] }],
          warnings: [],
          dataCutoff: '2026-08-07',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: true, issues: [] })
  })

  it('[CITE][ORACLE] 紧邻数字的“跌”可支持负涨跌幅，但“涨”不能反向匹配', () => {
    const coverage = new CitationCoverageService()
    const citedFact = { ...fact('fact_history'), summary: '{"pctChange":-0.4362}' }

    expect(
      coverage.validate(
        {
          markdown: '8月7日收38.80元、跌0.4362%。',
          claims: [{ claimKey: 'daily_move', text: '8月7日收38.80元、跌0.4362%', factIds: [citedFact.factId] }],
          warnings: [],
          dataCutoff: '2026-08-07',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.stringContaining('38.80元')]) })

    expect(
      coverage.validate(
        {
          markdown: '跌0.4362%。',
          claims: [{ claimKey: 'daily_move', text: '跌0.4362%', factIds: [citedFact.factId] }],
          warnings: [],
          dataCutoff: '2026-08-07',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: true, issues: [] })

    expect(
      coverage.validate(
        {
          markdown: '涨0.4362%。',
          claims: [{ claimKey: 'wrong_direction', text: '涨0.4362%', factIds: [citedFact.factId] }],
          warnings: [],
          dataCutoff: '2026-08-07',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.stringContaining('0.4362%')]) })
  })

  it('[CITE][ORACLE] 支持紧凑日期和负值的中文方向展示', () => {
    const coverage = new CitationCoverageService()
    const citedFact = {
      ...fact('fact_directional_values'),
      summary: '{"tradeDate":"20250807","netAmount":-16172.27,"pctChg":-0.1469}',
    }
    const draft = {
      markdown: '数据日为2025-08-07，主力资金净流出16172.27万元，指数下跌0.1469%。',
      claims: [
        {
          claimKey: 'directional_values',
          text: '数据日为2025-08-07，主力资金净流出16172.27万元，指数下跌0.1469%。',
          factIds: [citedFact.factId],
        },
      ],
      warnings: [],
      dataCutoff: '2025-08-07',
    }

    expect(coverage.validate(draft, [citedFact])).toMatchObject({ valid: true, issues: [] })
    expect(
      coverage.validate(
        {
          ...draft,
          markdown: '数据日为2025-08-07，指数上涨0.1469%。',
          claims: [
            {
              claimKey: 'wrong_direction',
              text: '数据日为2025-08-07，指数上涨0.1469%。',
              factIds: [citedFact.factId],
            },
          ],
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.stringContaining('0.1469%')]) })
  })

  it('[CITE][ORACLE] 同一数值多次出现时按各自位置识别负向语义，并支持低约差额', () => {
    const coverage = new CitationCoverageService()
    const citedFact = {
      ...fact('fact_price_position'),
      summary:
        '{"last":1309.22,"max":1489.7034}\n[结构化数值摘要V1]\n{"series":[{"change":-180.4834,"changePct":-12.1153915605,"path":"$.bars[].close"}],"version":1}',
    }
    const markdown = '距最高收盘约-12.12%（低约180.48元）；半年内累计下跌约12.12%，当前仍低于区间高点。'

    expect(
      coverage.validate(
        {
          markdown,
          claims: [{ claimKey: 'price_position', text: markdown, factIds: [citedFact.factId] }],
          warnings: [],
          dataCutoff: '2026-08-07',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: true, issues: [] })
  })

  it('[CITE][EDGE] 千分位价格按完整数字校验，不得截断为逗号后的尾数', () => {
    const coverage = new CitationCoverageService()
    const citedFact = { ...fact('fact_overview'), summary: '{"close":1500,"tradeDate":"2026-07-17"}' }
    const displayText = '贵州茅台在 2026-07-17 的收盘价为 1,500 元。'

    expect(
      coverage.validate(
        {
          markdown: displayText,
          claims: [{ claimKey: 'close', text: displayText, factIds: ['fact_overview'] }],
          warnings: [],
          dataCutoff: '2026-07-17',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: true, issues: [] })
  })

  it('[CITE][EDGE] Markdown 不能绕过 Claim 数字校验，研究窗口数量不误判成行情事实', () => {
    const coverage = new CitationCoverageService()
    const citedFact = {
      ...fact('fact_overview'),
      summary: '{"name":"贵州茅台","pctChg":1.55,"tradeDate":"2026-08-05"}',
    }

    expect(
      coverage.validate(
        {
          markdown: '贵州茅台最近20日上涨 99.9%。',
          claims: [{ claimKey: 'price_move', text: '涨幅为 1.55%', factIds: ['fact_overview'] }],
          warnings: [],
          dataCutoff: '2026-08-05',
        },
        [citedFact],
      ),
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([expect.stringContaining('99.9')]),
    })

    expect(
      coverage.validate(
        {
          markdown: '贵州茅台最近20日上涨 1.55%。',
          claims: [{ claimKey: 'price_move', text: '最近20日涨幅为 1.55%', factIds: ['fact_overview'] }],
          warnings: [],
          dataCutoff: '2026-08-05',
        },
        [citedFact],
      ),
    ).toMatchObject({ valid: true })
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
  const modelOutputTokenLimits: Array<{ purpose: string; maxOutputTokens: number }> = []
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
    resolveModelProfile: jest.fn(() => modelProfile()),
    resolveMaxOutputTokens: jest.fn(() => 384_000),
    resolveInputTokenBudget: jest.fn(
      (_run: unknown, usage: any, limits: any) =>
        (limits.maxCumulativeInputTokens ?? Number.MAX_SAFE_INTEGER) - usage.inputTokens,
    ),
    generateStructured: jest.fn(async (command: any) => {
      modelPurposes.push(command.purpose)
      modelOutputTokenLimits.push({ purpose: command.purpose, maxOutputTokens: command.maxOutputTokens })
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
    new LoadContextNode(contextService as never, summaryGenerator as never, model as never),
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
    modelOutputTokenLimits,
    get completionCommand() {
      return completionCommand
    },
    get toolExecutions() {
      return toolExecutions
    },
  }
}

function modelProfile() {
  return {
    selectedProvider: 'fake',
    selectedModel: 'fake-model',
    candidates: [
      {
        provider: 'fake',
        model: 'fake-model',
        contextWindow: 1_000_000,
        maxOutputTokens: 384_000,
        capabilities: ['STREAMING', 'STRUCTURED_OUTPUT'],
        reasoningEfforts: [],
        dataClasses: ['USER_PRIVATE'],
      },
    ],
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
