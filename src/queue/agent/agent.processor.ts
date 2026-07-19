import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { Inject, Injectable, OnApplicationShutdown, Optional } from '@nestjs/common'
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq'
import { InjectMetric } from '@willsoto/nestjs-prometheus'
import { Job, UnrecoverableError } from 'bullmq'
import type { Counter } from 'prom-client'
import { AgentOrchestratorService } from 'src/apps/agent/orchestrator/agent-orchestrator.service'
import type { WorkflowTerminalResult } from 'src/apps/agent/workflow/workflow.types'
import { AgentRunClaimError } from 'src/apps/agent/execution/agent-execution.errors'
import { AgentQueueConfig, buildAgentQueueConfig, type IAgentQueueConfig } from 'src/config/agent-queue.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { BULLMQ_STALLED_JOBS_TOTAL } from 'src/shared/metrics/metrics.constants'
import { parseAgentJob, type AgentJob } from './agent-job.interface'
import { AGENT_BULL_CONFIG_KEY, AGENT_EXECUTION_QUEUE, AGENT_RUN_JOB_NAME, agentJobId } from './agent.queue.constants'

const workerOptions = buildAgentQueueConfig(process.env)

export interface AgentJobIgnoredResult {
  status: 'IGNORED'
  runId: string
  reason: string
}

export type AgentJobResult = WorkflowTerminalResult | AgentJobIgnoredResult

@Injectable()
@Processor(
  { name: AGENT_EXECUTION_QUEUE, configKey: AGENT_BULL_CONFIG_KEY },
  {
    concurrency: workerOptions.workerConcurrency,
    lockDuration: 30_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
)
export class AgentProcessor extends WorkerHost implements OnApplicationShutdown {
  private readonly activeControllers = new Map<string, AbortController>()
  private shuttingDown = false

  constructor(
    private readonly orchestrator: AgentOrchestratorService,
    @Inject(AgentQueueConfig.KEY) private readonly config: IAgentQueueConfig,
    private readonly logger: LoggerService,
    @Optional() @InjectMetric(BULLMQ_STALLED_JOBS_TOTAL) private readonly stalledJobs?: Counter,
  ) {
    super()
  }

  async process(job: Job<AgentJob>): Promise<AgentJobResult> {
    if (this.shuttingDown) throw new Error('Agent Worker 正在关闭')
    if (job.name !== AGENT_RUN_JOB_NAME) throw new UnrecoverableError(`未知 Agent job name: ${job.name}`)

    let payload: AgentJob
    try {
      payload = parseAgentJob(job.data)
    } catch (error) {
      throw new UnrecoverableError(error instanceof Error ? error.message : 'Agent job payload 非法')
    }
    if (job.id !== agentJobId(payload.runId)) {
      throw new UnrecoverableError('Agent jobId 必须等于 runId')
    }

    const workerId = createWorkerIdentity(job)
    const activeKey = `${job.id}:${workerId}`
    const controller = new AbortController()
    this.activeControllers.set(activeKey, controller)
    const timeout = setTimeout(
      () => controller.abort(new Error(`Agent job 超过 ${this.config.jobTimeoutMs}ms`)),
      this.config.jobTimeoutMs,
    )
    timeout.unref?.()

    try {
      const result = await this.orchestrator.resume(payload.runId, { workerId, signal: controller.signal })
      this.logger.log(
        { operation: 'agentProcessor.process', runId: payload.runId, jobId: job.id, status: result.status },
        AgentProcessor.name,
      )
      return result
    } catch (error) {
      if (error instanceof AgentRunClaimError && !error.retryable) {
        return { status: 'IGNORED', runId: payload.runId, reason: error.reason }
      }
      throw error
    } finally {
      clearTimeout(timeout)
      this.activeControllers.delete(activeKey)
    }
  }

  onApplicationShutdown(signal?: string): void {
    this.shuttingDown = true
    const reason = new Error(`Agent Worker 收到关闭信号: ${signal ?? 'application shutdown'}`)
    for (const controller of this.activeControllers.values()) controller.abort(reason)
  }

  @OnWorkerEvent('stalled')
  onStalled(jobId: string): void {
    this.stalledJobs?.inc({ queue: AGENT_EXECUTION_QUEUE })
    this.logger.warn({ operation: 'agentProcessor.stalled', jobId }, AgentProcessor.name)
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AgentJob> | undefined, error: Error): void {
    this.logger.warn(
      { operation: 'agentProcessor.failed', jobId: job?.id ?? null, error: error.message },
      AgentProcessor.name,
    )
  }
}

export function createWorkerIdentity(job: Pick<Job, 'id' | 'attemptsMade' | 'attemptsStarted'>): string {
  const attempt = job.attemptsStarted || job.attemptsMade + 1
  return `${hostname()}:${process.pid}:${job.id ?? 'unknown'}:${attempt}:${randomUUID()}`.slice(0, 128)
}
