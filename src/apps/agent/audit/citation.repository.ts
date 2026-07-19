import { Injectable } from '@nestjs/common'
import {
  AiConclusionLevel,
  AiSearchFetchStatus,
  AiSourceType,
  AiToolCallStatus,
  Prisma,
  type AiCitation,
  type AiSearchSource,
} from '@prisma/client'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { AgentAuditConflictError, AgentAuditNotFoundError, AgentAuditValidationError } from './agent-audit.repository'
import {
  canonicalJson,
  canonicalizeExternalUrl,
  sanitizeAndHashAuditPayload,
  sha256,
  type AuditJsonValue,
} from './agent-audit-sanitizer'

export interface CreateSearchSourceCommand {
  firstSeenUserId: number
  firstSeenRunId?: string | null
  sourceType: AiSourceType
  url: string
  canonicalizationVersion?: string
  title: string
  publisher?: string | null
  author?: string | null
  publishedAt?: Date | null
  fetchedAt: Date
  contentHash: string
  objectRef?: string | null
  mimeType?: string | null
  language?: string | null
  license?: string | null
  robotsStatus?: string | null
  fetchStatus?: AiSearchFetchStatus
  metadata?: unknown
}

interface BaseCitationInput {
  publicId?: string
  blockId: string
  claimKey: string
  conclusionLevel: AiConclusionLevel
  locator: unknown
  startOffset?: number | null
  endOffset?: number | null
  quote?: string | null
  retrievedAt?: Date | null
}

export type AttachCitationInput = BaseCitationInput & {
  searchSourceId?: string | null
  toolCallId?: string | null
  sourceType?: AiSourceType
  sourceTitle?: string
}

@Injectable()
export class CitationRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async createSearchSource(command: CreateSearchSourceCommand): Promise<AiSearchSource> {
    const startedAt = Date.now()
    const canonicalUrl = canonicalizeExternalUrl(command.url)
    const canonicalUrlHash = sha256(canonicalUrl)
    const contentHash = requireHash(command.contentHash, 'contentHash')
    const metadata = sanitizeObject(command.metadata ?? {}, 'metadata')
    const canonicalizationVersion = requireText(
      command.canonicalizationVersion ?? 'url-v1',
      'canonicalizationVersion',
      40,
    )

