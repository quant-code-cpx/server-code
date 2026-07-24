import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import { AiAgentRunStatus, AiMessageStatus, AiResearchReportStatus, Prisma } from '@prisma/client'
import { ResearchNoteAgentFacade, type AgentJournalDraft } from 'src/apps/research-note/research-note-agent.facade'
import { AgentHttpException } from 'src/apps/agent/api/agent-http.exception'
import {
  type ListResearchReportsDto,
  type ResearchReportJournalDto,
  type SaveResearchReportDto,
} from 'src/apps/agent/api/dto/research/research-report-request.dto'
import { validateMessageBlocks, canonicalJson } from 'src/apps/agent/conversation/agent-conversation.utils'
import { AgentReportConfig, type IAgentReportConfig } from 'src/config/agent-report.config'
import { AgentResearchReportQueueService } from 'src/queue/agent/agent-research-report-queue.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { AGENT_REPORT_STORAGE, type ResearchReportStoragePort } from './storage.port'

const RENDERER_VERSION = 'agent-html-v1'
const STALE_RENDER_MS = 5 * 60_000

type ConfirmationClaims = {
  userId: number
  runId: string
  messageId: string
  messageVersion: number
  contentHash: string
  journalHash: string
  expiresAt: number
}

type ReportCitation = {
  citationId: string
  blockId: string
  claimKey: string
  title: string
  canonicalUrl: string | null
  retrievedAt: string
}

type PreparedReport = {
  runId: string
  conversationId: string
  messageId: string
  messageVersion: number
  title: string
  summary: string
  contentText: string | null
  contentBlocks: object[]
  citations: ReportCitation[]
  citationManifest: object[]
  manifest: object
  contentHash: string
  dataAsOf: Date | null
  journal: AgentJournalDraft | null
  journalHash: string
}

