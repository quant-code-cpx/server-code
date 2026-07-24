import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { Job, UnrecoverableError } from 'bullmq'
import { ResearchReportService } from 'src/apps/agent/research/research-report.service'
import { LoggerService } from 'src/shared/logger/logger.service'
import {
  AGENT_BULL_CONFIG_KEY,
  AGENT_RESEARCH_REPORT_JOB_NAME,
  AGENT_RESEARCH_REPORT_QUEUE,
  researchReportJobId,
} from './agent.queue.constants'
import type { AgentResearchReportJob } from './agent-research-report-queue.service'

@Injectable()
@Processor(
  { name: AGENT_RESEARCH_REPORT_QUEUE, configKey: AGENT_BULL_CONFIG_KEY },
  { concurrency: 2, lockDuration: 60_000, stalledInterval: 30_000, maxStalledCount: 2 },
)
export class AgentResearchReportProcessor extends WorkerHost {
  constructor(
    private readonly reports: ResearchReportService,
    private readonly logger: LoggerService,
  ) {
    super()
  }

  async process(job: Job<AgentResearchReportJob>) {
    if (job.name !== AGENT_RESEARCH_REPORT_JOB_NAME) throw new UnrecoverableError('未知研究报告 job name')
    if (!job.data?.reportId || !job.data.action || job.id !== researchReportJobId(job.data.reportId, job.data.action)) {
      throw new UnrecoverableError('研究报告 job payload 或 jobId 非法')
    }
    const workerId = `${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 128)
    const result =
      job.data.action === 'RENDER'
        ? await this.reports.render(job.data.reportId)
        : await this.reports.cleanup(job.data.reportId)
    this.logger.log(
      {
        operation: 'agentResearchReportProcessor.process',
        reportId: job.data.reportId,
        action: job.data.action,
        workerId,
        result,
      },
      AgentResearchReportProcessor.name,
    )
    return result
  }
}
