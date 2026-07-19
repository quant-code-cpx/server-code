import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { InjectMetric } from '@willsoto/nestjs-prometheus'
import { Prisma } from '@prisma/client'
import type { Counter } from 'prom-client'
import { AgentQueueConfig, buildAgentQueueConfig, type IAgentQueueConfig } from 'src/config/agent-queue.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { AGENT_RUN_RECOVERY_TOTAL } from 'src/shared/metrics/metrics.constants'
import { PrismaService } from 'src/shared/prisma.service'
import { AgentQueueService } from './agent-queue.service'
import { AGENT_RECONCILER_INTERVAL_NAME } from './agent.queue.constants'

const reconcileOptions = buildAgentQueueConfig(process.env)

interface RecoverableRunRow {
  id: string
}

@Injectable()
export class AgentReconcilerService implements OnModuleInit {
  private running = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: AgentQueueService,
    @Inject(AgentQueueConfig.KEY) private readonly config: IAgentQueueConfig,
    private readonly logger: LoggerService,
    @Optional() @InjectMetric(AGENT_RUN_RECOVERY_TOTAL) private readonly recoveries?: Counter,
  ) {}

  onModuleInit(): void {
    void this.requeueRecoverableRuns()
  }

  @Interval(AGENT_RECONCILER_INTERVAL_NAME, reconcileOptions.reconcileIntervalMs)
  async requeueRecoverableRuns(): Promise<number> {
    if (this.running) return 0
    this.running = true
    try {
      await this.queue.publishDueOutbox(this.config.reconcileBatchSize)
      const rows = await this.prisma.$queryRaw<RecoverableRunRow[]>(Prisma.sql`
        SELECT "id"
        FROM "ai_agent_runs"
        WHERE "deadline_at" > clock_timestamp()
          AND "attempt" < "max_attempts"
          AND (
            "status" = 'QUEUED'
            OR (
              "status" IN ('RUNNING', 'CANCEL_REQUESTED')
              AND ("lease_expires_at" IS NULL OR "lease_expires_at" <= clock_timestamp())
            )
          )
        ORDER BY "queued_at" ASC, "id" ASC
        LIMIT ${this.config.reconcileBatchSize}
      `)
      let recovered = 0
      for (const row of rows) {
        try {
          const result = await this.queue.enqueueRun(row.id)
          recovered += result.state === 'enqueued' ? 1 : 0
          this.recoveries?.inc({ result: result.state })
        } catch (error) {
          this.recoveries?.inc({ result: 'failed' })
          this.logger.warn(
            {
              operation: 'agentReconciler.requeue',
              runId: row.id,
              error: error instanceof Error ? error.message : String(error),
            },
            AgentReconcilerService.name,
          )
        }
      }
      if (rows.length > 0) {
        this.logger.log(
          { operation: 'agentReconciler.requeue', candidates: rows.length, recovered },
          AgentReconcilerService.name,
        )
      }
      return recovered
    } finally {
      this.running = false
    }
  }
}
