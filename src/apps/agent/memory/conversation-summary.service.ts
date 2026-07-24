import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { canonicalJson, toJsonInput } from '../conversation/agent-conversation.utils'
import {
  ConversationSummaryRepository,
  type CreateConversationSummaryCommand,
  type PersistedConversationSummary,
} from './conversation-summary.repository'
import { AgentSummaryValidationError } from './memory-repository.errors'

export interface CommitConversationSummaryInput {
  expectedSummaryVersion: number
  fromMessageId: string
  throughMessageId: string
  summaryText: string
  facts: Prisma.InputJsonValue[]
  sourceMessageIds: string[]
  promptVersionId: string
  modelName: string
  sourceTokenCount: number
}

export interface ConversationSummaryMetadata {
  summaryId: string
  version: number
  fromMessageId: string
  throughMessageId: string
  promptVersionId: string
  modelName: string
  sourceTokenCount: number
  contentHash: string
  createdAt: string
}

@Injectable()
export class ConversationSummaryService {
  constructor(private readonly summaries: ConversationSummaryRepository) {}

  async commit(userId: number, conversationId: string, input: CommitConversationSummaryInput) {
    const summaryText = input.summaryText?.trim()
    if (!summaryText) throw new AgentSummaryValidationError('摘要正文不能为空')
    if (!Array.isArray(input.facts)) throw new AgentSummaryValidationError('facts 必须为数组')
    if (!Array.isArray(input.sourceMessageIds) || input.sourceMessageIds.length === 0) {
      throw new AgentSummaryValidationError('sourceMessageIds 必须为非空数组')
    }
    let facts: Prisma.InputJsonValue[]
    try {
      facts = toJsonInput(input.facts) as Prisma.InputJsonValue[]
    } catch {
      throw new AgentSummaryValidationError('facts 必须为可序列化 JSON')
    }
    const sourceMessageIds = [...input.sourceMessageIds]
    const contentHash = hashConversationSummaryContent({ facts, sourceMessageIds, summaryText })
    const command: CreateConversationSummaryCommand = {
      ...input,
      summaryText,
      facts,
      sourceMessageIds,
      contentHash,
    }
    return this.summaries.createAndAdvance(userId, conversationId, command)
  }

  async currentMetadata(userId: number, conversationId: string): Promise<ConversationSummaryMetadata | null> {
    const summary = await this.summaries.findCurrent(userId, conversationId)
    return summary ? mapSummaryMetadata(summary) : null
  }
}

export function hashConversationSummaryContent(content: {
  summaryText: string
  facts: unknown[]
  sourceMessageIds: string[]
}): string {
  return createHash('sha256').update(canonicalJson(content)).digest('hex')
}

export function isConversationSummaryContentValid(summary: PersistedConversationSummary): boolean {
  if (!summary.summaryText.trim() || !Array.isArray(summary.facts) || !Array.isArray(summary.sourceMessageIds)) {
    return false
  }
  if (!summary.sourceMessageIds.every((id) => typeof id === 'string')) return false
  return (
    hashConversationSummaryContent({
      facts: summary.facts as unknown[],
      sourceMessageIds: summary.sourceMessageIds as string[],
      summaryText: summary.summaryText,
    }) === summary.contentHash
  )
}

function mapSummaryMetadata(summary: PersistedConversationSummary): ConversationSummaryMetadata {
  return {
    summaryId: summary.id,
    version: summary.version,
    fromMessageId: summary.fromMessageId,
    throughMessageId: summary.throughMessageId,
    promptVersionId: summary.promptVersionId,
    modelName: summary.modelName,
    sourceTokenCount: summary.sourceTokenCount,
    contentHash: summary.contentHash,
    createdAt: summary.createdAt.toISOString(),
  }
}
