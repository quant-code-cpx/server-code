import { InjectQueue } from '@nestjs/bullmq'
import { Injectable } from '@nestjs/common'
import { Queue } from 'bullmq'
import {
  AGENT_RESEARCH_REPORT_JOB_NAME,
  AGENT_RESEARCH_REPORT_QUEUE,
  researchReportJobId,
} from './agent.queue.constants'

export type AgentResearchReportJobAction = 'RENDER' | 'CLEANUP'

export interface AgentResearchReportJob {
  reportId: string
  action: AgentResearchReportJobAction
}

@Injectable()
export class AgentResearchReportQueueService {
  constructor(@InjectQueue(AGENT_RESEARCH_REPORT_QUEUE) private readonly queue: Queue<AgentResearchReportJob>) {}

  enqueueRender(reportId: string): Promise<void> {
    return this.enqueue({ reportId, action: 'RENDER' })
  }

  enqueueCleanup(reportId: string): Promise<void> {
    return this.enqueue({ reportId, action: 'CLEANUP' })
  }

  private async enqueue(job: AgentResearchReportJob): Promise<void> {
    const jobId = researchReportJobId(job.reportId, job.action)
    const existing = await this.queue.getJob(jobId)
    if (existing) {
      const state = await existing.getState()
      if (!['completed', 'failed', 'unknown'].includes(state)) return
      await existing.remove()
    }
    await this.queue.add(AGENT_RESEARCH_REPORT_JOB_NAME, job, { jobId })
  }
}