@Injectable()
export class ResearchReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journals: ResearchNoteAgentFacade,
    private readonly queue: AgentResearchReportQueueService,
    @Inject(AGENT_REPORT_STORAGE) private readonly storage: ResearchReportStoragePort,
    @Inject(AgentReportConfig.KEY) private readonly config: IAgentReportConfig,
    private readonly logger: LoggerService,
  ) {}

  async save(userId: number, dto: SaveResearchReportDto) {
    if (!dto.confirmationToken) {
      if (!dto.runId?.trim()) throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_INVALID', '预览报告必须提供 runId')
      const prepared = await this.prepare(userId, dto.runId, dto.journal)
      const expiresAt = new Date(Date.now() + this.config.confirmationTtlSeconds * 1_000)
      return {
        requiresConfirmation: true,
        preview: this.toPreview(prepared, expiresAt),
        confirmationToken: this.createConfirmationToken({
          userId,
          runId: prepared.runId,
          messageId: prepared.messageId,
          messageVersion: prepared.messageVersion,
          contentHash: prepared.contentHash,
          journalHash: prepared.journalHash,
          expiresAt: expiresAt.getTime(),
        }),
      }
    }

    const clientRequestId = dto.clientRequestId?.trim()
    if (!clientRequestId || clientRequestId.length > 128) {
      throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_INVALID', '确认保存必须提供 clientRequestId')
    }
    const claims = this.readConfirmationToken(dto.confirmationToken)
    if (claims.userId !== userId) throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_CONFIRMATION_INVALID')
    const prepared = await this.prepare(userId, claims.runId, dto.journal)
    if (
      prepared.messageId !== claims.messageId ||
      prepared.messageVersion !== claims.messageVersion ||
      prepared.contentHash !== claims.contentHash ||
      prepared.journalHash !== claims.journalHash
    ) {
      throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_CONFIRMATION_INVALID', '研究内容已变化，请重新预览确认')
    }

    const saved = await this.persist(userId, clientRequestId, prepared)
    if (saved.created) {
      try {
        await this.queue.enqueueRender(saved.report.id)
      } catch {
        this.logger.warn(
          { operation: 'agentResearchReport.enqueueRender', reportId: saved.report.id },
          ResearchReportService.name,
        )
      }
    }
    return { requiresConfirmation: false, report: this.toResponse(saved.report, saved.journalId) }
  }

  async list(userId: number, dto: ListResearchReportsDto) {
    const rows = await this.prisma.aiResearchReport.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.cursor ? { id: { lt: dto.cursor } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: dto.limit + 1,
      include: { journal: { select: { id: true } } },
    })
    const items = rows.slice(0, dto.limit)
    return {
      items: items.map((report) => this.toResponse(report, report.journal?.id ?? null)),
      nextCursor: rows.length > dto.limit ? (items.at(-1)?.id ?? null) : null,
    }
  }

  async detail(userId: number, reportId: string) {
    const report = await this.prisma.aiResearchReport.findFirst({
      where: { id: reportId, userId, deletedAt: null },
      include: { journal: { select: { id: true } } },
    })
    if (!report) throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_NOT_FOUND')
    return {
      ...this.toResponse(report, report.journal?.id ?? null),
      contentText: report.contentText,
      contentBlocks: report.contentBlocks,
      citations: report.citationManifest,
      manifest: report.manifest,
    }
  }

  async delete(userId: number, reportId: string) {
    const report = await this.prisma.aiResearchReport.findFirst({ where: { id: reportId, userId, deletedAt: null } })
    if (!report) throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_NOT_FOUND')
    const deletedAt = new Date()
    const result = await this.prisma.aiResearchReport.updateMany({
      where: { id: report.id, userId, deletedAt: null },
      data: { status: AiResearchReportStatus.DELETED, deletedAt, errorMessage: null },
    })
    if (result.count !== 1) throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_CONFLICT')
    const deleted = await this.prisma.aiResearchReport.findUniqueOrThrow({ where: { id: report.id } })
    if (deleted.storageKey && !deleted.storageDeletedAt) {
      try {
        await this.queue.enqueueCleanup(deleted.id)
      } catch {
        this.logger.warn(
          { operation: 'agentResearchReport.enqueueCleanup', reportId: deleted.id },
          ResearchReportService.name,
        )
      }
    }
    return this.toResponse(deleted, null)
  }

  async publishableReportIds(limit: number): Promise<string[]> {
    const staleBefore = new Date(Date.now() - STALE_RENDER_MS)
    await this.prisma.aiResearchReport.updateMany({
      where: { status: AiResearchReportStatus.GENERATING, updatedAt: { lte: staleBefore }, deletedAt: null },
      data: { status: AiResearchReportStatus.QUEUED, errorMessage: '上次渲染 lease 超时，已重新入队' },
    })
    const reports = await this.prisma.aiResearchReport.findMany({
      where: { status: AiResearchReportStatus.QUEUED, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    })
    return reports.map((report) => report.id)
  }

  async cleanupReportIds(limit: number): Promise<string[]> {
    const reports = await this.prisma.aiResearchReport.findMany({
      where: {
        status: AiResearchReportStatus.DELETED,
        storageKey: { not: null },
        storageDeletedAt: null,
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    })
    return reports.map((report) => report.id)
  }

  async render(reportId: string): Promise<'COMPLETED' | 'IGNORED' | 'DELETED' | 'FAILED'> {
    const claimed = await this.prisma.aiResearchReport.updateMany({
      where: { id: reportId, status: AiResearchReportStatus.QUEUED, deletedAt: null },
      data: {
        status: AiResearchReportStatus.GENERATING,
        renderAttempts: { increment: 1 },
        errorMessage: null,
      },
    })
    if (claimed.count !== 1) return 'IGNORED'
    const report = await this.prisma.aiResearchReport.findUniqueOrThrow({ where: { id: reportId } })
    const storageKey = reportStorageKey(report.userId, report.id, report.contentHash)
    let stored = false
    try {
      const artifact = await this.storage.put(storageKey, Buffer.from(renderHtml(report), 'utf8'))
      stored = true
      const completed = await this.prisma.aiResearchReport.updateMany({
        where: { id: report.id, status: AiResearchReportStatus.GENERATING, deletedAt: null },
        data: {
          status: AiResearchReportStatus.COMPLETED,
          storageKey: artifact.key,
          storageHash: artifact.hash,
          fileSize: artifact.size,
          renderedAt: new Date(),
          errorMessage: null,
        },
      })
      if (completed.count !== 1) {
        await this.storage.delete(storageKey)
        return 'DELETED'
      }
      return 'COMPLETED'
    } catch (error) {
      if (stored) await this.storage.delete(storageKey).catch(() => undefined)
      const message = safeErrorMessage(error)
      await this.prisma.aiResearchReport.updateMany({
        where: { id: report.id, status: AiResearchReportStatus.GENERATING, deletedAt: null },
        data: { status: AiResearchReportStatus.FAILED, errorMessage: message },
      })
      this.logger.warn(
        { operation: 'agentResearchReport.render', reportId: report.id, error: message },
        ResearchReportService.name,
      )
      return 'FAILED'
    }
  }

  async cleanup(reportId: string): Promise<'CLEANED' | 'IGNORED'> {
    const report = await this.prisma.aiResearchReport.findFirst({
      where: { id: reportId, status: AiResearchReportStatus.DELETED, storageDeletedAt: null },
    })
    if (!report?.storageKey) return 'IGNORED'
    try {
      await this.storage.delete(report.storageKey)
      await this.prisma.aiResearchReport.update({
        where: { id: report.id },
        data: { storageDeletedAt: new Date(), cleanupError: null, cleanupAttempts: { increment: 1 } },
      })
      return 'CLEANED'
    } catch (error) {
      const message = safeErrorMessage(error)
      await this.prisma.aiResearchReport.update({
        where: { id: report.id },
        data: { cleanupError: message, cleanupAttempts: { increment: 1 } },
      })
      throw error
    }
  }

  private async prepare(
    userId: number,
    runId: string,
    journalDto: ResearchReportJournalDto | undefined,
  ): Promise<PreparedReport> {
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(runId)) {
      throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_INVALID', 'runId 非法')
    }
    const run = await this.prisma.aiAgentRun.findFirst({
      where: { id: runId, userId, status: AiAgentRunStatus.COMPLETED },
      include: {
        conversation: { select: { title: true } },
        responseMessage: { include: { citations: { orderBy: { id: 'asc' } } } },
        toolCalls: { select: { dataThrough: true } },
      },
    })
    if (!run || run.responseMessage.status !== AiMessageStatus.COMPLETED) {
      throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_INVALID', '仅已完成的 Agent Run 可以保存为报告')
    }
    let contentBlocks: object[]
    try {
      contentBlocks = validateMessageBlocks(run.responseMessage.contentBlocks) as object[]
    } catch {
      throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_INVALID', '研究消息内容协议无效')
    }
    const citations = run.responseMessage.citations.map((citation) => ({
      citationId: citation.publicId,
      blockId: citation.blockId,
      claimKey: citation.claimKey,
      title: citation.sourceTitle,
      canonicalUrl: citation.canonicalUrl,
      retrievedAt: citation.retrievedAt.toISOString(),
    }))
    if (citations.length === 0) {
      throw AgentHttpException.fromKey('AI_CITATION_INVALID', '研究结果缺少可追溯引用，不能保存为报告')
    }
    const contentText = run.responseMessage.contentText?.trim() || null
    if (!contentText && contentBlocks.length === 0) {
      throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_INVALID', '研究结果没有可保存内容')
    }
    const title = truncate(firstLine(contentText) || run.conversation.title || 'Agent 研究报告', 200)
    const summary = truncate((contentText ?? '研究结果包含结构化内容，请在报告详情查看。').replace(/\s+/g, ' '), 1_000)
    const dataAsOf = latestDate(run.toolCalls.map((call) => call.dataThrough))
    const citationManifest = run.responseMessage.citations.map((citation) => ({
      citationId: citation.publicId,
      blockId: citation.blockId,
      claimKey: citation.claimKey,
      conclusionLevel: citation.conclusionLevel,
      sourceType: citation.sourceType,
      title: citation.sourceTitle,
      canonicalUrl: citation.canonicalUrl,
      publisher: citation.publisher,
      retrievedAt: citation.retrievedAt.toISOString(),
      contentHash: citation.contentHash,
      locator: citation.locator,
    }))
    const manifest = {
      sourceRunId: run.id,
      messageId: run.responseMessage.id,
      messageVersion: run.responseMessage.version,
      dataAsOf: dataAsOf?.toISOString().slice(0, 10) ?? null,
      citationIds: citations.map((citation) => citation.citationId),
      blockHashes: contentBlocks.map((block) => sha256(canonicalJson(block))),
      rendererVersion: RENDERER_VERSION,
    }
    const contentHash = sha256(
      canonicalJson({
        messageId: run.responseMessage.id,
        messageVersion: run.responseMessage.version,
        contentText,
        contentBlocks,
        citationManifest,
        manifest,
      }),
    )
    const journal = normalizeJournal(journalDto, title, summary)
    return {
      runId: run.id,
      conversationId: run.conversationId,
      messageId: run.responseMessage.id,
      messageVersion: run.responseMessage.version,
      title,
      summary,
      contentText,
      contentBlocks,
      citations,
      citationManifest,
      manifest,
      contentHash,
      dataAsOf,
      journal,
      journalHash: sha256(canonicalJson(journal)),
    }
  }

  private async persist(userId: number, clientRequestId: string, prepared: PreparedReport) {
    const existing = await this.prisma.aiResearchReport.findUnique({
      where: { userId_clientRequestId: { userId, clientRequestId } },
      include: { journal: { select: { id: true } } },
    })
    if (existing) {
      if (!samePreparedReport(existing, prepared)) throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_CONFLICT')
      return { report: existing, journalId: existing.journal?.id ?? null, created: false }
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const report = await tx.aiResearchReport.create({
          data: {
            userId,
            conversationId: prepared.conversationId,
            runId: prepared.runId,
            messageId: prepared.messageId,
            messageVersion: prepared.messageVersion,
            clientRequestId,
            version: 1,
            title: prepared.title,
            summary: prepared.summary,
            contentText: prepared.contentText,
            contentBlocks: prepared.contentBlocks as Prisma.InputJsonValue,
            citationManifest: prepared.citationManifest as Prisma.InputJsonValue,
            manifest: prepared.manifest as Prisma.InputJsonValue,
            contentHash: prepared.contentHash,
            dataAsOf: prepared.dataAsOf,
            rendererVersion: RENDERER_VERSION,
          },
        })
        const journal = prepared.journal
          ? await this.journals.createForResearchReport(tx, userId, prepared.runId, report.id, prepared.journal)
          : null
        return {
          report: { ...report, journal: journal ? { id: journal.id } : null },
          journalId: journal?.id ?? null,
          created: true,
        }
      })
    } catch (error) {
      if (!isUniqueConstraint(error)) throw error
      const raced = await this.prisma.aiResearchReport.findFirst({
        where: { userId, runId: prepared.runId, messageId: prepared.messageId, version: 1 },
        include: { journal: { select: { id: true } } },
      })
      if (raced && samePreparedReport(raced, prepared)) {
        return { report: raced, journalId: raced.journal?.id ?? null, created: false }
      }
      throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_CONFLICT')
    }
  }

  private toPreview(prepared: PreparedReport, expiresAt: Date) {
    return {
      runId: prepared.runId,
      messageId: prepared.messageId,
      messageVersion: prepared.messageVersion,
      title: prepared.title,
      summary: prepared.summary,
      dataAsOf: prepared.dataAsOf?.toISOString().slice(0, 10) ?? null,
      citations: prepared.citations,
      contentBlocks: prepared.contentBlocks,
      confirmationExpiresAt: expiresAt.toISOString(),
    }
  }

  private toResponse(
    report: {
      id: string
      runId: string
      conversationId: string
      messageId: string
      messageVersion: number
      version: number
      status: AiResearchReportStatus
      title: string
      summary: string
      dataAsOf: Date | null
      errorMessage: string | null
      createdAt: Date
      renderedAt: Date | null
      deletedAt: Date | null
    },
    journalId: number | null,
  ) {
    return {
      reportId: report.id,
      runId: report.runId,
      conversationId: report.conversationId,
      messageId: report.messageId,
      messageVersion: report.messageVersion,
      version: report.version,
      status: report.status,
      title: report.title,
      summary: report.summary,
      dataAsOf: report.dataAsOf?.toISOString().slice(0, 10) ?? null,
      journalId,
      errorMessage: report.errorMessage,
      createdAt: report.createdAt.toISOString(),
      renderedAt: report.renderedAt?.toISOString() ?? null,
      deletedAt: report.deletedAt?.toISOString() ?? null,
    }
  }

  private createConfirmationToken(claims: ConfirmationClaims): string {
    const encoded = Buffer.from(JSON.stringify(claims)).toString('base64url')
    const signature = createHmac('sha256', this.config.confirmationSecret).update(encoded).digest('base64url')
    return `${encoded}.${signature}`
  }

  private readConfirmationToken(token: string): ConfirmationClaims {
    const [encoded, signature, extra] = token.split('.')
    if (!encoded || !signature || extra) throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_CONFIRMATION_INVALID')
    const expected = createHmac('sha256', this.config.confirmationSecret).update(encoded).digest()
    let actual: Buffer
    try {
      actual = Buffer.from(signature, 'base64url')
    } catch {
      throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_CONFIRMATION_INVALID')
    }
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_CONFIRMATION_INVALID')
    }
    try {
      const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<ConfirmationClaims>
      if (
        !Number.isInteger(claims.userId) ||
        !isAgentId(claims.runId) ||
        !isAgentId(claims.messageId) ||
        !Number.isInteger(claims.messageVersion) ||
        !isHash(claims.contentHash) ||
        !isHash(claims.journalHash) ||
        !Number.isSafeInteger(claims.expiresAt) ||
        claims.expiresAt <= Date.now()
      ) {
        throw new Error('invalid')
      }
      return claims as ConfirmationClaims
    } catch {
      throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_CONFIRMATION_INVALID')
    }
  }
}

