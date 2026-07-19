import { Injectable } from '@nestjs/common'
import { WorkflowContextService } from '../workflow-context.service'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class LoadContextNode implements WorkflowNodeHandler {
  readonly key = 'load_context' as const

  constructor(private readonly contexts: WorkflowContextService) {}

  async execute({ run, state }: WorkflowNodeExecutionContext) {
    const context = await this.contexts.load(run)
    return { ...state, context }
  }
}
