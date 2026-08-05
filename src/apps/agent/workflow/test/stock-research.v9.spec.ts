import { ResearchPlanCompilerService } from '../research-plan-compiler.service'
import { WorkflowBudgetService } from '../workflow-budget.service'
import { WorkflowRegistryService } from '../workflow-registry.service'
import { WorkflowToolService } from '../workflow-tool.service'
import { STOCK_RESEARCH_WORKFLOW_V8 } from '../workflows/stock-research.v8'
import {
  STOCK_RESEARCH_WORKFLOW_CURRENT,
  STOCK_RESEARCH_WORKFLOW_DEFINITIONS,
  STOCK_RESEARCH_WORKFLOW_V9,
} from '../workflows/stock-research.v9'
import { buildAgentExecutionConfig } from 'src/config/agent-execution.config'

describe('Stock research workflow v9', () => {
  it('[COMPAT] v8 白名单保持冻结，v9 仅增加第五批能力', () => {
    expect(STOCK_RESEARCH_WORKFLOW_CURRENT).toBe(STOCK_RESEARCH_WORKFLOW_V9)
    expect(STOCK_RESEARCH_WORKFLOW_V9.version).toBe(9)
    expect(STOCK_RESEARCH_WORKFLOW_V9.capabilityCatalogVersion).toBe(4)
    expect(STOCK_RESEARCH_WORKFLOW_V8.toolAllowlist).not.toContain('get_backtest_analytics')
    expect(STOCK_RESEARCH_WORKFLOW_V8.toolAllowlist).not.toContain('get_portfolio_analytics')
    expect(STOCK_RESEARCH_WORKFLOW_V9.toolAllowlist).toEqual(
      expect.arrayContaining(['get_backtest_analytics', 'get_portfolio_analytics', 'save_research_report']),
    )
  })

  it('[POLICY] 报告 Tool 只能作为 optional 预览提案，不放行任意写 Tool', () => {
    const compiler = new ResearchPlanCompilerService()
    const workflow = workflowV9()
    const reportCall = {
      id: 'save_report',
      toolKey: 'save_research_report' as const,
      toolVersion: 1,
      input: { runId: 'run-current' },
      dependsOn: [],
      optional: true,
    }
    expect(() =>
      compiler.compile(
        { intent: 'save', summary: '打开报告预览', toolCalls: [{ ...reportCall, optional: false }] },
        workflow,
        ['INTERNAL_DATA'],
        1,
        ['save_research_report'],
      ),
    ).toThrow('optional')

    const compiled = compiler.compile(
      { intent: 'save', summary: '打开报告预览', toolCalls: [reportCall] },
      workflow,
      ['INTERNAL_DATA'],
      1,
      ['save_research_report'],
    )
    const registry = {
      freezeSnapshot: jest.fn((pins) => ({ entries: pins, signature: 'v9-report-proposal' })),
      get: jest.fn(() => ({
        key: 'save_research_report',
        version: 1,
        policy: { sideEffect: 'WRITE', requiresConfirmation: true, idempotent: true },
      })),
    }
    const service = new WorkflowToolService(
      registry as never,
      { execute: jest.fn() } as never,
      new WorkflowBudgetService(buildAgentExecutionConfig({})),
    )
    expect(service.authorize(compiled)).toMatchObject({
      snapshotSignature: 'v9-report-proposal',
      allowedTools: ['save_research_report'],
    })
  })

  it('[BUDGET] 单轮最多两次回测高级分析', () => {
    const workflow = workflowV9()
    const calls = [0, 1, 2].map((index) => ({
      id: `analytics_${index}`,
      toolKey: 'get_backtest_analytics' as const,
      toolVersion: 1,
      input: { analyses: ['MONTE_CARLO'], backtestRunId: 'run-1', monteCarlo: { simulations: 100, seed: index } },
      dependsOn: [],
      optional: false,
    }))
    expect(() =>
      new ResearchPlanCompilerService().compile(
        { intent: 'analyze', summary: '高级回测分析', toolCalls: calls },
        workflow,
        ['INTERNAL_DATA'],
        3,
        ['get_backtest_analytics'],
      ),
    ).toThrow('最多调用 get_backtest_analytics 2 次')
  })
})

function workflowV9() {
  const registry = new WorkflowRegistryService(STOCK_RESEARCH_WORKFLOW_DEFINITIONS)
  registry.onModuleInit()
  return registry.resolve('stock_research', 9)
}
