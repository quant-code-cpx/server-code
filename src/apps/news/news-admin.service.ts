import { Inject, Injectable } from '@nestjs/common'
import { NewsIngestionOperation, NewsIngestionRunStatus, NewsIngestionTrigger, Prisma } from '@prisma/client'
import { NewsConfig, type INewsConfig } from 'src/config/news.config'
import { PrismaService } from 'src/shared/prisma.service'
import { NewsQueueService, isUniqueViolation } from 'src/queue/news/news-queue.service'
import { AKSHARE_FEEDS, AKSHARE_PROVIDER_KEY } from './providers/akshare-news.provider'
import { commandRequestHash, newsIngestionPublicErrorMessage, NewsRepository } from './news.repository'
import { NewsHttpException } from './news.errors'
import type { NewsIngestionRunRequestDto } from './dto/news-request.dto'
import type {
  NewsIngestionRunResponseDto,
  NewsIngestionStatusResponseDto,
  NewsProviderListResponseDto,
} from './dto/news-response.dto'
import { NewsProviderRegistry } from './providers/news-provider.registry'
import { NewsCoverageService } from './news-coverage.service'
import { NewsCircuitBreakerService } from './news-circuit-breaker.service'
import { NEWS_CLOCK, type NewsClock } from './domain/news.types'

