import { Injectable } from '@nestjs/common'
import { ContextBuilderService } from '../../memory/context-builder.service'
import { ConversationSummaryGeneratorService } from '../../memory/conversation-summary-generator.service'
import { WorkflowModelService } from '../workflow-model.service'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class LoadContextNode implements WorkflowNodeHandler {
  readonly key = 'load_context' as const

  constructor(
    private readonly contexts: ContextBuilderService,
    private readonly summaries: ConversationSummaryGeneratorService,
    private readonly models: WorkflowModelService,
  ) {}

  async execute({ run, workflow, state, limits, stepId, workerId, signal }: WorkflowNodeExecutionContext) {
    const modelProfile = state.modelProfile ?? this.models.resolveModelProfile(run)
    const compacted = await this.summaries.maybeCompact({
      run,
      modelProfile,
      stepId,
      usage: state.budget,
      limits,
      workerId,
      signal,
    })
    const context = await this.contexts.build({
      run,
      workflow,
      budget: this.models.resolveInputTokenBudget(modelProfile, compacted.usage, limits),
    })
    const summaryWarnings = compacted.status === 'WARNING' ? [compacted.warning] : []
    return {
      ...state,
      modelProfile,
      context,
      budget: compacted.usage,
      warnings: [...new Set([...state.warnings, ...summaryWarnings, ...context.warnings])],
    }
  }
}
