import { Inject, Injectable, Optional } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { InjectMetric } from '@willsoto/nestjs-prometheus'
import { AiAgentRunStatus, AiJobOutboxStatus } from '@prisma/client'
import { Job, Queue } from 'bullmq'
import type { Histogram } from 'prom-client'
import { AgentQueueConfig, type IAgentQueueConfig } from 'src/config/agent-queue.config'
import { BULLMQ_ENQUEUE_LAG } from 'src/shared/metrics/metrics.constants'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { createAgentJob, hashAgentJob, type AgentJob } from './agent-job.interface'
import { AGENT_EXECUTION_QUEUE, AGENT_JOB_OUTBOX_KIND, AGENT_RUN_JOB_NAME, agentJobId } from './agent.queue.constants'

const TERMINAL_RUN_STATUSES = new Set<AiAgentRunStatus>([
  AiAgentRunStatus.COMPLETED,
  AiAgentRunStatus.FAILED,
  AiAgentRunStatus.CANCELLED,
])

export interface AgentEnqueueResult {
  runId: string
  jobId: string
  state: 'enqueued' | 'existing'
}

export class AgentQueueRunNotRecoverableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = AgentQueueRunNotRecoverableError.name
  }
}

@Injectable()
export class AgentQueueService {
  constructor(
    @InjectQueue(AGENT_EXECUTION_QUEUE) private readonly queue: Queue<AgentJob>,
    private readonly prisma: PrismaService,
    @Inject(AgentQueueConfig.KEY) private readonly config: IAgentQueueConfig,
    private readonly logger: LoggerService,
    @Optional() @InjectMetric(BULLMQ_ENQUEUE_LAG) private readonly enqueueLag?: Histogram,
  ) {}

  async enqueueRun(runId: string): Promise<AgentEnqueueResult> {
    const job = createAgentJob(runId)
    const jobId = agentJobId(job.runId)
    const payloadHash = hashAgentJob(job)
    const run = await this.prisma.aiAgentRun.findUnique({
      where: { id: job.runId },
      select: { id: true, status: true, attempt: true, maxAttempts: true, deadlineAt: true },
    })
    if (!run) throw new AgentQueueRunNotRecoverableError('Agent Run 不存在')

    const outbox = await this.ensureOutbox(run.id, payloadHash)
    if (
      TERMINAL_RUN_STATUSES.has(run.status) ||
      run.deadlineAt.getTime() <= Date.now() ||
      run.attempt >= run.maxAttempts
    ) {
      await this.markDead(outbox.id, 'Agent Run 已终止、过期或达到最大领取次数')
      throw new AgentQueueRunNotRecoverableError('Agent Run 当前不可恢复入队')
    }

    const existing = await this.queue.getJob(jobId)
    if (existing) {
      const state = await existing.getState()
      if (!['completed', 'failed', 'unknown'].includes(state)) {
        await this.markPublished(outbox.id, outbox.createdAt)
        return { runId: run.id, jobId, state: 'existing' }
      }
      await this.removeFinishedJob(existing, state)
    }

    await this.prisma.aiJobOutbox.update({
      where: { id: outbox.id },
      data: { attempt: { increment: 1 }, nextAttemptAt: new Date() },
    })
    try {
      await this.queue.add(AGENT_RUN_JOB_NAME, job, { jobId })
      await this.markPublished(outbox.id, outbox.createdAt)
      this.logger.log(
        { operation: 'agentQueue.enqueue', runId: run.id, jobId, queue: AGENT_EXECUTION_QUEUE },
        AgentQueueService.name,
      )
      return { runId: run.id, jobId, state: 'enqueued' }
    } catch (error) {
      const message = safeErrorMessage(error)
      const attempt = outbox.attempt + 1
      const delayMs = Math.min(this.config.jobBackoffMs * 2 ** Math.max(0, attempt - 1), 300_000)
      await this.prisma.aiJobOutbox.update({
        where: { id: outbox.id },
        data: {
          status: AiJobOutboxStatus.RETRY,
          publishedAt: null,
          lastError: message,
          nextAttemptAt: new Date(Date.now() + delayMs),
        },
      })
      throw error
    }
  }

  async publishDueOutbox(limit = this.config.reconcileBatchSize): Promise<number> {
    const due = await this.prisma.aiJobOutbox.findMany({
      where: {
        kind: AGENT_JOB_OUTBOX_KIND,
        status: { in: [AiJobOutboxStatus.PENDING, AiJobOutboxStatus.RETRY] },
        nextAttemptAt: { lte: new Date() },
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { aggregateId: true },
    })
    let published = 0
    for (const intent of due) {
      try {
        await this.enqueueRun(intent.aggregateId)
        published += 1
      } catch (error) {
        this.logger.warn(
          { operation: 'agentQueue.publishOutbox', runId: intent.aggregateId, error: safeErrorMessage(error) },
          AgentQueueService.name,
        )
      }
    }
    return published
  }

  async removeWaitingRun(runId: string): Promise<boolean> {
    const job = await this.queue.getJob(agentJobId(createAgentJob(runId).runId))
    if (!job) return false
    const state = await job.getState()
    if (!['waiting', 'delayed', 'paused', 'prioritized', 'waiting-children'].includes(state)) return false
    await job.remove()
    return true
  }

  private async ensureOutbox(runId: string, payloadHash: string) {
    const outbox = await this.prisma.aiJobOutbox.upsert({
      where: { kind_aggregateId: { kind: AGENT_JOB_OUTBOX_KIND, aggregateId: runId } },
      create: { aggregateId: runId, kind: AGENT_JOB_OUTBOX_KIND, payloadHash },
      update: {},
    })
    if (outbox.payloadHash !== payloadHash) {
      throw new AgentQueueRunNotRecoverableError('Agent job payloadHash 与持久 intent 不一致')
    }
    return outbox
  }

  private async markPublished(outboxId: bigint, createdAt: Date): Promise<void> {
    const now = new Date()
    await this.prisma.aiJobOutbox.update({
      where: { id: outboxId },
      data: {
        status: AiJobOutboxStatus.PUBLISHED,
        publishedAt: now,
        nextAttemptAt: now,
        lastError: null,
      },
    })
    this.enqueueLag?.observe({ queue: AGENT_EXECUTION_QUEUE }, Math.max(0, now.getTime() - createdAt.getTime()) / 1_000)
  }

  private async markDead(outboxId: bigint, reason: string): Promise<void> {
    await this.prisma.aiJobOutbox.update({
      where: { id: outboxId },
      data: { status: AiJobOutboxStatus.DEAD, publishedAt: null, lastError: reason, nextAttemptAt: new Date() },
    })
  }

  private async removeFinishedJob(job: Job<AgentJob>, state: string): Promise<void> {
    try {
      await job.remove()
    } catch (error) {
      this.logger.warn(
        { operation: 'agentQueue.removeFinishedJob', jobId: job.id, state, error: safeErrorMessage(error) },
        AgentQueueService.name,
      )
      throw error
    }
  }
}

function safeErrorMessage(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error)
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 1_000)
}
