import { Inject, Injectable, OnModuleInit } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { AgentReportConfig, buildAgentReportConfig, type IAgentReportConfig } from 'src/config/agent-report.config'
import { ResearchReportService } from 'src/apps/agent/research/research-report.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import { AGENT_RESEARCH_REPORT_RECONCILER_INTERVAL_NAME } from './agent.queue.constants'
import { AgentResearchReportQueueService } from './agent-research-report-queue.service'

const options = buildAgentReportConfig(process.env)

@Injectable()
export class AgentResearchReportReconcilerService implements OnModuleInit {
  private running = false

  constructor(
    private readonly reports: ResearchReportService,
    private readonly queue: AgentResearchReportQueueService,
    @Inject(AgentReportConfig.KEY) private readonly config: IAgentReportConfig,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    void this.publishDueReports()
  }

  @Interval(AGENT_RESEARCH_REPORT_RECONCILER_INTERVAL_NAME, options.reconcileIntervalMs)
  async publishDueReports(): Promise<number> {
    if (this.running) return 0
    this.running = true
    try {
      const [renderIds, cleanupIds] = await Promise.all([
        this.reports.publishableReportIds(this.config.reconcileBatchSize),
        this.reports.cleanupReportIds(this.config.reconcileBatchSize),
      ])
      let published = 0
      for (const reportId of renderIds) {
        try {
          await this.queue.enqueueRender(reportId)
          published += 1
        } catch {
          this.logger.warn(
            { operation: 'agentResearchReportReconciler.enqueueRender', reportId },
            AgentResearchReportReconcilerService.name,
          )
        }
      }
      for (const reportId of cleanupIds) {
        try {
          await this.queue.enqueueCleanup(reportId)
          published += 1
        } catch {
          this.logger.warn(
            { operation: 'agentResearchReportReconciler.enqueueCleanup', reportId },
            AgentResearchReportReconcilerService.name,
          )
        }
      }
      return published
    } finally {
      this.running = false
    }
  }
}
