import { Prisma } from '@prisma/client'
import { AgentProtocolError, parseMessageBlock } from '../contracts'
import type { MessageBlock } from '../contracts'
import {
  AgentCursorInvalidError,
  AgentMessageValidationError,
  AgentStoredMessageInvalidError,
} from './agent-conversation.errors'

interface DateIdCursor {
  at: string
  id: string
}

export function encodeDateIdCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id } satisfies DateIdCursor)).toString('base64url')
}

export function decodeDateIdCursor(cursor: string): { at: Date; id: string } {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Partial<DateIdCursor>
    const at = new Date(value.at ?? '')
    if (!value.id || Number.isNaN(at.getTime())) throw new AgentCursorInvalidError()
    return { at, id: value.id }
  } catch (error) {
    if (error instanceof AgentCursorInvalidError) throw error
    throw new AgentCursorInvalidError()
  }
}

export function validatePageLimit(limit: number, max: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new AgentMessageValidationError(`分页 limit 必须为 1–${max} 的整数`)
  }
}

export function validateMessageBlocks(value: unknown): MessageBlock[] {
  if (!Array.isArray(value)) throw new AgentMessageValidationError('contentBlocks 必须为数组')
  try {
    return value.map((block) => parseMessageBlock(block))
  } catch (error) {
    if (error instanceof AgentProtocolError) {
      throw new AgentMessageValidationError('contentBlocks 不符合 Agent 公共协议')
    }
    throw error
  }
}

export function decodeStoredMessageBlocks(value: Prisma.JsonValue, messageId: string): MessageBlock[] {
  try {
    return validateMessageBlocks(value)
  } catch {
    throw new AgentStoredMessageInvalidError(messageId)
  }
}

export function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJson(entry)]),
  )
}
