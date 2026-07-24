import { CronTime } from 'cron'
import { AiScheduledTaskTrigger } from '@prisma/client'
import { AGENT_CAPABILITIES, type AgentCapability } from 'src/apps/agent/contracts'
import { ScheduledResearchValidationError } from './scheduled-research.errors'

export const SCHEDULE_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
export const SCHEDULE_NAME_MAX_LENGTH = 160
export const SCHEDULE_PROMPT_MAX_LENGTH = 10_000

export const CONDITION_METRIC_KEYS = ['DAILY_CLOSE'] as const
export const CONDITION_OPERATORS = ['GT', 'GTE', 'LT', 'LTE'] as const
export const WATERMARK_DATASETS = ['DAILY'] as const

export type StructuredCondition = {
  metricKey: (typeof CONDITION_METRIC_KEYS)[number]
  resourceId: string
  operator: (typeof CONDITION_OPERATORS)[number]
  threshold: number
  cooldownMinutes: number
}

export type RequiredWatermark = {
  dataset: (typeof WATERMARK_DATASETS)[number]
  minTradeDate?: string
  maxAgeMinutes?: number
}

export function assertTimeZone(timeZone: string): string {
  const value = timeZone.trim()
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value })
  } catch {
    throw new ScheduledResearchValidationError('timeZone 必须是合法 IANA 时区')
  }
  return value
}

export function assertCronExpression(expression: string, timeZone: string): string {
  const value = expression.trim()
  if (!value || value.length > 128) throw new ScheduledResearchValidationError('cron 长度必须是 1-128')
  try {
    new CronTime(value, timeZone).getNextDateFrom(new Date())
  } catch {
    throw new ScheduledResearchValidationError('cron 表达式或时区无效')
  }
  return value
}

export function resolveNextRunAt(input: {
  trigger: AiScheduledTaskTrigger
  cronExpression?: string | null
  oneTimeAt?: Date | null
  timeZone: string
  now: Date
  conditionPollMs: number
}): Date | null {
  if (input.trigger === AiScheduledTaskTrigger.CRON) {
    if (!input.cronExpression) throw new ScheduledResearchValidationError('CRON 任务缺少 cronExpression')
    return new CronTime(input.cronExpression, input.timeZone).getNextDateFrom(input.now).toJSDate()
  }
  if (input.trigger === AiScheduledTaskTrigger.ONE_TIME) {
    if (!input.oneTimeAt || input.oneTimeAt.getTime() <= input.now.getTime()) {
      throw new ScheduledResearchValidationError('ONE_TIME 任务必须指定未来 oneTimeAt')
    }
    return input.oneTimeAt
  }
  return new Date(input.now.getTime() + input.conditionPollMs)
}

export function parseStructuredCondition(value: unknown): StructuredCondition {
  if (!isRecord(value)) throw new ScheduledResearchValidationError('condition 必须是对象')
  rejectUnknownKeys(value, ['metricKey', 'resourceId', 'operator', 'threshold', 'cooldownMinutes'], 'condition')
  const metricKey = value.metricKey
  const resourceId = value.resourceId
  const operator = value.operator
  const threshold = value.threshold
  const cooldownMinutes = value.cooldownMinutes
  if (!CONDITION_METRIC_KEYS.includes(metricKey as StructuredCondition['metricKey'])) {
    throw new ScheduledResearchValidationError('condition.metricKey 不在允许列表')
  }
  if (typeof resourceId !== 'string' || !/^[0-9A-Za-z._-]{3,32}$/.test(resourceId)) {
    throw new ScheduledResearchValidationError('condition.resourceId 非法')
  }
  if (!CONDITION_OPERATORS.includes(operator as StructuredCondition['operator'])) {
    throw new ScheduledResearchValidationError('condition.operator 不在允许列表')
  }
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    throw new ScheduledResearchValidationError('condition.threshold 必须是有限数值')
  }
  if (
    typeof cooldownMinutes !== 'number' ||
    !Number.isInteger(cooldownMinutes) ||
    cooldownMinutes < 0 ||
    cooldownMinutes > 43_200
  ) {
    throw new ScheduledResearchValidationError('condition.cooldownMinutes 必须是 0-43200 的整数')
  }
  return {
    metricKey: metricKey as StructuredCondition['metricKey'],
    resourceId: resourceId as string,
    operator: operator as StructuredCondition['operator'],
    threshold: threshold as number,
    cooldownMinutes: cooldownMinutes as number,
  }
}

