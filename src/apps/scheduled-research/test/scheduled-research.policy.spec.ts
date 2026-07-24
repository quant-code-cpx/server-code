import { AiScheduledTaskTrigger } from '@prisma/client'
import {
  assertCronExpression,
  parseRequiredWatermarks,
  parseStructuredCondition,
  resolveNextRunAt,
} from '../scheduled-research.policy'
import { ScheduledResearchValidationError } from '../scheduled-research.errors'

describe('ScheduledResearch policy', () => {
  it('按 IANA 时区计算下一次 CRON，不接受无效时区', () => {
    const next = resolveNextRunAt({
      trigger: AiScheduledTaskTrigger.CRON,
      cronExpression: assertCronExpression('0 30 18 * * 1-5', 'Asia/Shanghai'),
      timeZone: 'Asia/Shanghai',
      now: new Date('2026-07-21T09:00:00.000Z'), // 上海 17:00
      conditionPollMs: 60_000,
    })
    expect(next?.toISOString()).toBe('2026-07-21T10:30:00.000Z') // 上海 18:30
    expect(() => assertCronExpression('0 0 * * *', 'Not/A_TimeZone')).toThrow(ScheduledResearchValidationError)
  })

  it('条件 DSL 只允许固定指标、比较符和数值冷却期', () => {
    expect(
      parseStructuredCondition({
        metricKey: 'DAILY_CLOSE',
        resourceId: '600519.SH',
        operator: 'GTE',
        threshold: 1500,
        cooldownMinutes: 60,
      }),
    ).toEqual({
      metricKey: 'DAILY_CLOSE',
      resourceId: '600519.SH',
      operator: 'GTE',
      threshold: 1500,
      cooldownMinutes: 60,
    })
    expect(() =>
      parseStructuredCondition({
        metricKey: 'DAILY_CLOSE',
        resourceId: '600519.SH',
        operator: 'GTE',
        threshold: 1500,
        cooldownMinutes: '60',
        sql: 'SELECT * FROM users',
      }),
    ).toThrow(ScheduledResearchValidationError)
  })

  it('watermark 必须是白名单结构，不能将字符串当作分钟数', () => {
    expect(parseRequiredWatermarks([{ dataset: 'DAILY', minTradeDate: '20260722', maxAgeMinutes: 180 }])).toEqual([
      { dataset: 'DAILY', minTradeDate: '20260722', maxAgeMinutes: 180 },
    ])
    expect(() => parseRequiredWatermarks([{ dataset: 'DAILY', maxAgeMinutes: '180' }])).toThrow(
      ScheduledResearchValidationError,
    )
  })
})
