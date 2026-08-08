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
    const modelProfile = state.modelProfile ?? this.models.resolveModelProfile(run)
    const citableFacts = state.facts.filter(isCitableFact)
    const maxOutputTokens = this.models.resolveMaxOutputTokens(modelProfile, state.budget, limits)
    const prepared = this.contexts.prepareModelCall({
      context: state.context,
      budget: this.models.resolveInputTokenBudget(modelProfile, state.budget, limits),
      purpose: 'SYNTHESIZE',
      instruction:
        'Answer the latest user message concisely in Simplified Chinese. Every factual claim must cite existing factIds. Never invent a factId. Search snippets are not citable evidence. For rankings, show at most the requested top N and do not repeat raw tool payloads. All user-facing data limitations must explain the business impact in Chinese; never expose tool names, database tables, parameter names, workflow codes, fact IDs, or internal quality labels.',
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
      modelProfile,
    })
    return {
      ...state,
      modelProfile,
      context: prepared.context,
      draft: result.data,
      budget: result.usage,
      finalModelCallId: result.modelCallId,
      modelName: result.modelName,
      warnings: [...new Set([...state.warnings, ...prepared.warnings])],
    }
  }
}
