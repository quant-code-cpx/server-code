import { HttpException, HttpStatus, Inject, Injectable, OnApplicationShutdown } from '@nestjs/common'
import { AiAgentRunStatus } from '@prisma/client'
import { AgentExecutionConfig, type IAgentExecutionConfig } from 'src/config/agent-execution.config'
import { AgentStreamConfig, type IAgentStreamConfig } from 'src/config/agent-stream.config'
import type { AgentSseEvent } from '../contracts'
import { TERMINAL_AGENT_EVENT_TYPES } from '../contracts'
import { AgentEventRepository } from '../execution/agent-event.repository'
import { AgentStreamCursorInvalidError, AgentStreamGapError } from './agent-stream.errors'
import { AgentStreamMetricsService } from './agent-stream-metrics.service'
import { toAgentSseEvent } from './sse-event.serializer'

const TERMINAL_RUN_STATUSES = new Set<AiAgentRunStatus>([
  AiAgentRunStatus.COMPLETED,
  AiAgentRunStatus.FAILED,
  AiAgentRunStatus.CANCELLED,
])
const SAFE_EVENT_ID = /^[A-Za-z0-9_-]{1,32}$/

export type AgentStreamTerminationReason =
  | 'terminal'
  | 'client_disconnect'
  | 'token_expired'
  | 'idle_timeout'
  | 'slow_consumer'
  | 'sequence_gap'
  | 'stream_error'
  | 'shutdown'

export interface AgentStreamSession {
  readonly events: AsyncIterable<AgentSseEvent>
  readonly terminationReason: AgentStreamTerminationReason | null
  close(reason?: AgentStreamTerminationReason): void
}

interface StreamState {
  terminationReason: AgentStreamTerminationReason | null
}

@Injectable()
export class AgentStreamService implements OnApplicationShutdown {
  private readonly connectionsByUser = new Map<number, number>()
  private readonly activeSessions = new Map<AbortController, StreamState>()
  private shuttingDown = false

  constructor(
    private readonly eventRepository: AgentEventRepository,
    @Inject(AgentExecutionConfig.KEY) private readonly executionConfig: IAgentExecutionConfig,
    @Inject(AgentStreamConfig.KEY) private readonly streamConfig: IAgentStreamConfig,
    private readonly metrics: AgentStreamMetricsService,
  ) {}

  async open(
    userId: number,
    runId: string,
    afterSequence: number,
    lastEventId: string | undefined,
    signal?: AbortSignal,
  ): Promise<AgentStreamSession> {
    const run = await this.eventRepository.getStreamRun(userId, runId)
    const cursor = await this.resolveCursor(userId, runId, afterSequence, lastEventId)
    if (this.shuttingDown) throw new HttpException('Agent SSE 服务正在关闭', HttpStatus.SERVICE_UNAVAILABLE)

    const connectionCount = this.connectionsByUser.get(userId) ?? 0
    if (connectionCount >= this.streamConfig.maxConnectionsPerUser) {
      this.metrics.rejected('user_limit')
      throw new HttpException('Agent SSE 连接数已达上限', HttpStatus.TOO_MANY_REQUESTS)
    }

    const controller = new AbortController()
    const forwardAbort = () => controller.abort(signal?.reason)
    if (signal?.aborted) controller.abort(signal.reason)
    else signal?.addEventListener('abort', forwardAbort, { once: true })

    const state: StreamState = { terminationReason: null }
    this.connectionsByUser.set(userId, connectionCount + 1)
    this.activeSessions.set(controller, state)
    const openedAt = Date.now()
    const replayLag = Number(run.latestEventSequence - cursor)
    this.metrics.opened(Number.isSafeInteger(replayLag) ? Math.max(0, replayLag) : Number.MAX_SAFE_INTEGER)
    let closed = false
    const close = (reason: AgentStreamTerminationReason = state.terminationReason ?? 'stream_error') => {
      if (closed) return
      closed = true
      state.terminationReason = reason
      signal?.removeEventListener('abort', forwardAbort)
      controller.abort(reason)
      this.activeSessions.delete(controller)
      const current = this.connectionsByUser.get(userId) ?? 1
      if (current <= 1) this.connectionsByUser.delete(userId)
      else this.connectionsByUser.set(userId, current - 1)
      this.metrics.closed(reason, Date.now() - openedAt)
    }

    const events = this.tail(userId, runId, cursor, run.latestEventSequence, run, controller.signal, state)
    return {
      events,
      get terminationReason() {
        return state.terminationReason
      },
      close,
    }
  }

  async *stream(
    userId: number,
    runId: string,
    afterSequence: number,
    signal?: AbortSignal,
  ): AsyncIterable<AgentSseEvent> {
    const session = await this.open(userId, runId, afterSequence, undefined, signal)
    try {
      yield* session.events
    } finally {
      session.close()
    }
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true
    for (const [controller, state] of this.activeSessions) {
      state.terminationReason = 'shutdown'
      controller.abort('shutdown')
    }
  }

  private async resolveCursor(
    userId: number,
    runId: string,
    afterSequence: number,
    lastEventId: string | undefined,
  ): Promise<bigint> {
    if (!lastEventId) return BigInt(afterSequence)
    if (!SAFE_EVENT_ID.test(lastEventId)) throw new AgentStreamCursorInvalidError()
    const sequence = await this.eventRepository.resolveStreamCursor(userId, runId, lastEventId)
    if (sequence == null) throw new AgentStreamCursorInvalidError()
    return sequence
  }

  private async *tail(
    userId: number,
    runId: string,
    initialCursor: bigint,
    highWater: bigint,
    initialRun: Awaited<ReturnType<AgentEventRepository['getStreamRun']>>,
    signal: AbortSignal,
    state: StreamState,
  ): AsyncIterable<AgentSseEvent> {
    let cursor = initialCursor
    let replayThrough: bigint | undefined = highWater
    let lastBusinessEventAt = Date.now()
    let run = initialRun

    while (!signal.aborted) {
      const phase = replayThrough == null ? 'live' : 'replay'
      const batch = await this.eventRepository.readStreamBatch(
        userId,
        runId,
        cursor,
        this.executionConfig.replayLimit,
        replayThrough,
      )
      run = batch.run
      for (const stored of batch.events) {
        const actualSequence = Number(stored.sequence)
        const expectedSequence = Number(cursor + 1n)
        if (actualSequence !== expectedSequence) {
          state.terminationReason = 'sequence_gap'
          throw new AgentStreamGapError(expectedSequence, actualSequence)
        }
        const event = toAgentSseEvent(stored, run)
        cursor = stored.sequence
        lastBusinessEventAt = Date.now()
        this.metrics.event(phase)
        yield event
        if (TERMINAL_AGENT_EVENT_TYPES.includes(event.type as (typeof TERMINAL_AGENT_EVENT_TYPES)[number])) {
          state.terminationReason = 'terminal'
          return
        }
      }

      if (replayThrough != null) {
        if (cursor >= replayThrough || batch.events.length === 0) replayThrough = undefined
        if (batch.events.length > 0) continue
      }
      if (TERMINAL_RUN_STATUSES.has(run.status) && cursor >= run.latestEventSequence) {
        state.terminationReason = 'terminal'
        return
      }
      if (Date.now() - lastBusinessEventAt >= this.streamConfig.idleTimeoutMs) {
        state.terminationReason = 'idle_timeout'
        return
      }
      await abortableDelay(this.streamConfig.pollIntervalMs, signal)
    }
  }
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    const onAbort = () => done()
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
