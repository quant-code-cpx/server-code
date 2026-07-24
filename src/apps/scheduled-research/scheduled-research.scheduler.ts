import { randomUUID } from 'node:crypto'
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { AgentSchedulerConfig, type IAgentSchedulerConfig } from 'src/config/agent-scheduler.config'
import { ProcessRoleConfig, type IProcessRoleConfig } from 'src/config/process-role.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { ScheduledResearchService } from './scheduled-research.service'

@Injectable()
export class ScheduledResearchScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly owner = `scheduled-research:${process.pid}:${randomUUID()}`
  private timer: NodeJS.Timeout | null = null
  private ticking = false

  constructor(
    private readonly schedules: ScheduledResearchService,
    @Inject(AgentSchedulerConfig.KEY) private readonly config: IAgentSchedulerConfig,
    @Inject(ProcessRoleConfig.KEY) private readonly processRole: IProcessRoleConfig,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled || !this.processRole.schedulerEnabled) return
    void this.tick()
    this.timer = setInterval(() => void this.tick(), this.config.pollMs)
    this.timer.unref()
    this.logger.log(
      { operation: 'scheduledResearch.scanner.start', owner: this.owner, pollMs: this.config.pollMs },
      ScheduledResearchScheduler.name,
    )
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async tick(now = new Date()): Promise<number> {
    if (this.ticking) return 0
    this.ticking = true
    try {
      return await this.schedules.scanDue(now, this.owner)
    } catch (error) {
      this.logger.error(
        { operation: 'scheduledResearch.scanner.tick', error: safeErrorMessage(error) },
        ScheduledResearchScheduler.name,
      )
      return 0
    } finally {
      this.ticking = false
    }
  }
}

function safeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\r\n\t]+/g, ' ').slice(0, 1_000)
}