function normalizeJournal(
  dto: ResearchReportJournalDto | undefined,
  reportTitle: string,
  summary: string,
): AgentJournalDraft | null {
  if (!dto) return null
  const tsCode = normalizeText(dto.tsCode, 16)
  if (tsCode && !/^\d{6}\.(SH|SZ|BJ)$/.test(tsCode)) {
    throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_INVALID', '投资日志股票代码格式无效')
  }
  const thesis = normalizeText(dto.thesis, 4_000)
  const decision = normalizeText(dto.decision, 4_000)
  const outcome = normalizeText(dto.outcome, 4_000)
  const risks = [...new Set((dto.risks ?? []).map((risk) => normalizeText(risk, 500)).filter(Boolean) as string[])]
  const reviewAt = dto.reviewAt ? new Date(dto.reviewAt) : null
  if (reviewAt && Number.isNaN(reviewAt.getTime())) {
    throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_INVALID', '投资日志复盘时间无效')
  }
  if (!thesis && !decision && !outcome && risks.length === 0 && !reviewAt) return null
  return {
    tsCode,
    title: truncate(`${reportTitle} - 投资日志`, 100),
    evidence: truncate(summary, 10_000),
    thesis,
    risks,
    decision,
    outcome,
    reviewAt,
  }
}

