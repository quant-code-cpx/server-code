import { Injectable } from '@nestjs/common'
import { ResearchPlanCompilerService } from '../research-plan-compiler.service'
import { WorkflowBudgetService } from '../workflow-budget.service'
import { WorkflowValidationError } from '../workflow.errors'
import { WorkflowToolService } from '../workflow-tool.service'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class AuthorizeToolsNode implements WorkflowNodeHandler {
  readonly key = 'authorize_tools' as const

  constructor(
    private readonly compiler: ResearchPlanCompilerService,
    private readonly tools: WorkflowToolService,
    private readonly budgets: WorkflowBudgetService,
  ) {}

  async execute({ workflow, state, limits }: WorkflowNodeExecutionContext) {
    if (!state.context || !state.plan) throw new WorkflowValidationError('authorize_tools 节点缺少上下文或计划')
    const remainingToolCalls = limits.maxToolCalls - state.budget.toolCalls
    const compiled = this.compiler.compile(state.plan, workflow, state.context.allowedCapabilities, remainingToolCalls)
    this.budgets.assertCanPlanToolCalls(state.budget, compiled.toolCalls.length, limits)
    const authorized = this.tools.authorize(compiled)
    return {
      ...state,
      compiledPlan: authorized.plan,
      toolSnapshotSignature: authorized.snapshotSignature,
    }
  }
}
