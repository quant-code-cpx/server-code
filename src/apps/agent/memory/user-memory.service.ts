import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type {
  CreateMemoryDto,
  DeleteMemoryDto,
  ListMemoriesDto,
  UpdateMemoryDto,
} from '../api/dto/memory/memory-request.dto'
import { AgentConfirmationRequiredError, AgentMemoryValidationError } from './memory-repository.errors'
import type { MemoryPolicyTopic } from './memory-policy'
import { UserMemoryRepository, type PersistedUserMemory } from './user-memory.repository'

const MAX_MEMORY_VALUE_BYTES = 8_192
const MAX_MEMORY_VALUE_DEPTH = 8
const SENSITIVE_MARKERS = [
  'portfolio.position',
  'holding',
  'trade.log',
  'trading.log',
  'password',
  'credential',
  'access_token',
  'refresh_token',
  'diagnosis',
  'health',
  'political',
  '持仓',
  '交易日志',
  '密码',
  '凭据',
  '健康',
  '诊断',
  '政治',
]

@Injectable()
export class UserMemoryService {
  constructor(private readonly memories: UserMemoryRepository) {}

  async list(userId: number, dto: ListMemoriesDto) {
    const now = new Date()
    const page = await this.memories.listManaged(userId, { ...dto, now })
    return { items: page.items.map((memory) => mapMemory(memory, now)), nextCursor: page.nextCursor }
  }

  async create(userId: number, dto: CreateMemoryDto) {
    requireConfirmation(dto.confirmation)
    const value = validateMemoryValue(dto.key, dto.value, dto.topic)
    const memory = await this.memories.createConfirmed(userId, {
      category: dto.category,
      key: dto.key,
      value,
      sensitivity: dto.sensitivity,
      sourceConversationId: dto.sourceConversationId,
      sourceMessageId: dto.sourceMessageId,
      confidence: dto.confidence,
      topic: dto.topic,
      source: 'USER_COMMAND',
      confirmedByUser: true,
      now: new Date(),
      expiresAt: parseOptionalDate(dto.expiresAt),
    })
    return mapMemory(memory)
  }

  async update(userId: number, dto: UpdateMemoryDto) {
    requireConfirmation(dto.confirmation)
    const value = validateMemoryValue('', dto.value, dto.topic)
    const memory = await this.memories.correct(userId, dto.memoryId, {
      value,
      sensitivity: dto.sensitivity,
      sourceConversationId: dto.sourceConversationId,
      sourceMessageId: dto.sourceMessageId,
      confidence: dto.confidence,
      topic: dto.topic,
      source: 'USER_COMMAND',
      now: new Date(),
      expiresAt: parseOptionalDate(dto.expiresAt),
    })
    return mapMemory(memory)
  }

  async delete(userId: number, dto: DeleteMemoryDto) {
    const memory = await this.memories.softDelete(userId, dto.memoryId, new Date())
    return {
      memoryId: memory.id,
      status: memory.status,
      deletedAt: memory.deletedAt?.toISOString() ?? null,
    }
  }
}

function requireConfirmation(confirmation: boolean): void {
  if (confirmation !== true) throw new AgentConfirmationRequiredError()
}

function validateMemoryValue(key: string, value: unknown, topic: MemoryPolicyTopic): Prisma.InputJsonValue {
  if (value == null) throw new AgentMemoryValidationError('记忆 value 不能为空')
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new AgentMemoryValidationError('记忆 value 必须可序列化为 JSON')
  }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_MEMORY_VALUE_BYTES) {
    throw new AgentMemoryValidationError(`记忆 value 不能超过 ${MAX_MEMORY_VALUE_BYTES} bytes`)
  }
  if (jsonDepth(value) > MAX_MEMORY_VALUE_DEPTH) {
    throw new AgentMemoryValidationError(`记忆 value 嵌套深度不能超过 ${MAX_MEMORY_VALUE_DEPTH}`)
  }
  if (topic === 'GENERAL') {
    const searchable = `${key} ${serialized}`.toLowerCase()
    if (SENSITIVE_MARKERS.some((marker) => searchable.includes(marker))) {
      throw new AgentMemoryValidationError('记忆内容与声明 topic 不一致或属于禁止主题')
    }
  }
  return JSON.parse(serialized) as Prisma.InputJsonValue
}

function jsonDepth(value: unknown): number {
  if (value == null || typeof value !== 'object') return 0
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  return 1 + children.reduce((maximum, child) => Math.max(maximum, jsonDepth(child)), 0)
}

function parseOptionalDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw new AgentMemoryValidationError('expiresAt 无效')
  return date
}

function mapMemory(memory: PersistedUserMemory, now = new Date()) {
  const status =
    memory.status === 'CONFIRMED' && memory.expiresAt && memory.expiresAt.getTime() <= now.getTime()
      ? 'EXPIRED'
      : memory.status
  return {
    memoryId: memory.id,
    category: memory.category,
    key: memory.key,
    value: memory.value,
    sensitivity: memory.sensitivity,
    status,
    sourceConversationId: memory.sourceConversationId,
    sourceMessageId: memory.sourceMessageId,
    confidence: Number(memory.confidence),
    version: memory.version,
    validFrom: memory.validFrom.toISOString(),
    confirmedAt: memory.confirmedAt?.toISOString() ?? null,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    revokedAt: memory.revokedAt?.toISOString() ?? null,
    deletedAt: memory.deletedAt?.toISOString() ?? null,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  }
}
