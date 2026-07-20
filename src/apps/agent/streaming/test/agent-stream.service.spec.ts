import { HttpException } from '@nestjs/common'
import type { AiRunEvent, Prisma } from '@prisma/client'
import type { IAgentExecutionConfig } from 'src/config/agent-execution.config'
import type { IAgentStreamConfig } from 'src/config/agent-stream.config'
import { AGENT_EVENT_FIXTURES, type AgentSseEvent } from '../../contracts'
import type { AgentStreamBatch, AgentStreamRunSnapshot } from '../../execution/agent-event.repository'
import { AgentEventRepository } from '../../execution/agent-event.repository'
import { AgentStreamGapError } from '../agent-stream.errors'
import { AgentStreamMetricsService } from '../agent-stream-metrics.service'
import { AgentStreamService } from '../agent-stream.service'

const running: AgentStreamRunSnapshot = {
  id: 'run_fixture',
  conversationId: 'conversation_fixture',
  responseMessageId: 'message_fixture',
  status: 'RUNNING',
  latestEventSequence: 2n,
}

const terminal: AgentStreamRunSnapshot = { ...running, status: 'COMPLETED', latestEventSequence: 3n }

describe('AgentStreamService', () => {
  let repository: jest.Mocked<Pick<AgentEventRepository, 'getStreamRun' | 'resolveStreamCursor' | 'readStreamBatch'>>
  let metrics: jest.Mocked<AgentStreamMetricsService>
  let service: AgentStreamService

  beforeEach(() => {
    repository = {
      getStreamRun: jest.fn().mockResolvedValue(running),
      resolveStreamCursor: jest.fn(),
      readStreamBatch: jest.fn(),
    }
    metrics = {
      opened: jest.fn(),
      rejected: jest.fn(),
      event: jest.fn(),
      recordBytes: jest.fn(),
      closed: jest.fn(),
    } as unknown as jest.Mocked<AgentStreamMetricsService>
    const executionConfig = { replayLimit: 100 } as IAgentExecutionConfig
    const streamConfig = {
      heartbeatMs: 1_000,
      idleTimeoutMs: 10_000,
      maxConnectionsPerUser: 1,
      maxBufferBytes: 1_048_576,
      pollIntervalMs: 1,
    } as IAgentStreamConfig
    service = new AgentStreamService(
      repository as unknown as AgentEventRepository,
      executionConfig,
      streamConfig,
      metrics,
    )
  })

  it('先重放 high-water，再 tail 新事件，严格按 sequence 输出并在终态结束', async () => {
    repository.readStreamBatch
      .mockResolvedValueOnce(batch(running, [stored(AGENT_EVENT_FIXTURES[0], 1), stored(AGENT_EVENT_FIXTURES[1], 2)]))
      .mockResolvedValueOnce(batch(terminal, [stored(completedFixture(), 3)]))

    const session = await service.open(7, running.id, 0, undefined)
    const received: AgentSseEvent[] = []
    for await (const event of session.events) received.push(event)
    session.close()

    expect(received.map((event) => event.sequence)).toEqual([1, 2, 3])
    expect(repository.readStreamBatch.mock.calls[0][4]).toBe(2n)
    expect(repository.readStreamBatch.mock.calls[1][4]).toBeUndefined()
    expect(session.terminationReason).toBe('terminal')
    expect(metrics.event.mock.calls.map(([phase]) => phase)).toEqual(['replay', 'replay', 'live'])
    expect(metrics.closed).toHaveBeenCalledWith('terminal', expect.any(Number))
  })

  it('Last-Event-ID 在同 Run 内解析，并优先于 Body afterSequence', async () => {
    repository.resolveStreamCursor.mockResolvedValue(1n)
    repository.readStreamBatch.mockResolvedValue(batch({ ...terminal, latestEventSequence: 1n }, []))

    const session = await service.open(7, running.id, 999, 'evt_fixture')
    await expect(collect(session.events)).resolves.toEqual([])
    session.close()

    expect(repository.resolveStreamCursor).toHaveBeenCalledWith(7, running.id, 'evt_fixture')
    expect(repository.readStreamBatch).toHaveBeenCalledWith(7, running.id, 1n, 100, 2n)
  })

  it('拒绝非法、不存在或属于其他 Run 的 Last-Event-ID', async () => {
    await expect(service.open(7, running.id, 0, 'bad:event')).rejects.toMatchObject({ code: 'AI_CURSOR_INVALID' })
    repository.resolveStreamCursor.mockResolvedValue(null)
    await expect(service.open(7, running.id, 0, 'evt_missing')).rejects.toMatchObject({ code: 'AI_CURSOR_INVALID' })
  })

  it('发现持久 sequence gap 时终止，不把不连续事件推给客户端', async () => {
    repository.readStreamBatch.mockResolvedValue(batch(running, [stored(AGENT_EVENT_FIXTURES[1], 2)]))
    const session = await service.open(7, running.id, 0, undefined)

    await expect(collect(session.events)).rejects.toBeInstanceOf(AgentStreamGapError)
    expect(session.terminationReason).toBe('sequence_gap')
    session.close()
    expect(metrics.closed).toHaveBeenCalledWith('sequence_gap', expect.any(Number))
  })

  it('限制同用户并发连接，关闭后归还额度', async () => {
    const first = await service.open(7, running.id, 0, undefined)
    await expect(service.open(7, running.id, 0, undefined)).rejects.toBeInstanceOf(HttpException)
    expect(metrics.rejected).toHaveBeenCalledWith('user_limit')

    first.close('client_disconnect')
    const replacement = await service.open(7, running.id, 0, undefined)
    replacement.close('client_disconnect')
  })

  it('应用 shutdown 中止活动 session，并拒绝新连接', async () => {
    const session = await service.open(7, running.id, 0, undefined)
    service.onApplicationShutdown()
    expect(session.terminationReason).toBe('shutdown')
    await expect(service.open(8, running.id, 0, undefined)).rejects.toBeInstanceOf(HttpException)
    session.close('shutdown')
  })
})

function batch(run: AgentStreamRunSnapshot, events: AiRunEvent[]): AgentStreamBatch {
  return { run, events }
}

function stored(source: AgentSseEvent, sequence: number): AiRunEvent {
  return {
    id: BigInt(sequence),
    publicId: `evt_${sequence}`,
    runId: running.id,
    stepId: null,
    sequence: BigInt(sequence),
    eventType: source.type,
    visibility: 'USER',
    traceId: source.traceId,
    payload: source.payload as unknown as Prisma.JsonValue,
    publishStatus: 'PENDING',
    publishAttempts: 0,
    nextPublishAt: new Date(source.occurredAt),
    publishLeaseOwner: null,
    publishLeaseExpires: null,
    publishedAt: null,
    occurredAt: new Date(source.occurredAt),
  }
}

function completedFixture(): AgentSseEvent {
  return AGENT_EVENT_FIXTURES.find((event) => event.type === 'agent.completed')!
}

async function collect(events: AsyncIterable<AgentSseEvent>): Promise<AgentSseEvent[]> {
  const result: AgentSseEvent[] = []
  for await (const event of events) result.push(event)
  return result
}
