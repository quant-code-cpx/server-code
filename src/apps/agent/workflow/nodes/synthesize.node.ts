import { Injectable } from '@nestjs/common'
import { modelMessage, WorkflowModelService } from '../workflow-model.service'
import type { FinalAnswerDraft } from '../workflow.types'
import { FINAL_ANSWER_SCHEMA } from '../workflows/stock-research.v1'
import { WorkflowValidationError } from '../workflow.errors'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class SynthesizeNode implements WorkflowNodeHandler {
  readonly key = 'synthesize' as const

  constructor(private readonly models: WorkflowModelService) {}

  async execute({ run, state, limits, stepId, signal }: WorkflowNodeExecutionContext) {
    if (!state.context || !state.plan) throw new WorkflowValidationError('synthesize 节点缺少上下文或计划')
    const result = await this.models.generateStructured<FinalAnswerDraft>({
      run,
      stepId,
      purpose: 'SYNTHESIZE',
      messages: [
        modelMessage('system', run.promptVersion.template),
        modelMessage(
          'user',
          JSON.stringify({
            task: state.context.userText,
            planSummary: state.plan.summary,
            facts: state.facts.map((fact) => ({
              factId: fact.factId,
              toolKey: fact.toolKey,
              summary: fact.summary,
              asOf: fact.asOf,
              warnings: fact.warnings,
            })),
            warnings: state.warnings,
            instruction: 'Every factual claim must cite existing factIds. Never invent a factId.',
          }),
        ),
      ],
      responseSchema: FINAL_ANSWER_SCHEMA,
      maxOutputTokens: 2_000,
      usage: state.budget,
      limits,
      signal,
    })
    return { ...state, draft: result.data, budget: result.usage, modelName: result.modelName }
  }
}