function renderHtml(report: {
  title: string
  summary: string
  contentText: string | null
  contentBlocks: Prisma.JsonValue
  citationManifest: Prisma.JsonValue
  dataAsOf: Date | null
}) {
  const citationItems = Array.isArray(report.citationManifest)
    ? report.citationManifest
        .map((citation) => {
          const item = citation as Record<string, unknown>
          const title = escapeHtml(String(item.title ?? '未命名来源'))
          const url = typeof item.canonicalUrl === 'string' ? item.canonicalUrl : null
          return `<li>${url ? `<a href="${escapeAttribute(url)}" rel="noreferrer">${title}</a>` : title}</li>`
        })
        .join('')
    : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(report.title)}</title><style>body{max-width:900px;margin:40px auto;padding:0 24px;color:#18212f;font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}h1{font-size:28px}pre{white-space:pre-wrap;background:#f4f6f8;padding:16px;border-radius:6px;overflow-wrap:anywhere}small{color:#5c6775}a{color:#0057b8}</style></head><body><h1>${escapeHtml(report.title)}</h1><small>数据截止：${escapeHtml(report.dataAsOf?.toISOString().slice(0, 10) ?? '未标注')}</small><h2>摘要</h2><p>${escapeHtml(report.summary)}</p>${report.contentText ? `<h2>研究正文</h2><pre>${escapeHtml(report.contentText)}</pre>` : ''}<h2>结构化内容</h2><pre>${escapeHtml(canonicalJson(report.contentBlocks))}</pre><h2>引用</h2><ol>${citationItems}</ol></body></html>`
}

