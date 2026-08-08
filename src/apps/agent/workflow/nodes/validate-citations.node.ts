import { Injectable } from '@nestjs/common'
import { CitationCoverageService, isCitableFact } from '../citation-coverage.service'
import { WorkflowCitationError, WorkflowValidationError } from '../workflow.errors'
import { modelMessage, WorkflowModelService } from '../workflow-model.service'
import type { FactPacket, FinalAnswerDraft } from '../workflow.types'
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
    const repairFacts = selectCitationRepairFacts(state.draft, state.facts, initial.issues)

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
            allowedFacts: repairFacts.map((fact) => ({ factId: fact.factId, summary: fact.summary })),
            instruction:
              'Repair only listed validation issues. Preserve already-valid claims, wording, and their existing factIds. For repaired claims use only allowedFacts factIds.',
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

export function selectCitationRepairFacts(
  draft: FinalAnswerDraft,
  facts: readonly FactPacket[],
  issues: readonly string[],
): FactPacket[] {
  const citableFacts = facts.filter(isCitableFact)
  const invalidClaimKeys = new Set(
    issues.flatMap((issue) => {
      const matched = /^Claim\s+(\S+)\s+/.exec(issue)
      return matched ? [matched[1]] : []
    }),
  )
  if (invalidClaimKeys.size === 0) return citableFacts

  const requiredFactIds = new Set(
    draft.claims.filter((claim) => invalidClaimKeys.has(claim.claimKey)).flatMap((claim) => claim.factIds),
  )
  const focusedFacts = citableFacts.filter((fact) => requiredFactIds.has(fact.factId))
  return focusedFacts.length > 0 ? focusedFacts : citableFacts
}