export function parseRequiredWatermarks(value: unknown): RequiredWatermark[] {
  if (!Array.isArray(value) || value.length > WATERMARK_DATASETS.length) {
    throw new ScheduledResearchValidationError('requiredWatermarks 必须是最多一个元素的数组')
  }
  const entries = value.map((entry) => {
    if (!isRecord(entry)) throw new ScheduledResearchValidationError('watermark 必须是对象')
    rejectUnknownKeys(entry, ['dataset', 'minTradeDate', 'maxAgeMinutes'], 'watermark')
    if (!WATERMARK_DATASETS.includes(entry.dataset as RequiredWatermark['dataset'])) {
      throw new ScheduledResearchValidationError('watermark.dataset 不在允许列表')
    }
    if (entry.minTradeDate != null && (typeof entry.minTradeDate !== 'string' || !/^\d{8}$/.test(entry.minTradeDate))) {
      throw new ScheduledResearchValidationError('watermark.minTradeDate 必须是 YYYYMMDD')
    }
    if (
      entry.maxAgeMinutes != null &&
      (typeof entry.maxAgeMinutes !== 'number' ||
        !Number.isInteger(entry.maxAgeMinutes) ||
        entry.maxAgeMinutes < 1 ||
        entry.maxAgeMinutes > 43_200)
    ) {
      throw new ScheduledResearchValidationError('watermark.maxAgeMinutes 必须是 1-43200 的整数')
    }
    return {
      dataset: entry.dataset as RequiredWatermark['dataset'],
      ...(entry.minTradeDate == null ? {} : { minTradeDate: entry.minTradeDate as string }),
      ...(entry.maxAgeMinutes == null ? {} : { maxAgeMinutes: entry.maxAgeMinutes as number }),
    }
  })
  if (new Set(entries.map((entry) => entry.dataset)).size !== entries.length) {
    throw new ScheduledResearchValidationError('requiredWatermarks.dataset 不能重复')
  }
  return entries
}

export function normalizeCapabilities(value: unknown): AgentCapability[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > AGENT_CAPABILITIES.length) {
    throw new ScheduledResearchValidationError('allowedCapabilities 必须是 1-3 个能力')
  }
  const capabilities = value.map((item) => String(item))
  if (
    new Set(capabilities).size !== capabilities.length ||
    capabilities.some((item) => !AGENT_CAPABILITIES.includes(item as AgentCapability))
  ) {
    throw new ScheduledResearchValidationError('allowedCapabilities 不在允许列表')
  }
  return capabilities.sort() as AgentCapability[]
}

export function normalizeJsonObject(value: unknown, field: string, maxBytes = 8_192): Record<string, unknown> {
  if (!isRecord(value)) throw new ScheduledResearchValidationError(`${field} 必须是对象`)
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new ScheduledResearchValidationError(`${field} 必须可序列化为 JSON`)
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes || jsonDepth(value) > 8) {
    throw new ScheduledResearchValidationError(`${field} 超过容量或嵌套深度限制`)
  }
  return JSON.parse(serialized) as Record<string, unknown>
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new ScheduledResearchValidationError(`${field}.${key} 不允许出现`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function jsonDepth(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)
  return 1 + children.reduce((maximum, child) => Math.max(maximum, jsonDepth(child)), 0)
}
