import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { AiJobOutboxStatus } from '@prisma/client'
import type { Job } from 'bullmq'
import { AgentOrchestratorService } from 'src/apps/agent/orchestrator/agent-orchestrator.service'
import { AgentQueueConfig, type IAgentQueueConfig } from 'src/config/agent-queue.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { PrismaService } from 'src/shared/prisma.service'
import { AgentProcessor, type AgentJobResult } from 'src/queue/agent/agent.processor'
import { createAgentJob, type AgentJob } from 'src/queue/agent/agent-job.interface'
import { AGENT_RUN_JOB_NAME } from 'src/queue/agent/agent.queue.constants'

@Injectable()
export class InlineAgentQueueService implements OnModuleDestroy {
  private readonly processor: AgentProcessor
  private readonly pending = new Map<string, Promise<AgentJobResult>>()
  private readonly failures = new Map<string, unknown>()

  constructor(
    orchestrator: AgentOrchestratorService,
    @Inject(AgentQueueConfig.KEY) config: IAgentQueueConfig,
    logger: LoggerService,
    private readonly prisma: PrismaService,
  ) {
    this.processor = new AgentProcessor(orchestrator, config, logger)
  }

  async enqueueRun(runId: string) {
    if (this.pending.has(runId)) return { runId, jobId: runId, state: 'existing' as const }
    const publishedAt = new Date()
    const published = await this.prisma.aiJobOutbox.updateMany({
      where: { aggregateId: runId, status: { in: [AiJobOutboxStatus.PENDING, AiJobOutboxStatus.RETRY] } },
      data: {
        status: AiJobOutboxStatus.PUBLISHED,
        attempt: { increment: 1 },
        publishedAt,
        nextAttemptAt: publishedAt,
        lastError: null,
      },
    })
    if (published.count !== 1) throw new Error('Inline Agent queue 未找到可发布 Outbox intent')
    const job = {
      id: runId,
      name: AGENT_RUN_JOB_NAME,
      data: createAgentJob(runId),
      attemptsMade: 0,
      attemptsStarted: 1,
    } as Job<AgentJob>
    const execution = new Promise<void>((resolve) => setImmediate(resolve)).then(() => this.processor.process(job))
    this.pending.set(runId, execution)
    void execution.catch((error) => this.failures.set(runId, error))
    return { runId, jobId: runId, state: 'enqueued' as const }
  }

  async removeWaitingRun(): Promise<boolean> {
    return false
  }

  async wait(runId: string): Promise<void> {
    await this.pending.get(runId)
    const error = this.failures.get(runId)
    if (error) throw error
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled(this.pending.values())
    this.processor.onApplicationShutdown('test teardown')
  }
}