@Injectable()
export class NewsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: NewsQueueService,
    private readonly registry: NewsProviderRegistry,
    private readonly coverage: NewsCoverageService,
    private readonly circuit: NewsCircuitBreakerService,
    private readonly repository: NewsRepository,
    @Inject(NewsConfig.KEY) private readonly config: INewsConfig,
    @Inject(NEWS_CLOCK) private readonly clock: NewsClock,
  ) {}

  async run(userId: number, dto: NewsIngestionRunRequestDto): Promise<NewsIngestionRunResponseDto> {
    this.assertEnabled()
    const spec = this.validateAndNormalize(dto)
    const requestHash = commandRequestHash(spec)
    let command = await this.prisma.newsIngestionCommand.findUnique({
      where: { requestedByUserId_clientRequestId: { requestedByUserId: userId, clientRequestId: dto.clientRequestId } },
      include: { runs: { orderBy: [{ partitionKey: 'asc' }, { id: 'asc' }] } },
    })
    if (command) {
      if (command.requestHash !== requestHash) throw NewsHttpException.fromKey('NEWS_IDEMPOTENCY_CONFLICT')
      return runResponse(command, true)
    }

    try {
      command = await this.prisma.$transaction(async (tx) => {
        const created = await tx.newsIngestionCommand.create({
          data: {
            clientRequestId: dto.clientRequestId,
            requestHash,
            requestedByUserId: userId,
            operation: spec.operation,
            requestSpec: spec as Prisma.InputJsonValue,
            status: NewsIngestionRunStatus.QUEUED,
          },
        })
        const definitions =
          spec.operation === NewsIngestionOperation.POLL_FEED
            ? [{ providerKey: spec.providerKey!, feedKey: spec.feedKey!, partitionKey: 'default' }]
            : spec.securityCodes!.map((securityCode) => ({
                providerKey: AKSHARE_PROVIDER_KEY,
                feedKey: AKSHARE_FEEDS.NOTICE_BACKFILL,
                partitionKey: securityCode,
              }))
        await tx.newsIngestionRun.createMany({
          data: definitions.map((definition) => ({
            commandId: created.id,
            idempotencyKey: `manual:${created.id}:${definition.providerKey}:${definition.feedKey}:${definition.partitionKey}`,
            operation: spec.operation,
            ...definition,
            trigger: NewsIngestionTrigger.MANUAL,
            status: NewsIngestionRunStatus.QUEUED,
          })),
        })
        return tx.newsIngestionCommand.findUniqueOrThrow({
          where: { id: created.id },
          include: { runs: { orderBy: [{ partitionKey: 'asc' }, { id: 'asc' }] } },
        })
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      command = await this.prisma.newsIngestionCommand.findUnique({
        where: {
          requestedByUserId_clientRequestId: { requestedByUserId: userId, clientRequestId: dto.clientRequestId },
        },
        include: { runs: { orderBy: [{ partitionKey: 'asc' }, { id: 'asc' }] } },
      })
      if (!command || command.requestHash !== requestHash) throw NewsHttpException.fromKey('NEWS_IDEMPOTENCY_CONFLICT')
      return runResponse(command, true)
    }
    await this.enqueueCommandRuns(command)
    return runResponse(command, false)
  }

  async status(commandId: string): Promise<NewsIngestionStatusResponseDto> {
    this.assertEnabled()
    const command = await this.prisma.newsIngestionCommand.findUnique({
      where: { id: commandId },
      include: { runs: { orderBy: [{ partitionKey: 'asc' }, { id: 'asc' }] } },
    })
    if (!command) throw NewsHttpException.fromKey('NEWS_INGESTION_COMMAND_NOT_FOUND')
    return {
      commandId: command.id,
      clientRequestId: command.clientRequestId,
      operation: command.operation,
      status: command.status,
      acceptedAt: command.acceptedAt.toISOString(),
      startedAt: command.startedAt?.toISOString() ?? null,
      finishedAt: command.finishedAt?.toISOString() ?? null,
      runs: command.runs.map((run) => ({
        runId: run.id,
        providerKey: run.providerKey,
        feedKey: run.feedKey,
        partitionKey: run.partitionKey,
        status: run.status,
        fetchedCount: run.fetchedCount,
        insertedCount: run.insertedCount,
        revisedCount: run.revisedCount,
        duplicateCount: run.duplicateCount,
        quarantinedCount: run.quarantinedCount,
        potentiallyTruncated: run.potentiallyTruncated,
        dataThroughBefore: run.dataThroughBefore?.toISOString() ?? null,
        dataThroughAfter: run.dataThroughAfter?.toISOString() ?? null,
        errorCode: run.errorCode,
        errorMessage: newsIngestionPublicErrorMessage(run.errorCode),
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
      })),
    }
  }

  async providers(): Promise<NewsProviderListResponseDto> {
    this.assertEnabled()
    const coverage = await this.coverage.getCoverage()
    const grouped = new Map<string, typeof coverage.feeds>()
    for (const feed of coverage.feeds) grouped.set(feed.providerKey, [...(grouped.get(feed.providerKey) ?? []), feed])
    const providers = await Promise.all(
      [...grouped.entries()].map(async ([providerKey, feeds]) => ({
        providerKey,
        providerDisplayName: feeds[0]?.providerDisplayName ?? providerKey,
        enabled: feeds.some((feed) => feed.status !== 'DISABLED'),
        contractVersion: 'news-provider-v1',
        circuitState: await this.circuit.getState(providerKey),
        quotaStatus: 'UNKNOWN',
        quotaResetAt: null,
        feeds,
      })),
    )
    return { generatedAt: this.clock.now().toISOString(), providers }
  }

  private async enqueueCommandRuns(command: {
    id: string
    runs: Array<{ id: string; status: NewsIngestionRunStatus }>
  }): Promise<void> {
    const runIds = command.runs
      .filter((run) => run.status === NewsIngestionRunStatus.QUEUED || run.status === NewsIngestionRunStatus.FAILED)
      .map((run) => run.id)
    if (!runIds.length) return
    try {
      await this.queue.enqueueMany(runIds)
    } catch {
      await this.prisma.newsIngestionRun.updateMany({
        where: { commandId: command.id, status: NewsIngestionRunStatus.QUEUED },
        data: {
          status: NewsIngestionRunStatus.FAILED,
          errorCode: 'QUEUE_ENQUEUE_FAILED',
          errorMessage: '新闻采集任务入队失败',
          finishedAt: this.clock.now(),
        },
      })
      await this.repository.refreshCommandStatus(command.id)
      throw NewsHttpException.fromKey('NEWS_TEMPORARILY_UNAVAILABLE')
    }
  }

  private validateAndNormalize(dto: NewsIngestionRunRequestDto): NormalizedCommandSpec {
    if (dto.operation === 'POLL_FEED') {
      if (!dto.providerKey || !dto.feedKey || dto.securityCodes || dto.beginDate || dto.endDate) {
        throw NewsHttpException.fromKey('NEWS_PROVIDER_OR_FEED_NOT_FOUND', 'POLL_FEED 参数组合不合法')
      }
      this.registry.getProvider(dto.providerKey, dto.feedKey)
      return { operation: NewsIngestionOperation.POLL_FEED, providerKey: dto.providerKey, feedKey: dto.feedKey }
    }
    if (dto.providerKey || dto.feedKey || !dto.securityCodes?.length || !dto.beginDate || !dto.endDate) {
      throw NewsHttpException.fromKey('NEWS_DATE_RANGE_INVALID', 'BACKFILL_SECURITY_NOTICES 参数组合不合法')
    }
    const begin = parseDate(dto.beginDate)
    const end = parseDate(dto.endDate)
    if (begin > end) throw NewsHttpException.fromKey('NEWS_DATE_RANGE_INVALID')
    if (end.getTime() - begin.getTime() > 30 * 86_400_000) throw NewsHttpException.fromKey('NEWS_DATE_RANGE_TOO_LARGE')
    this.registry.getProvider(AKSHARE_PROVIDER_KEY, AKSHARE_FEEDS.NOTICE_BACKFILL)
    return {
      operation: NewsIngestionOperation.BACKFILL_SECURITY_NOTICES,
      securityCodes: [...dto.securityCodes].sort(),
      beginDate: dto.beginDate,
      endDate: dto.endDate,
    }
  }

  private assertEnabled(): void {
    if (!this.config.enabled) throw NewsHttpException.fromKey('NEWS_MODULE_DISABLED')
  }
}

type NormalizedCommandSpec = {
  operation: NewsIngestionOperation
  providerKey?: string
  feedKey?: string
  securityCodes?: string[]
  beginDate?: string
  endDate?: string
}

function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000+08:00`)
  if (Number.isNaN(parsed.getTime()) || parsed.toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) !== value) {
    throw NewsHttpException.fromKey('NEWS_DATE_RANGE_INVALID')
  }
  return parsed
}

function runResponse(
  command: {
    id: string
    status: NewsIngestionRunStatus
    acceptedAt: Date
    runs: Array<{ id: string }>
  },
  idempotentReplay: boolean,
): NewsIngestionRunResponseDto {
  return {
    commandId: command.id,
    runIds: command.runs.map((run) => run.id),
    status: command.status,
    idempotentReplay,
    acceptedAt: command.acceptedAt.toISOString(),
  }
}
