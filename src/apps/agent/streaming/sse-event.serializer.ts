import type { AiRunEvent } from '@prisma/client'
import { parseAgentSseEvent, type AgentSseEvent } from '../contracts'
import type { AgentStreamRunSnapshot } from '../execution/agent-event.repository'

export const AGENT_SSE_RETRY_MS = 3_000
export const AGENT_SSE_HEARTBEAT = ': heartbeat\n\n'

const SAFE_SSE_ID = /^[A-Za-z0-9_-]{1,128}$/

export function toAgentSseEvent(event: AiRunEvent, run: AgentStreamRunSnapshot): AgentSseEvent {
  const sequence = Number(event.sequence)
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('Agent SSE event sequence 超出安全整数范围')
  }
  return parseAgentSseEvent({
    schemaVersion: '1.0',
    eventId: event.publicId,
    sequence,
    type: event.eventType,
    runId: event.runId,
    conversationId: run.conversationId,
    ...(run.responseMessageId ? { messageId: run.responseMessageId } : {}),
    occurredAt: event.occurredAt.toISOString(),
    traceId: event.traceId,
    payload: event.payload,
  })
}

export function serializeSseEvent(input: AgentSseEvent): string {
  const event = parseAgentSseEvent(input)
  if (!SAFE_SSE_ID.test(event.eventId)) throw new Error('Agent SSE eventId 包含非法字符')
  const data = JSON.stringify(event)
  if (data.includes('\r') || data.includes('\n')) throw new Error('Agent SSE data 包含未转义换行')
  return `id: ${event.eventId}\nevent: ${event.type}\nretry: ${AGENT_SSE_RETRY_MS}\ndata: ${data}\n\n`
}
