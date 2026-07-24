import { Inject, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { AgentObservabilityConfig, type IAgentObservabilityConfig } from 'src/config/agent-observability.config'
import { LoggerService } from 'src/shared/logger/logger.service'
import { AgentMetricsService } from './agent-metrics.service'

export interface AgentTraceContext {
  traceId: string
  runId?: string
  workflow?: string
  node?: string
}

@Injectable()
export class AgentTracingService {
  constructor(
    @Inject(AgentObservabilityConfig.KEY) private readonly config: IAgentObservabilityConfig,
    private readonly metrics: AgentMetricsService,
    private readonly logger: LoggerService,
  ) {}

  async span<T>(name: string, context: AgentTraceContext, work: () => Promise<T>): Promise<T> {
    if (!this.shouldSample(name, context.traceId)) return work()
    const startedAt = Date.now()
    try {
      const result = await work()
      this.record(name, context, 'SUCCEEDED', startedAt)
      return result
    } catch (error) {
      this.record(name, context, 'FAILED', startedAt, error)
      throw error
    }
  }

  private shouldSample(name: string, traceId: string): boolean {
    if (!this.config.enabled || this.config.traceSampleRate <= 0) return false
    if (this.config.traceSampleRate >= 1) return true
    const bucket = createHash('sha256').update(`${traceId}:${name}`).digest()[0] / 255
    return bucket < this.config.traceSampleRate
  }

  private record(
    span: string,
    context: AgentTraceContext,
    status: 'SUCCEEDED' | 'FAILED',
    startedAt: number,
    error?: unknown,
  ): void {
    this.metrics.observeSpan(span, status)
    const event = {
      operation: 'agent.trace',
      span,
      traceId: context.traceId,
      runId: context.runId ?? null,
      workflow: context.workflow ?? null,
      node: context.node ?? null,
      status,
      durationMs: Date.now() - startedAt,
      errorClass: error instanceof Error ? error.name : undefined,
    }
    if (status === 'SUCCEEDED') this.logger.log(event, AgentTracingService.name)
    else this.logger.warn(event, AgentTracingService.name)
  }
}