function samePreparedReport(
  report: { runId: string; messageId: string; contentHash: string },
  prepared: PreparedReport,
): boolean {
  return (
    report.runId === prepared.runId &&
    report.messageId === prepared.messageId &&
    report.contentHash === prepared.contentHash
  )
}

function reportStorageKey(userId: number, reportId: string, contentHash: string): string {
  return `reports/${userId}/${reportId}/${sha256(`${reportId}:${contentHash}`)}.html`
}

function latestDate(values: Array<Date | null>): Date | null {
  return values.reduce<Date | null>((latest, value) => (!value || (latest && latest >= value) ? latest : value), null)
}

function firstLine(value: string | null): string {
  return value?.split(/\r?\n/, 1)[0].trim() ?? ''
}

function truncate(value: string, maximum: number): string {
  return value.length > maximum ? value.slice(0, maximum) : value
}

function normalizeText(value: string | undefined, maximum: number): string | null {
  if (value === undefined) return null
  const normalized = value.trim()
  if (normalized.length > maximum) throw AgentHttpException.fromKey('AI_RESEARCH_REPORT_INVALID')
  return normalized || null
}

function isAgentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value)
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function safeErrorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : '报告渲染或存储失败'
  return truncate(value, 1_000)
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return escapeHtml(url.toString())
  } catch {
    return ''
  }
}
