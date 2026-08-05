import { ToolCapabilityCatalogService } from '../../tools/tool-capability-catalog.service'
import { SelectToolsNode } from '../nodes/select-tools.node'
import { PlanNode } from '../nodes/plan.node'
import { WorkflowRegistryService } from '../workflow-registry.service'
import { ResearchPlanCompilerService } from '../research-plan-compiler.service'
import { STOCK_RESEARCH_WORKFLOW_DEFINITIONS, STOCK_RESEARCH_WORKFLOW_V6 } from '../workflows/stock-research.v6'
import {
  STOCK_RESEARCH_WORKFLOW_DEFINITIONS as STOCK_RESEARCH_WORKFLOW_DEFINITIONS_V7,
  STOCK_RESEARCH_WORKFLOW_V7,
} from '../workflows/stock-research.v7'
import {
  STOCK_RESEARCH_WORKFLOW_DEFINITIONS as STOCK_RESEARCH_WORKFLOW_DEFINITIONS_V8,
  STOCK_RESEARCH_WORKFLOW_V8,
} from '../workflows/stock-research.v8'

describe('Workflow v6 Tool 能力预选', () => {
  const entries = [
    { key: 'resolve_security', version: 1 },
    { key: 'get_stock_overview', version: 1 },
    { key: 'get_data_availability', version: 1 },
    { key: 'screen_stocks', version: 2 },
    { key: 'get_stock_events', version: 1 },
    { key: 'get_stock_chip_profile', version: 1 },
  ] as const
  const registry = {
    freezeSnapshot: jest.fn().mockReturnValue({ entries, signature: 'enabled' }),
    get: jest.fn().mockReturnValue({ policy: { costClass: 'MEDIUM' } }),
  }
  const catalog = new ToolCapabilityCatalogService(registry as never)
  const context = {
    prepareModelCall: jest.fn().mockImplementation(({ context: value }) => ({
      context: value,
      messages: [],
      manifest: {},
      warnings: [],
    })),
  }
  const model = {
    resolveModelProfile: jest.fn().mockReturnValue({ selectedProvider: 'test', selectedModel: 'test', candidates: [] }),
    resolveInputTokenBudget: jest.fn().mockReturnValue(4_000),
    resolveMaxOutputTokens: jest.fn().mockReturnValue(2_000),
    generateStructured: jest.fn(),
  }
  const execution = {
    run: {},
    workflow: STOCK_RESEARCH_WORKFLOW_V6,
    state: {
      context: { userText: '浦发银行未来90天有哪些已公告事件？' },
      modelProfile: null,
      budget: { steps: 1, toolCalls: 0, inputTokens: 0, outputTokens: 0, cost: 0, costCurrency: 'CNY' },
      warnings: [],
    },
    limits: {},
    stepId: 'step',
  }

  beforeEach(() => jest.clearAllMocks())

  it('[CATALOG] 只暴露生产已启用且在 Workflow allowlist 的短目录', () => {
    const snapshot = catalog.snapshot(STOCK_RESEARCH_WORKFLOW_V6 as never)
    expect(snapshot.version).toBe(1)
    expect(snapshot.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(snapshot.descriptors.map((item) => item.key)).toEqual(
      expect.arrayContaining(entries.map((item) => item.key)),
    )
    expect(snapshot.descriptors.find((item) => item.key === 'get_stock_events')).toMatchObject({
      pack: 'STOCK_DEEP',
      purpose: '查询公司结构化事件',
    })
  })

  it('[SELECT] 个股 Tool 自动补 resolve_security，Planner 仅可见所选 key', async () => {
    model.generateStructured.mockResolvedValue({
      data: { packs: ['STOCK_DEEP'], toolKeys: ['get_stock_events'], reason: '查询事件' },
      usage: { steps: 1, toolCalls: 0, inputTokens: 100, outputTokens: 20, cost: 0, costCurrency: 'CNY' },
      modelName: 'selector-model',
    })
    const result = await new SelectToolsNode(model as never, catalog, context as never).execute(execution as never)

    expect(result.toolSelection).toMatchObject({
      packs: ['CORE_RESEARCH', 'STOCK_DEEP'],
      toolKeys: ['resolve_security', 'get_stock_events'],
      fallback: false,
      modelName: 'selector-model',
    })
  })

  it('[FAIL-CLOSED] 选择模型失败只回退 CORE_RESEARCH，不暴露全部 Tool', async () => {
    model.generateStructured.mockRejectedValue(new Error('model unavailable'))
    const result = await new SelectToolsNode(model as never, catalog, context as never).execute(execution as never)

    expect(result.toolSelection).toMatchObject({
      packs: ['CORE_RESEARCH'],
      toolKeys: ['resolve_security', 'get_stock_overview', 'get_data_availability'],
      fallback: true,
    })
    expect(result.toolSelection?.toolKeys).not.toContain('get_stock_events')
  })

  it('[BIZ][REG] 科创板和创业板买入信号排行走精确板块全样本筛选，不依赖模型路由', async () => {
    model.generateStructured.mockRejectedValue(new Error('model unavailable'))
    const selected = await new SelectToolsNode(model as never, catalog, context as never).execute({
      ...execution,
      state: {
        ...execution.state,
        context: { userText: '全市场有没有买入信号比较多的个股，列出科创板和创业板前十名' },
      },
    } as never)

    expect(selected.toolSelection).toMatchObject({
      packs: ['STOCK_TECHNICAL'],
      toolKeys: ['screen_stocks'],
      fallback: false,
    })
    expect(selected.toolSelection?.reason).toContain('确定性路由')

    const toolRegistry = {
      freezeSnapshot: jest.fn().mockReturnValue({ entries, signature: 'enabled' }),
      toModelSchemas: jest.fn().mockReturnValue([]),
    }
    const planned = await new PlanNode(model as never, toolRegistry as never, context as never).execute({
      ...execution,
      state: selected,
    } as never)
    const compiled = new ResearchPlanCompilerService().compile(
      planned.plan!,
      STOCK_RESEARCH_WORKFLOW_V6 as never,
      ['INTERNAL_DATA'],
      10,
      selected.toolSelection?.toolKeys,
    )

    expect(model.generateStructured).not.toHaveBeenCalled()
    expect(compiled.toolPins).toEqual([{ key: 'screen_stocks', version: 2 }])
    expect(compiled.toolCalls).toEqual([
      expect.objectContaining({
        id: 'screen_star_market',
        input: expect.objectContaining({ market: '科创板', pageSize: 10, preset: 'buy_signal_ranking' }),
      }),
      expect.objectContaining({
        id: 'screen_chinext_market',
        input: expect.objectContaining({ market: '创业板', pageSize: 10, preset: 'buy_signal_ranking' }),
      }),
    ])
    for (const call of compiled.toolCalls) expect(call.input).not.toHaveProperty('exchange')
  })

  it('[ERR] 板块全样本筛选 Tool 未启用时明确失败，不退化成个股抽样', async () => {
    const disabledCatalog = new ToolCapabilityCatalogService({
      freezeSnapshot: jest.fn().mockReturnValue({
        entries: entries.filter((entry) => entry.key !== 'screen_stocks'),
        signature: 'screen-disabled',
      }),
      get: registry.get,
    } as never)

    await expect(
      new SelectToolsNode(model as never, disabledCatalog, context as never).execute({
        ...execution,
        state: {
          ...execution.state,
          context: { userText: '列出科创板和创业板买入信号最多的股票' },
        },
      } as never),
    ).rejects.toThrow('全市场板块排行需要 screen_stocks，但当前未启用')
    expect(model.generateStructured).not.toHaveBeenCalled()
  })

  it('[PLAN] Planner 只收到预选 key 的完整 Schema', async () => {
    const toolRegistry = {
      freezeSnapshot: jest.fn().mockReturnValue({ entries, signature: 'enabled' }),
      toModelSchemas: jest.fn().mockReturnValue([]),
    }
    model.generateStructured.mockResolvedValue({
      data: { intent: 'events', summary: '查询事件', toolCalls: [] },
      usage: execution.state.budget,
      modelName: 'planner-model',
    })
    await new PlanNode(model as never, toolRegistry as never, context as never).execute({
      ...execution,
      state: {
        ...execution.state,
        modelProfile: { selectedProvider: 'test', selectedModel: 'test', candidates: [] },
        toolSelection: {
          catalogVersion: 1,
          catalogHash: 'hash',
          selectionPromptVersion: 1,
          packs: ['CORE_RESEARCH', 'STOCK_DEEP'],
          toolKeys: ['resolve_security', 'get_stock_events'],
          reason: 'events',
          fallback: false,
          modelName: 'selector-model',
        },
      },
    } as never)

    expect(toolRegistry.toModelSchemas).toHaveBeenCalledWith({
      entries: [
        { key: 'resolve_security', version: 1 },
        { key: 'get_stock_events', version: 1 },
      ],
      signature: 'enabled',
    })
    expect(context.prepareModelCall).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.stringContaining('Never approximate either board with exchange'),
      }),
    )
  })

  it('[VERSION] v6 增加 select_tools，v1-v5 定义仍可独立解析', () => {
    const workflowRegistry = new WorkflowRegistryService(STOCK_RESEARCH_WORKFLOW_DEFINITIONS)
    workflowRegistry.onModuleInit()
    expect(workflowRegistry.resolve('stock_research', 6).nodes.map((node) => node.key)).toContain('select_tools')
    expect(workflowRegistry.resolve('stock_research', 5).nodes.map((node) => node.key)).not.toContain('select_tools')
  })
})

