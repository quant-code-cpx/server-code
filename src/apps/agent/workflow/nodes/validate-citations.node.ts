import { Injectable } from '@nestjs/common'
import { CitationCoverageService } from '../citation-coverage.service'
import { WorkflowCitationError, WorkflowValidationError } from '../workflow.errors'
import { modelMessage, WorkflowModelService } from '../workflow-model.service'
import type { FinalAnswerDraft } from '../workflow.types'
import { FINAL_ANSWER_SCHEMA } from '../workflows/stock-research.v1'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class ValidateCitationsNode implements WorkflowNodeHandler {
  readonly key = 'validate_citations' as const

  constructor(
    private readonly coverage: CitationCoverageService,
    private readonly models: WorkflowModelService,
  ) {}

  async execute({ run, state, limits, stepId, signal }: WorkflowNodeExecutionContext) {
    if (!state.draft) throw new WorkflowValidationError('validate_citations 节点缺少回答草稿')
    const initial = this.coverage.validate(state.draft, state.facts)
    if (initial.valid) return state
    if (state.citationRepairAttempts >= 1) throw new WorkflowCitationError(initial.issues.join('；'))

    const repaired = await this.models.generateStructured<FinalAnswerDraft>({
      run,
      stepId,
      purpose: 'VERIFY',
      messages: [
        modelMessage('system', run.promptVersion.template),
        modelMessage(
          'user',
          JSON.stringify({
            invalidDraft: state.draft,
            validationIssues: initial.issues,
            allowedFacts: state.facts.map((fact) => ({ factId: fact.factId, summary: fact.summary })),
            instruction: 'Repair citations once. Use only allowedFacts factIds.',
          }),
        ),
      ],
      responseSchema: FINAL_ANSWER_SCHEMA,
      maxOutputTokens: 2_000,
      usage: state.budget,
      limits,
      signal,
    })
    const checked = this.coverage.validate(repaired.data, state.facts)
    if (!checked.valid) throw new WorkflowCitationError(checked.issues.join('；'))
    return {
      ...state,
      draft: repaired.data,
      budget: repaired.usage,
      modelName: repaired.modelName,
      citationRepairAttempts: state.citationRepairAttempts + 1,
    }
  }
}
