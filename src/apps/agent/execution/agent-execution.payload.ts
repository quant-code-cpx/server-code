import { Prisma } from '@prisma/client'
import { sanitizeAuditErrorMessage, sanitizeAuditPayload } from '../audit/agent-audit-sanitizer'
import { AgentExecutionValidationError } from './agent-execution.errors'

export const MAX_AGENT_EVENT_PAYLOAD_BYTES = 256_000
export const MAX_AGENT_CHECKPOINT_BYTES = 256_000

export function sanitizeExecutionObject(
  value: unknown,
  fieldName: string,
  maxBytes = MAX_AGENT_CHECKPOINT_BYTES,
): Record<string, unknown> {
  const sanitized = sanitizeAuditPayload(value)
  if (!sanitized || Array.isArray(sanitized) || typeof sanitized !== 'object') {
    throw new AgentExecutionValidationError(`${fieldName} 必须是 JSON object`)
  }
  assertPayloadSize(sanitized, fieldName, maxBytes)
  return sanitized as Record<string, unknown>
}

export function sanitizeEventPayload(value: unknown): Record<string, unknown> {
  const payload = sanitizeExecutionObject(value, 'event payload', MAX_AGENT_EVENT_PAYLOAD_BYTES)
  const normalized = { ...payload, schemaVersion: '1.0' }
  assertPayloadSize(normalized, 'event payload', MAX_AGENT_EVENT_PAYLOAD_BYTES)
  return normalized
}

export function sanitizeExecutionError(value: unknown): string {
  return sanitizeAuditErrorMessage(value)
}

export function toJsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export function requireText(value: string, name: string, maxLength: number): string {
  if (typeof value !== 'string') throw new AgentExecutionValidationError(`${name} 必须是字符串`)
  const normalized = value.trim()
  if (!normalized) throw new AgentExecutionValidationError(`${name} 不能为空`)
  if (normalized.length > maxLength) throw new AgentExecutionValidationError(`${name} 超过 ${maxLength} 字符`)
  return normalized
}

export function optionalText(value: string | null | undefined, name: string, maxLength: number): string | null {
  if (value == null) return null
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > maxLength) throw new AgentExecutionValidationError(`${name} 超过 ${maxLength} 字符`)
  return normalized
}

export function requirePositiveInteger(value: number, name: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new AgentExecutionValidationError(`${name} 必须是 1-${maximum} 的整数`)
  }
  return value
}

export function requireNonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AgentExecutionValidationError(`${name} 必须是非负安全整数`)
  }
  return value
}

function assertPayloadSize(value: unknown, fieldName: string, maxBytes: number): void {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > maxBytes) throw new AgentExecutionValidationError(`${fieldName} 超过 ${maxBytes} bytes`)
}
