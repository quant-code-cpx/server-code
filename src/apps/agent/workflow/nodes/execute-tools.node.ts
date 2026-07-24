import { Injectable } from '@nestjs/common'
import { WorkflowValidationError } from '../workflow.errors'
import { WorkflowToolService } from '../workflow-tool.service'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class ExecuteToolsNode implements WorkflowNodeHandler {
  readonly key = 'execute_tools' as const

  constructor(private readonly tools: WorkflowToolService) {}

  async execute({ run, state, limits, stepId, workerId, signal }: WorkflowNodeExecutionContext) {
    if (!state.context || !state.compiledPlan || !state.toolSnapshotSignature) {
      if (state.compiledPlan?.toolCalls.length === 0 && state.context) {
        return { ...state, facts: [] }
      }
      throw new WorkflowValidationError('execute_tools 节点缺少已授权计划')
    }
    const result = await this.tools.execute({
      run,
      stepId,
      authorized: {
        plan: state.compiledPlan,
        snapshotSignature: state.toolSnapshotSignature,
        allowedTools: state.compiledPlan.toolPins.map((pin) => pin.key),
      },
      context: state.context,
      usage: state.budget,
      limits,
      workerId,
      signal,
    })
    return {
      ...state,
      facts: result.facts,
      warnings: [...state.warnings, ...result.warnings],
      budget: result.usage,
    }
  }
}
