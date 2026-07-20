import { Injectable } from '@nestjs/common'
import { InjectMetric } from '@willsoto/nestjs-prometheus'
import type { Counter, Gauge, Histogram } from 'prom-client'
import {
  AGENT_SSE_ACTIVE_CONNECTIONS,
  AGENT_SSE_BYTES_TOTAL,
  AGENT_SSE_CONNECTIONS_TOTAL,
  AGENT_SSE_DISCONNECTS_TOTAL,
  AGENT_SSE_DURATION,
  AGENT_SSE_EVENTS_TOTAL,
  AGENT_SSE_REPLAY_LAG,
} from 'src/shared/metrics/metrics.constants'

@Injectable()
export class AgentStreamMetricsService {
  constructor(
    @InjectMetric(AGENT_SSE_ACTIVE_CONNECTIONS) private readonly activeConnections: Gauge,
    @InjectMetric(AGENT_SSE_CONNECTIONS_TOTAL) private readonly connections: Counter,
    @InjectMetric(AGENT_SSE_EVENTS_TOTAL) private readonly events: Counter,
    @InjectMetric(AGENT_SSE_BYTES_TOTAL) private readonly bytes: Counter,
    @InjectMetric(AGENT_SSE_DURATION) private readonly duration: Histogram,
    @InjectMetric(AGENT_SSE_REPLAY_LAG) private readonly replayLag: Histogram,
    @InjectMetric(AGENT_SSE_DISCONNECTS_TOTAL) private readonly disconnects: Counter,
  ) {}

  opened(replayLag: number): void {
    this.activeConnections.inc()
    this.connections.inc({ result: 'accepted' })
    this.replayLag.observe(Math.max(0, replayLag))
  }

  rejected(reason: string): void {
    this.connections.inc({ result: reason })
  }

  event(phase: 'replay' | 'live'): void {
    this.events.inc({ phase })
  }

  recordBytes(value: number): void {
    this.bytes.inc(value)
  }

  closed(reason: string, durationMs: number): void {
    this.activeConnections.dec()
    this.disconnects.inc({ reason })
    this.duration.observe({ reason }, Math.max(0, durationMs) / 1000)
  }
}
