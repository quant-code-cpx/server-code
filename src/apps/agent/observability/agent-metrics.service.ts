import { Injectable } from '@nestjs/common'
import { InjectMetric } from '@willsoto/nestjs-prometheus'
import type { Counter, Gauge, Histogram } from 'prom-client'
import type { ModelGatewayMetricEvent, ModelGatewayObserver } from '../model-gateway/model-gateway.port'
import type { ToolExecutionObserver } from '../tools/contracts/tool-observer'
import {
  AGENT_MODEL_ATTEMPTS_TOTAL,
  AGENT_MODEL_COST_TOTAL,
  AGENT_MODEL_COST_UNKNOWN_TOTAL,
  AGENT_MODEL_DURATION,
  AGENT_MODEL_TOKENS_TOTAL,
  AGENT_MODEL_TTFT,
  AGENT_RUN_DURATION,
  AGENT_RUNS_TOTAL,
  AGENT_TOOL_ATTEMPTS_TOTAL,
  AGENT_TOOL_DATA_AGE,
  AGENT_TOOL_DURATION,
  AGENT_TOOL_RESULT_BYTES,
  AGENT_TRACE_SPANS_TOTAL,
  AGENT_WORKFLOW_NODE_DURATION,
} from 'src/shared/metrics/metrics.constants'

export type AgentCostSource = 'provider' | 'catalog'

@Injectable()
export class AgentMetricsService implements ModelGatewayObserver, ToolExecutionObserver {
  constructor(
    @InjectMetric(AGENT_RUNS_TOTAL) private readonly runs: Counter,
    @InjectMetric(AGENT_RUN_DURATION) private readonly runDuration: Histogram,
    @InjectMetric(AGENT_WORKFLOW_NODE_DURATION) private readonly nodeDuration: Histogram,
    @InjectMetric(AGENT_MODEL_ATTEMPTS_TOTAL) private readonly modelAttempts: Counter,
    @InjectMetric(AGENT_MODEL_DURATION) private readonly modelDuration: Histogram,
    @InjectMetric(AGENT_MODEL_TTFT) private readonly modelTtft: Histogram,
    @InjectMetric(AGENT_MODEL_TOKENS_TOTAL) private readonly modelTokens: Counter,
    @InjectMetric(AGENT_MODEL_COST_TOTAL) private readonly modelCost: Counter,
    @InjectMetric(AGENT_MODEL_COST_UNKNOWN_TOTAL) private readonly unknownModelCost: Counter,
    @InjectMetric(AGENT_TOOL_ATTEMPTS_TOTAL) private readonly toolAttempts: Counter,
    @InjectMetric(AGENT_TOOL_DURATION) private readonly toolDuration: Histogram,
    @InjectMetric(AGENT_TOOL_RESULT_BYTES) private readonly toolResultBytes: Histogram,
    @InjectMetric(AGENT_TOOL_DATA_AGE) private readonly toolDataAge: Gauge,
    @InjectMetric(AGENT_TRACE_SPANS_TOTAL) private readonly spans: Counter,
  ) {}

  record(event: ModelGatewayMetricEvent): void {
    const labels = { provider: event.provider, model: event.model, purpose: event.purpose, status: event.status }
    this.modelAttempts.inc(labels)
    this.modelDuration.observe(labels, seconds(event.durationMs))
    if (event.ttftMs != null) this.modelTtft.observe(stripStatus(labels), seconds(event.ttftMs))
    if (!event.usage) return
    this.modelTokens.inc({ provider: event.provider, model: event.model, direction: 'input' }, event.usage.inputTokens)
    this.modelTokens.inc(
      { provider: event.provider, model: event.model, direction: 'output' },
      event.usage.outputTokens,
    )
    if (event.usage.cachedTokens) {
      this.modelTokens.inc(
        { provider: event.provider, model: event.model, direction: 'cached' },
        event.usage.cachedTokens,
      )
    }
    if (event.usage.reasoningTokens) {
      this.modelTokens.inc(
        { provider: event.provider, model: event.model, direction: 'reasoning' },
        event.usage.reasoningTokens,
      )
    }
  }

  observeRun(workflow: string, status: 'COMPLETED' | 'FAILED' | 'CANCELLED', durationMs: number): void {
    const labels = { workflow, status }
    this.runs.inc(labels)
    this.runDuration.observe(labels, seconds(durationMs))
  }

  observeNode(workflow: string, node: string, status: 'SUCCEEDED' | 'FAILED', durationMs: number): void {
    this.nodeDuration.observe({ workflow, node, status }, seconds(durationMs))
  }

  observeCost(input: {
    provider: string
    model: string
    amount: number | null
    currency: string | null
    source: AgentCostSource | null
    estimated: boolean
  }): void {
    if (input.amount == null || input.currency == null || input.source == null) {
      this.unknownModelCost.inc({ provider: input.provider, model: input.model })
      return
    }
    this.modelCost.inc(
      {
        provider: input.provider,
        model: input.model,
        currency: input.currency,
        source: input.source,
        estimated: String(input.estimated),
      },
      input.amount,
    )
  }

  observeSpan(span: string, status: 'SUCCEEDED' | 'FAILED'): void {
    this.spans.inc({ span, status })
  }

  onStarted(event: { toolKey: string }): void {
    this.toolAttempts.inc({ tool: event.toolKey, status: 'STARTED' })
  }

  onRetry(event: { toolKey: string }): void {
    this.toolAttempts.inc({ tool: event.toolKey, status: 'RETRY' })
  }

  onCompleted(event: { toolKey: string; durationMs: number; resultBytes: number; dataAsOf: string | null }): void {
    this.toolAttempts.inc({ tool: event.toolKey, status: 'SUCCEEDED' })
    this.toolDuration.observe({ tool: event.toolKey, status: 'SUCCEEDED' }, seconds(event.durationMs))
    this.toolResultBytes.observe({ tool: event.toolKey }, event.resultBytes)
    const date = event.dataAsOf ? Date.parse(event.dataAsOf) : Number.NaN
    if (Number.isFinite(date)) this.toolDataAge.set({ tool: event.toolKey }, Math.max(0, (Date.now() - date) / 1_000))
  }

  onFailed(event: { toolKey: string; durationMs: number }): void {
    this.toolAttempts.inc({ tool: event.toolKey, status: 'FAILED' })
    this.toolDuration.observe({ tool: event.toolKey, status: 'FAILED' }, seconds(event.durationMs))
  }
}

function seconds(durationMs: number): number {
  return Math.max(0, durationMs) / 1_000
}

function stripStatus(labels: { provider: string; model: string; purpose: string; status: string }) {
  return { provider: labels.provider, model: labels.model, purpose: labels.purpose }
}
