import { Injectable } from '@nestjs/common'
import { WorkflowValidationError } from '../workflow.errors'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class CompleteNode implements WorkflowNodeHandler {
  readonly key = 'complete' as const

  async execute({ state }: WorkflowNodeExecutionContext) {
    if (!state.finalization) throw new WorkflowValidationError('complete 节点缺少最终持久化载荷')
    return state
  }
}