    try {
      const source = await this.prisma.aiSearchSource.create({
        data: {
          firstSeenUserId: command.firstSeenUserId,
          firstSeenRunId: optionalText(command.firstSeenRunId, 32),
          sourceType: command.sourceType,
          canonicalUrl,
          canonicalUrlHash,
          canonicalizationVersion,
          title: requireText(command.title, 'title', 1_000),
          publisher: optionalText(command.publisher, 500),
          author: optionalText(command.author, 500),
          publishedAt: command.publishedAt ?? null,
          fetchedAt: command.fetchedAt,
          contentHash,
          objectRef: optionalText(command.objectRef, 500),
          mimeType: optionalText(command.mimeType, 128),
          language: optionalText(command.language, 32),
          license: optionalText(command.license, 200),
          robotsStatus: optionalText(command.robotsStatus, 32),
          fetchStatus: command.fetchStatus ?? AiSearchFetchStatus.METADATA_ONLY,
          metadata: toJsonInput(metadata),
        },
      })
      this.logOperation('createSearchSource', startedAt, 1)
      return source
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const existing = await this.prisma.aiSearchSource.findFirst({
        where: { canonicalUrlHash, contentHash },
      })
      if (!existing) throw error
      this.logOperation('createSearchSource', startedAt, 0)
      return existing
    }
  }

  async attachCitations(userId: number, messageId: string, citations: AttachCitationInput[]): Promise<AiCitation[]> {
    const startedAt = Date.now()
    if (citations.length === 0) return []
    if (citations.length > 100) throw new AgentAuditValidationError('单次最多附加 100 条引用')

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.aiMessage.findFirst({ where: { id: messageId, userId }, select: { id: true } })
      if (!message) throw new AgentAuditNotFoundError('消息')

      const prepared: Prisma.AiCitationCreateManyInput[] = []
      for (const citation of citations) {
        prepared.push(await prepareCitationInTransaction(tx, userId, messageId, citation))
      }

      await tx.aiCitation.createMany({ data: prepared, skipDuplicates: true })
      const rows = await tx.aiCitation.findMany({
        where: { userId, messageId, citationKeyHash: { in: prepared.map((item) => item.citationKeyHash) } },
        orderBy: { id: 'asc' },
      })
      if (rows.length !== prepared.length) throw new AgentAuditConflictError('引用幂等写入结果不完整')

      const byHash = new Map(rows.map((row) => [row.citationKeyHash, row]))
      for (const expected of prepared) {
        const stored = byHash.get(expected.citationKeyHash)
        if (!stored || !sameCitation(stored, expected)) {
          throw new AgentAuditConflictError('引用幂等键已被不同证据占用')
        }
      }
      this.logOperation('attachCitations', startedAt, rows.length)
      return rows
    })
  }

  async listCitationsForMessage(userId: number, messageId: string): Promise<AiCitation[]> {
    const startedAt = Date.now()
    const message = await this.prisma.aiMessage.findFirst({ where: { id: messageId, userId }, select: { id: true } })
    if (!message) throw new AgentAuditNotFoundError('消息')
    const rows = await this.prisma.aiCitation.findMany({
      where: { userId, messageId },
      orderBy: { id: 'asc' },
    })
    this.logOperation('listCitationsForMessage', startedAt, rows.length)
    return rows
  }

  async findSearchSourceById(sourceId: string): Promise<AiSearchSource> {
    const source = await this.prisma.aiSearchSource.findUnique({ where: { id: sourceId.trim() } })
    if (!source) throw new AgentAuditNotFoundError('搜索来源')
    return source
  }

  private logOperation(operation: string, startedAt: number, rowCount: number): void {
    this.logger.log({ operation, durationMs: Date.now() - startedAt, rowCount }, CitationRepository.name)
  }
}

export async function prepareCitationInTransaction(
  tx: Prisma.TransactionClient,
  userId: number,
  messageId: string,
  citation: AttachCitationInput,
): Promise<Prisma.AiCitationCreateManyInput> {
  const hasSearchSource = Boolean(citation.searchSourceId)
  const hasToolCall = Boolean(citation.toolCallId)
  if (hasSearchSource === hasToolCall) throw new AgentAuditValidationError('引用必须且只能指定一个证据源')
  validateOffsets(citation.startOffset, citation.endOffset)
  const locator = sanitizeObject(citation.locator, 'locator')
  if (Object.keys(locator).length === 0) throw new AgentAuditValidationError('locator 不能为空')
  const blockId = requireText(citation.blockId, 'blockId', 128)
  const claimKey = requireText(citation.claimKey, 'claimKey', 128)
  const quoteHash = citation.quote?.trim() ? sha256(citation.quote) : null

  let searchSourceId: string | null = null
  let toolCallId: string | null = null
  let sourceType: AiSourceType
  let sourceTitle: string
  let canonicalUrl: string | null
  let publisher: string | null
  let sourcePublishedAt: Date | null
  let retrievedAt: Date
  let contentHash: string

  if (citation.searchSourceId) {
    const source = await tx.aiSearchSource.findUnique({ where: { id: citation.searchSourceId } })
    if (!source) throw new AgentAuditNotFoundError('搜索来源')
    searchSourceId = source.id
    sourceType = source.sourceType
    sourceTitle = source.title
    canonicalUrl = source.canonicalUrl
    publisher = source.publisher
    sourcePublishedAt = source.publishedAt
    retrievedAt = citation.retrievedAt ?? source.fetchedAt
    contentHash = source.contentHash
  } else {
    const toolCall = await tx.aiToolCall.findFirst({
      where: { id: citation.toolCallId!, userId, status: AiToolCallStatus.SUCCEEDED },
    })
    if (!toolCall?.outputHash) throw new AgentAuditNotFoundError('已成功 Tool 调用')
    toolCallId = toolCall.id
    sourceType = citation.sourceType ?? AiSourceType.DATABASE
    sourceTitle = requireText(citation.sourceTitle ?? toolCall.toolName, 'sourceTitle', 1_000)
    canonicalUrl = null
    publisher = null
    sourcePublishedAt = null
    retrievedAt = citation.retrievedAt ?? toolCall.finishedAt ?? toolCall.startedAt
    contentHash = toolCall.outputHash
  }

  const citationKeyHash = sha256(
    canonicalJson({
      blockId,
      claimKey,
      conclusionLevel: citation.conclusionLevel,
      contentHash,
      endOffset: citation.endOffset ?? null,
      locator,
      quoteHash,
      searchSourceId,
      sourceTitle,
      sourceType,
      startOffset: citation.startOffset ?? null,
      toolCallId,
    }),
  )

  return {
    ...(citation.publicId ? { publicId: requireText(citation.publicId, 'publicId', 32) } : {}),
    userId,
    messageId,
    blockId,
    claimKey,
    conclusionLevel: citation.conclusionLevel,
    sourceType,
    searchSourceId,
    toolCallId,
    sourceTitle,
    canonicalUrl,
    publisher,
    sourcePublishedAt,
    retrievedAt,
    locator: toJsonInput(locator),
    startOffset: citation.startOffset ?? null,
    endOffset: citation.endOffset ?? null,
    contentHash,
    quoteHash,
    citationKeyHash,
  }
}

