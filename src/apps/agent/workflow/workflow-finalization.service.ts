import { Injectable } from '@nestjs/common'
import { hashStableJson } from '../tools/tool-json'
import type {
  FactPacket,
  FinalAnswerDraft,
  LoadedWorkflowContext,
  WorkflowBudgetUsage,
  WorkflowCitationDraft,
  WorkflowFinalization,
} from './workflow.types'

@Injectable()
export class WorkflowFinalizationService {
  build(command: {
    runId: string
    context: LoadedWorkflowContext
    draft: FinalAnswerDraft
    facts: readonly FactPacket[]
    warnings: readonly string[]
    usage: WorkflowBudgetUsage
    modelName: string | null
  }): WorkflowFinalization {
    const blockId = `answer_${hashStableJson(command.runId).slice(0, 16)}`
    const factsById = new Map(command.facts.map((fact) => [fact.factId, fact]))
    const citations: WorkflowCitationDraft[] = []

    for (const claim of command.draft.claims) {
      for (const factId of claim.factIds) {
        const fact = factsById.get(factId)
        if (!fact) continue
        if (fact.sourceIds.length > 0) {
          for (const sourceId of fact.sourceIds) {
            citations.push(
              citationDraft(command.runId, blockId, claim.claimKey, fact, {
                searchSourceId: sourceId,
              }),
            )
          }
        } else {
          citations.push(
            citationDraft(command.runId, blockId, claim.claimKey, fact, {
              toolCallId: fact.toolCallId,
              sourceType: fact.sourceType,
              sourceTitle: fact.title,
            }),
          )
        }
      }
    }

    const citationIds = citations.map((citation) => citation.publicId)
    const retrievedAt = latestRetrievedAt(command.facts)
    const warnings = [...new Set([...command.warnings, ...command.draft.warnings])]
    const text =
      warnings.length > 0 ? `${command.draft.markdown}\n\n> 数据限制：${warnings.join('；')}` : command.draft.markdown
    return {
      contentText: text,
      contentBlocks: [
        {
          blockId,
          schemaVersion: 1,
          type: 'MARKDOWN',
          text,
          ...(citationIds.length > 0
            ? {
                provenance: {
                  sourceType: 'MODEL_INFERENCE',
                  citationIds,
                  asOf: { retrievedAt },
                  timezone: command.facts[0]?.timezone ?? 'Asia/Shanghai',
                  qualityFlags: warnings.map((_, index) => `WORKFLOW_WARNING_${index + 1}`),
                },
              }
            : {}),
        },
      ],
      citations,
      modelName: command.modelName,
      tokenCount: command.usage.outputTokens,
      dataCutoff: command.draft.dataCutoff,
    }
  }
}

function citationDraft(
  runId: string,
  blockId: string,
  claimKey: string,
  fact: FactPacket,
  source: Pick<WorkflowCitationDraft, 'searchSourceId' | 'toolCallId' | 'sourceType' | 'sourceTitle'>,
): WorkflowCitationDraft {
  const sourceKey = source.searchSourceId ?? source.toolCallId ?? fact.factId
  return {
    publicId: `cit_${hashStableJson({ runId, claimKey, factId: fact.factId, sourceKey }).slice(0, 24)}`,
    blockId,
    claimKey,
    conclusionLevel: fact.sourceType === 'PROGRAM_CALCULATION' ? 'PROGRAM_CALCULATION' : 'FACT',
    locator: { factId: fact.factId },
    retrievedAt: fact.retrievedAt,
    ...source,
  }
}

function latestRetrievedAt(facts: readonly FactPacket[]): string {
  const timestamps = facts.map((fact) => Date.parse(fact.retrievedAt)).filter((value) => Number.isFinite(value))
  return new Date(timestamps.length > 0 ? Math.max(...timestamps) : Date.now()).toISOString()
}
