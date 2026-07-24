import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

export interface AgentJournalDraft {
  tsCode: string | null
  title: string
  evidence: string
  thesis: string | null
  risks: string[]
  decision: string | null
  outcome: string | null
  reviewAt: Date | null
}

@Injectable()
export class ResearchNoteAgentFacade {
  async createForResearchReport(
    tx: Prisma.TransactionClient,
    userId: number,
    sourceRunId: string,
    sourceReportId: string,
    draft: AgentJournalDraft,
  ) {
    const activeCount = await tx.researchNote.count({ where: { userId, deletedAt: null } })
    if (activeCount >= 500) throw new BadRequestException('笔记数量已达上限（最多 500 条）')
    return tx.researchNote.create({
      data: {
        userId,
        tsCode: draft.tsCode,
        title: draft.title,
        content: draft.evidence,
        tags: ['agent-report'],
        wordCount: draft.evidence.length,
        sourceRunId,
        sourceReportId,
        thesis: draft.thesis,
        risks: draft.risks as Prisma.InputJsonValue,
        decision: draft.decision,
        outcome: draft.outcome,
        reviewAt: draft.reviewAt,
      },
    })
  }
}