describe('Workflow v7 市场与多资产能力目录', () => {
  const entries = [
    { key: 'resolve_security', version: 1 },
    { key: 'get_index_market_data', version: 1 },
    { key: 'get_fund_research', version: 1 },
    { key: 'get_industry_rotation', version: 1 },
    { key: 'get_factor_analysis', version: 1 },
    { key: 'get_macro_snapshot', version: 1 },
  ] as const
  const registry = {
    freezeSnapshot: jest.fn().mockReturnValue({ entries, signature: 'enabled-v7' }),
    get: jest.fn().mockReturnValue({ policy: { costClass: 'MEDIUM' } }),
  }
  const catalog = new ToolCapabilityCatalogService(registry as never)

  it('[CATALOG] v7 暴露五个第三批 Tool，指数/基金带正确证券类型约束', () => {
    const snapshot = catalog.snapshot(STOCK_RESEARCH_WORKFLOW_V7 as never)
    expect(snapshot.version).toBe(2)
    expect(snapshot.descriptors.map((item) => item.key)).toEqual(entries.map((item) => item.key))
    expect(snapshot.descriptors.find((item) => item.key === 'get_index_market_data')?.requiresSecurityTypes).toEqual([
      'INDEX',
    ])
    expect(snapshot.descriptors.find((item) => item.key === 'get_fund_research')?.requiresSecurityTypes).toEqual([
      'FUND',
    ])
    expect(snapshot.descriptors.find((item) => item.key === 'get_macro_snapshot')?.requiresSecurityTypes).toEqual([])
  })

  it('[VERSION] v7 新 allowlist 不污染 v6，v1-v7 均可独立解析', () => {
    expect(STOCK_RESEARCH_WORKFLOW_V6.toolAllowlist).not.toContain('get_macro_snapshot')
    expect(STOCK_RESEARCH_WORKFLOW_V7.toolAllowlist).toContain('get_macro_snapshot')
    const workflowRegistry = new WorkflowRegistryService(STOCK_RESEARCH_WORKFLOW_DEFINITIONS_V7)
    workflowRegistry.onModuleInit()
    expect(workflowRegistry.resolve('stock_research', 7).capabilityCatalogVersion).toBe(2)
    expect(workflowRegistry.resolve('stock_research', 6).capabilityCatalogVersion).toBe(1)
  })

  it('[BUDGET] 单次计划最多调用三次高成本因子 Tool', () => {
    const toolCalls = Array.from({ length: 4 }, (_, index) => ({
      id: `factor-${index}`,
      toolKey: 'get_factor_analysis' as const,
      toolVersion: 1,
      input: { analysis: 'IC', factorNames: ['pe_ttm'] },
      dependsOn: [],
      optional: false,
    }))
    expect(() =>
      new ResearchPlanCompilerService().compile(
        { intent: 'factor', summary: 'factor', toolCalls },
        STOCK_RESEARCH_WORKFLOW_V7 as never,
        ['INTERNAL_DATA'],
        10,
        ['get_factor_analysis'],
      ),
    ).toThrow('单次研究计划最多调用 get_factor_analysis 3 次')
  })
})

