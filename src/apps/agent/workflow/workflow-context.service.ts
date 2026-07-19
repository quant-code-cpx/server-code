import { Injectable } from '@nestjs/common'
import { AGENT_CAPABILITIES, type AgentCapability } from '../contracts'
import { AgentMessageRepository } from '../conversation/agent-message.repository'
import type { AgentExecutionRun } from '../execution/agent-run.repository'
import { hashStableJson, stableJson } from '../tools/tool-json'
import type { LoadedWorkflowContext } from './workflow.types'

@Injectable()
export class WorkflowContextService {
  constructor(private readonly messages: AgentMessageRepository) {}

  async load(run: AgentExecutionRun): Promise<LoadedWorkflowContext> {
    const input = asRecord(run.inputSnapshot)
    const history = await this.messages.listMessages(run.userId, run.conversationId, { limit: 10 })
    return {
      userId: run.userId,
      role: run.user.role,
      userStatus: run.user.status,
      conversationId: run.conversationId,
      triggerMessageId: run.triggerMessageId,
      responseMessageId: run.responseMessageId,
      userText: run.triggerMessage.contentText?.trim().slice(0, 10_000) || readText(input.userText, 10_000),
      recentMessages: history.items.map((message) => ({
        role: message.role,
        content: (message.contentText ?? '').slice(0, 4_000),
      })),
      allowedCapabilities: readCapabilities(input.allowedCapabilities),
      allowedScopes: readScopes(input.allowedScopes),
      pageContext: cloneRecord(input.pageContext),
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function cloneRecord(value: unknown): Record<string, unknown> {
  const record = asRecord(value)
  const serialized = stableJson(record)
  if (serialized.length > 20_000) return { truncated: true, contentHash: hashStableJson(record) }
  return JSON.parse(serialized) as Record<string, unknown>
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function readCapabilities(value: unknown): AgentCapability[] {
  if (!Array.isArray(value)) return []
  const requested = new Set(
    value.filter((entry): entry is AgentCapability => AGENT_CAPABILITIES.includes(entry as never)),
  )
  return AGENT_CAPABILITIES.filter((capability) => requested.has(capability))
}

function readScopes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value.filter((entry): entry is string => typeof entry === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(entry)),
    ),
  ].sort()
}
