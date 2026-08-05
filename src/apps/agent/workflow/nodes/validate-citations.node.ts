import { Injectable } from '@nestjs/common'
import { CitationCoverageService, isCitableFact } from '../citation-coverage.service'
import { WorkflowCitationError, WorkflowValidationError } from '../workflow.errors'
import { modelMessage, WorkflowModelService } from '../workflow-model.service'
import type { FinalAnswerDraft } from '../workflow.types'
import type { WorkflowNodeExecutionContext, WorkflowNodeHandler } from './workflow-node'

@Injectable()
export class ValidateCitationsNode implements WorkflowNodeHandler {
  readonly key = 'validate_citations' as const

  constructor(
    private readonly coverage: CitationCoverageService,
    private readonly models: WorkflowModelService,
  ) {}

  async execute({ run, workflow, state, limits, stepId, workerId, signal }: WorkflowNodeExecutionContext) {
    if (!state.draft) throw new WorkflowValidationError('validate_citations 节点缺少回答草稿')
    const modelProfile = state.modelProfile ?? this.models.resolveModelProfile(run)
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
            allowedFacts: state.facts
              .filter(isCitableFact)
              .map((fact) => ({ factId: fact.factId, summary: fact.summary })),
            instruction: 'Repair citations once. Use only allowedFacts factIds.',
          }),
        ),
      ],
      responseSchema: workflow.outputSchema,
      maxOutputTokens: this.models.resolveMaxOutputTokens(modelProfile, state.budget, limits),
      usage: state.budget,
      limits,
      workerId,
      signal,
      modelProfile,
    })
    const checked = this.coverage.validate(repaired.data, state.facts)
    if (!checked.valid) throw new WorkflowCitationError(checked.issues.join('；'))
    return {
      ...state,
      modelProfile,
      draft: repaired.data,
      budget: repaired.usage,
      finalModelCallId: repaired.modelCallId,
      modelName: repaired.modelName,
      citationRepairAttempts: state.citationRepairAttempts + 1,
    }
  }
}
