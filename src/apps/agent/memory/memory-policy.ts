import { AiMemoryCategory, AiMemorySensitivity } from '@prisma/client'

const MILLISECONDS_PER_DAY = 86_400_000

const RETENTION_POLICY: Readonly<Record<AiMemoryCategory, { defaultTtlDays: number; maxTtlDays: number }>> =
  Object.freeze({
    [AiMemoryCategory.PREFERENCE]: { defaultTtlDays: 365, maxTtlDays: 1_825 },
    [AiMemoryCategory.PROFILE]: { defaultTtlDays: 365, maxTtlDays: 1_095 },
    [AiMemoryCategory.CONSTRAINT]: { defaultTtlDays: 180, maxTtlDays: 730 },
    [AiMemoryCategory.DOMAIN_FACT]: { defaultTtlDays: 90, maxTtlDays: 365 },
  })

export type MemoryPolicySource = 'USER_COMMAND' | 'USER_SETTING' | 'SAVED_REPORT'

export const MEMORY_POLICY_TOPICS = [
  'GENERAL',
  'PORTFOLIO_POSITION',
  'TRADING_LOG',
  'CREDENTIAL',
  'HEALTH',
  'POLITICAL_INFERENCE',
] as const

export type MemoryPolicyTopic = (typeof MEMORY_POLICY_TOPICS)[number]

const FORBIDDEN_TOPICS = new Set<MemoryPolicyTopic>([
  'PORTFOLIO_POSITION',
  'TRADING_LOG',
  'CREDENTIAL',
  'HEALTH',
  'POLITICAL_INFERENCE',
])

export class MemoryPolicyError extends Error {
  readonly code = 'AI_MEMORY_VALIDATION_FAILED'

  constructor(message: string) {
    super(message)
    this.name = 'MemoryPolicyError'
  }
}

export function resolveMemoryExpiry(category: AiMemoryCategory, now: Date, requestedExpiresAt?: Date): Date {
  requireValidDate(now, '当前时间')
  const policy = RETENTION_POLICY[category]
  if (!policy) throw new MemoryPolicyError('未知记忆类别')

  if (!requestedExpiresAt) {
    return new Date(now.getTime() + policy.defaultTtlDays * MILLISECONDS_PER_DAY)
  }

  requireValidDate(requestedExpiresAt, '过期时间')
  const retentionMs = requestedExpiresAt.getTime() - now.getTime()
  if (retentionMs <= 0) throw new MemoryPolicyError('记忆过期时间必须晚于当前时间')
  if (retentionMs > policy.maxTtlDays * MILLISECONDS_PER_DAY) {
    throw new MemoryPolicyError(`记忆保留时间不能超过 ${policy.maxTtlDays} 天`)
  }
  return new Date(requestedExpiresAt)
}

export function assertMemoryWriteAllowed(input: {
  category: AiMemoryCategory
  sensitivity: AiMemorySensitivity
  source: MemoryPolicySource
  topic: MemoryPolicyTopic
  confirmedByUser: boolean
}): void {
  if (!input.confirmedByUser) throw new MemoryPolicyError('长期记忆必须由用户明确确认')
  assertMemoryCandidateAllowed(input)
}

export function assertMemoryCandidateAllowed(input: {
  category: AiMemoryCategory
  sensitivity: AiMemorySensitivity
  topic: MemoryPolicyTopic
}): void {
  if (FORBIDDEN_TOPICS.has(input.topic)) {
    throw new MemoryPolicyError('该类敏感信息禁止写入长期记忆')
  }
  if (
    input.sensitivity === AiMemorySensitivity.FINANCIAL &&
    input.category !== AiMemoryCategory.PREFERENCE &&
    input.category !== AiMemoryCategory.CONSTRAINT
  ) {
    throw new MemoryPolicyError('金融敏感记忆仅允许明确偏好或约束')
  }
}

function requireValidDate(value: Date, field: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new MemoryPolicyError(`${field}无效`)
  }
}
