import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { ApiSuccessRawResponse } from 'src/common/decorators/api-success-response.decorator'
import { CurrentUser } from 'src/common/decorators/current-user.decorator'
import { RawStreamResponse } from 'src/common/decorators/raw-stream-response.decorator'
import { AgentStreamConfig, type IAgentStreamConfig } from 'src/config/agent-stream.config'
import { JwtAuthGuard } from 'src/lifecycle/guard/jwt-auth.guard'
import { LoggerService } from 'src/shared/logger/logger.service'
import type { TokenPayload } from 'src/shared/token.interface'
import {
  AgentStreamService,
  type AgentStreamSession,
  type AgentStreamTerminationReason,
} from '../streaming/agent-stream.service'
import { AgentStreamSlowConsumerError } from '../streaming/agent-stream.errors'
import { AgentStreamMetricsService } from '../streaming/agent-stream-metrics.service'
import { AGENT_SSE_HEARTBEAT, serializeSseEvent } from '../streaming/sse-event.serializer'
import { AgentErrorInterceptor } from './agent-error.interceptor'
import { AgentStrictBodyGuard } from './agent-strict-body.guard'
import { AgentRunEventsDto } from './dto/run/run-request.dto'
import { StrictAgentBody } from './strict-agent-body.decorator'

@ApiTags('Agent - 事件流')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AgentStrictBodyGuard)
@UseInterceptors(AgentErrorInterceptor)
@Controller('agent')
export class AgentStreamController {
  constructor(
    private readonly streams: AgentStreamService,
    private readonly metrics: AgentStreamMetricsService,
    @Inject(AgentStreamConfig.KEY) private readonly config: IAgentStreamConfig,
    private readonly logger: LoggerService,
  ) {}

  @Post('runs/events')
  @HttpCode(HttpStatus.OK)
  @StrictAgentBody(AgentRunEventsDto)
  @RawStreamResponse()
  @ApiOperation({ summary: '重放并持续订阅 Agent Run 持久事件' })
  @ApiHeader({ name: 'Last-Event-ID', required: false, description: '同一 Run 内最后确认的持久 eventId' })
  @ApiProduces('text/event-stream')
  @ApiSuccessRawResponse(
    { type: 'string', example: 'id: evt_xxx\nevent: agent.progress\ndata: {...}\n\n' },
    { description: 'raw text/event-stream', rawResponse: true },
  )
  async events(
    @CurrentUser() user: TokenPayload,
    @Body() dto: AgentRunEventsDto,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const abortController = new AbortController()
    let abortReason: AgentStreamTerminationReason | null = null
    let session: AgentStreamSession | null = null
    let tokenTimer: NodeJS.Timeout | undefined
    const abort = (reason: AgentStreamTerminationReason) => {
      if (abortController.signal.aborted) return
      abortReason = reason
      abortController.abort(reason)
    }
    const onClientClose = () => abort('client_disconnect')

    request.once('aborted', onClientClose)
    response.once('close', onClientClose)
    if (user.exp != null) {
      const remainingMs = user.exp * 1000 - Date.now()
      if (remainingMs <= 0) abort('token_expired')
      else {
        tokenTimer = setTimeout(() => abort('token_expired'), remainingMs)
        tokenTimer.unref()
      }
    }

    try {
      session = await this.streams.open(user.id, dto.runId, dto.afterSequence, lastEventId, abortController.signal)
      if (abortController.signal.aborted) return
      response.status(HttpStatus.OK)
      response.set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      response.flushHeaders()
      await this.pump(session, response, abortController.signal)
    } catch (error) {
      if (!response.headersSent) throw error
      if (error instanceof AgentStreamSlowConsumerError) abortReason = 'slow_consumer'
      else if (!abortController.signal.aborted) abortReason = session?.terminationReason ?? 'stream_error'
      if (abortReason !== 'client_disconnect' && abortReason !== 'token_expired') {
        this.logger.warn(
          {
            operation: 'agentSse.stream',
            runId: dto.runId,
            reason: abortReason,
            error: error instanceof Error ? error.message : 'Agent SSE stream error',
          },
          AgentStreamController.name,
        )
      }
    } finally {
      request.removeListener('aborted', onClientClose)
      response.removeListener('close', onClientClose)
      if (tokenTimer) clearTimeout(tokenTimer)
      const reason = abortReason ?? session?.terminationReason ?? 'stream_error'
      abort(reason)
      session?.close(reason)
      if (response.headersSent && !response.writableEnded && !response.destroyed) response.end()
    }
  }

  private async pump(session: AgentStreamSession, response: Response, signal: AbortSignal): Promise<void> {
    const iterator = session.events[Symbol.asyncIterator]()
    let pending = iterator.next()
    try {
      while (!signal.aborted) {
        const result = await nextOrHeartbeat(pending, this.config.heartbeatMs, signal)
        if (result.kind === 'heartbeat') {
          await this.writeChunk(response, AGENT_SSE_HEARTBEAT, signal)
          continue
        }
        if (result.value.done) return
        await this.writeChunk(response, serializeSseEvent(result.value.value), signal)
        pending = iterator.next()
      }
    } finally {
      await iterator.return?.()
    }
  }

  private async writeChunk(response: Response, chunk: string, signal: AbortSignal): Promise<void> {
    const bytes = Buffer.byteLength(chunk)
    if (bytes > this.config.maxBufferBytes) throw new AgentStreamSlowConsumerError()
    if (signal.aborted || response.destroyed || response.writableEnded) return
    const writable = response.write(chunk)
    this.metrics.recordBytes(bytes)
    if (response.writableLength > this.config.maxBufferBytes) throw new AgentStreamSlowConsumerError()
    if (!writable) await waitForDrain(response, signal, this.config.heartbeatMs)
  }
}

type NextOrHeartbeat<T> = { kind: 'next'; value: IteratorResult<T> } | { kind: 'heartbeat' }

function nextOrHeartbeat<T>(
  pending: Promise<IteratorResult<T>>,
  heartbeatMs: number,
  signal: AbortSignal,
): Promise<NextOrHeartbeat<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish({ kind: 'heartbeat' }), heartbeatMs)
    const onAbort = () => finish({ kind: 'heartbeat' })
    const finish = (result: NextOrHeartbeat<T>) => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (value) => finish({ kind: 'next', value }),
      (error) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function waitForDrain(response: Response, signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new AgentStreamSlowConsumerError()), timeoutMs)
    const onDrain = () => finish()
    const onClose = () => finish()
    const onAbort = () => finish()
    const finish = (error?: Error) => {
      clearTimeout(timer)
      response.removeListener('drain', onDrain)
      response.removeListener('close', onClose)
      signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve()
    }
    response.once('drain', onDrain)
    response.once('close', onClose)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