function sameCitation(stored: AiCitation, expected: Prisma.AiCitationCreateManyInput): boolean {
  return (
    stored.userId === expected.userId &&
    stored.messageId === expected.messageId &&
    stored.blockId === expected.blockId &&
    stored.claimKey === expected.claimKey &&
    stored.conclusionLevel === expected.conclusionLevel &&
    stored.sourceType === expected.sourceType &&
    stored.searchSourceId === expected.searchSourceId &&
    stored.toolCallId === expected.toolCallId &&
    stored.sourceTitle === expected.sourceTitle &&
    stored.canonicalUrl === expected.canonicalUrl &&
    stored.publisher === expected.publisher &&
    dateMillis(stored.sourcePublishedAt) === dateMillis(expected.sourcePublishedAt) &&
    dateMillis(stored.retrievedAt) === dateMillis(expected.retrievedAt) &&
    stored.contentHash === expected.contentHash &&
    stored.quoteHash === expected.quoteHash &&
    stored.startOffset === expected.startOffset &&
    stored.endOffset === expected.endOffset &&
    sanitizeAndHashAuditPayload(stored.locator).hash === sanitizeAndHashAuditPayload(expected.locator).hash
  )
}

function dateMillis(value: string | Date | null | undefined): number | null {
  return value == null ? null : new Date(value).getTime()
}

function sanitizeObject(value: unknown, name: string): { [key: string]: AuditJsonValue } {
  const sanitized = sanitizeAndHashAuditPayload(value).summary
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== 'object') {
    throw new AgentAuditValidationError(`${name} 必须为 JSON object`)
  }
  return sanitized
}

function validateOffsets(startOffset: number | null | undefined, endOffset: number | null | undefined): void {
  if (startOffset == null && endOffset == null) return
  if (
    startOffset == null ||
    endOffset == null ||
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset
  ) {
    throw new AgentAuditValidationError('offset 必须同时为空，或满足 0 <= startOffset < endOffset')
  }
}

function requireHash(value: string, name: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new AgentAuditValidationError(`${name} 必须为 SHA-256 hex`)
  return normalized
}

function requireText(value: string, name: string, maxLength: number): string {
  const normalized = value.trim()
  if (!normalized) throw new AgentAuditValidationError(`${name} 不能为空`)
  if (normalized.length > maxLength) throw new AgentAuditValidationError(`${name} 超过 ${maxLength} 字符`)
  return normalized
}

function optionalText(value: string | null | undefined, maxLength: number): string | null {
  if (value == null) return null
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > maxLength) throw new AgentAuditValidationError(`字段超过 ${maxLength} 字符`)
  return normalized
}

function toJsonInput(value: AuditJsonValue): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function isUniqueConstraintError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
