import { Injectable } from '@nestjs/common'
import { WorkflowValidationError } from '../workflow.errors'
import { WorkflowFinalizationService } from '../workflow-finalization.service'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class PersistNode implements WorkflowNodeHandler {
  readonly key = 'persist' as const

  constructor(private readonly finalization: WorkflowFinalizationService) {}

  async execute({ run, state }: WorkflowNodeExecutionContext) {
    if (!state.context || !state.draft) throw new WorkflowValidationError('persist 节点缺少最终草稿')
    return {
      ...state,
      finalization: this.finalization.build({
        runId: run.id,
        context: state.context,
        draft: state.draft,
        facts: state.facts,
        warnings: state.warnings,
        usage: state.budget,
        modelName: state.modelName,
      }),
    }
  }
}
