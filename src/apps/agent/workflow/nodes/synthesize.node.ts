import { Injectable } from '@nestjs/common'
import { ContextBuilderService } from '../../memory/context-builder.service'
import { isCitableFact } from '../citation-coverage.service'
import { WorkflowModelService } from '../workflow-model.service'
import type { FinalAnswerDraft } from '../workflow.types'
import { WorkflowValidationError } from '../workflow.errors'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class SynthesizeNode implements WorkflowNodeHandler {
  readonly key = 'synthesize' as const

  constructor(
    private readonly models: WorkflowModelService,
    private readonly contexts: ContextBuilderService,
  ) {}

  async execute({ run, workflow, state, limits, stepId, workerId, signal }: WorkflowNodeExecutionContext) {
    if (!state.context || !state.plan) throw new WorkflowValidationError('synthesize 节点缺少上下文或计划')
    const citableFacts = state.facts.filter(isCitableFact)
    const maxOutputTokens = workflow.version >= 4 ? 4_096 : 2_000
    const prepared = this.contexts.prepareModelCall({
      context: state.context,
      budget: this.models.resolveInputTokenBudget(run, state.budget, limits, maxOutputTokens),
      purpose: 'SYNTHESIZE',
      instruction:
        'Answer the latest user message concisely. Every factual claim must cite existing factIds. Never invent a factId. Search snippets are not citable evidence. For rankings, show at most the requested top N and do not repeat raw tool payloads.',
      stageData: { planSummary: state.plan.summary, warnings: state.warnings },
      toolFacts: citableFacts,
    })
    const result = await this.models.generateStructured<FinalAnswerDraft>({
      run,
      stepId,
      purpose: 'SYNTHESIZE',
      messages: prepared.messages,
      contextManifest: prepared.manifest,
      responseSchema: workflow.outputSchema,
      maxOutputTokens,
      usage: state.budget,
      limits,
      workerId,
      signal,
    })
    return {
      ...state,
      context: prepared.context,
      draft: result.data,
      budget: result.usage,
      finalModelCallId: result.modelCallId,
      modelName: result.modelName,
      warnings: [...new Set([...state.warnings, ...prepared.warnings])],
    }
  }
}