describe('Workflow v8 外部研究、衍生品与事件研究能力目录', () => {
  const entries = [
    { key: 'resolve_security', version: 1 },
    { key: 'get_option_market', version: 1 },
    { key: 'run_event_study', version: 1 },
  ] as const
  const registry = {
    freezeSnapshot: jest.fn().mockReturnValue({ entries, signature: 'enabled-v8' }),
    get: jest.fn().mockReturnValue({ policy: { costClass: 'MEDIUM' } }),
  }
  const catalog = new ToolCapabilityCatalogService(registry as never)

  it('[CATALOG] v8 能力目录给期权正确类型，事件研究无需强制证券解析', () => {
    const snapshot = catalog.snapshot(STOCK_RESEARCH_WORKFLOW_V8 as never)
    expect(snapshot.version).toBe(3)
    expect(snapshot.descriptors.find((item) => item.key === 'get_option_market')).toMatchObject({
      pack: 'DERIVATIVES',
      requiresSecurityTypes: ['OPTION'],
    })
    expect(snapshot.descriptors.find((item) => item.key === 'run_event_study')).toMatchObject({
      pack: 'EXTERNAL_EVENT',
      requiresSecurityTypes: [],
    })
  })

  it('[VERSION] v8 新 allowlist 不污染 v7，v1-v8 均可独立解析', () => {
    expect(STOCK_RESEARCH_WORKFLOW_V7.toolAllowlist).not.toContain('run_event_study')
    expect(STOCK_RESEARCH_WORKFLOW_V8.toolAllowlist).toContain('run_event_study')
    const workflowRegistry = new WorkflowRegistryService(STOCK_RESEARCH_WORKFLOW_DEFINITIONS_V8)
    workflowRegistry.onModuleInit()
    expect(workflowRegistry.resolve('stock_research', 8).capabilityCatalogVersion).toBe(3)
    expect(workflowRegistry.resolve('stock_research', 7).capabilityCatalogVersion).toBe(2)
  })

  it('[BUDGET] 单次计划最多调用两次事件研究 Tool', () => {
    const toolCalls = Array.from({ length: 3 }, (_, index) => ({
      id: `event-${index}`,
      toolKey: 'run_event_study' as const,
      toolVersion: 1,
      input: { eventType: 'REPURCHASE' },
      dependsOn: [],
      optional: false,
    }))
    expect(() =>
      new ResearchPlanCompilerService().compile(
        { intent: 'event', summary: 'event', toolCalls },
        STOCK_RESEARCH_WORKFLOW_V8 as never,
        ['INTERNAL_DATA'],
        10,
        ['run_event_study'],
      ),
    ).toThrow('单次研究计划最多调用 run_event_study 2 次')
  })
})
