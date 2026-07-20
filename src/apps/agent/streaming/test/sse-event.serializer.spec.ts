import type { AiRunEvent, Prisma } from '@prisma/client'
import { AGENT_EVENT_FIXTURES, type AgentSseEvent } from '../../contracts'
import type { AgentStreamRunSnapshot } from '../../execution/agent-event.repository'
import { AGENT_SSE_HEARTBEAT, serializeSseEvent, toAgentSseEvent } from '../sse-event.serializer'

const run: AgentStreamRunSnapshot = {
  id: 'run_fixture',
  conversationId: 'conversation_fixture',
  responseMessageId: 'message_fixture',
  status: 'RUNNING',
  latestEventSequence: 14n,
}

describe('Agent SSE serializer', () => {
  it.each(AGENT_EVENT_FIXTURES)('序列化公共事件 $type 为单个 id/event/retry/data frame', (event) => {
    const frame = serializeSseEvent(event)
    const lines = frame.trimEnd().split('\n')

    expect(lines[0]).toBe(`id: ${event.eventId}`)
    expect(lines[1]).toBe(`event: ${event.type}`)
    expect(lines[2]).toBe('retry: 3000')
    expect(lines.filter((line) => line.startsWith('data: '))).toHaveLength(1)
    expect(JSON.parse(lines[3].slice('data: '.length))).toEqual(event)
  })

  it('JSON 转义中文、CR/LF 和伪造 SSE 字段，不产生第二个 frame', () => {
    const event = {
      ...AGENT_EVENT_FIXTURES.find((item) => item.type === 'model.delta')!,
      payload: { modelCallId: 'model_call_fixture', blockIndex: 0, delta: '中文\nid: forged\r\nevent: agent.failed' },
    } as AgentSseEvent

    const frame = serializeSseEvent(event)

    expect(frame.match(/^id: /gm)).toHaveLength(1)
    expect(frame.match(/^event: /gm)).toHaveLength(1)
    expect(frame.match(/^data: /gm)).toHaveLength(1)
    const dataLine = frame.split('\n').find((line) => line.startsWith('data: '))!
    expect(JSON.parse(dataLine.slice(6)).payload.delta).toBe('中文\nid: forged\r\nevent: agent.failed')
  })

  it('拒绝未知事件类型、未知 schemaVersion 和非法 eventId', () => {
    const fixture = AGENT_EVENT_FIXTURES[0]
    expect(() => serializeSseEvent({ ...fixture, type: 'hidden.reasoning' } as never)).toThrow('协议校验失败')
    expect(() => serializeSseEvent({ ...fixture, schemaVersion: '2.0' } as never)).toThrow('协议校验失败')
    expect(() => serializeSseEvent({ ...fixture, eventId: 'evt\nforged' })).toThrow('eventId')
  })

  it('从持久 Event 与 owner-scoped Run 映射 canonical 公共结构', () => {
    const fixture = AGENT_EVENT_FIXTURES[0]
    const stored = makeStoredEvent(fixture)

    expect(toAgentSseEvent(stored, run)).toEqual(fixture)
    expect(AGENT_SSE_HEARTBEAT).toBe(': heartbeat\n\n')
  })
})

function makeStoredEvent(event: AgentSseEvent): AiRunEvent {
  return {
    id: 1n,
    publicId: event.eventId,
    runId: event.runId,
    stepId: null,
    sequence: BigInt(event.sequence),
    eventType: event.type,
    visibility: 'USER',
    traceId: event.traceId,
    payload: event.payload as unknown as Prisma.JsonValue,
    publishStatus: 'PENDING',
    publishAttempts: 0,
    nextPublishAt: new Date(event.occurredAt),
    publishLeaseOwner: null,
    publishLeaseExpires: null,
    publishedAt: null,
    occurredAt: new Date(event.occurredAt),
  }
}
