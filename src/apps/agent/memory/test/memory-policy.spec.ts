import { AiMemoryCategory, AiMemorySensitivity } from '@prisma/client'

import {
  assertMemoryCandidateAllowed,
  assertMemoryWriteAllowed,
  MemoryPolicyError,
  resolveMemoryExpiry,
  type MemoryPolicyTopic,
} from '../memory-policy'

const now = new Date('2026-07-21T00:00:00.000Z')

describe('Agent memory policy', () => {
  it.each([
    [AiMemoryCategory.PREFERENCE, 365, 1_825],
    [AiMemoryCategory.PROFILE, 365, 1_095],
    [AiMemoryCategory.CONSTRAINT, 180, 730],
    [AiMemoryCategory.DOMAIN_FACT, 90, 365],
  ])('%s 使用固定默认 TTL 且拒绝超过类别上限', (category, defaultDays, maxDays) => {
    expect(resolveMemoryExpiry(category, now)).toEqual(new Date(now.getTime() + defaultDays * 86_400_000))
    expect(() => resolveMemoryExpiry(category, now, new Date(now.getTime() + (maxDays + 1) * 86_400_000))).toThrow(
      MemoryPolicyError,
    )
  })

  it.each<MemoryPolicyTopic>(['PORTFOLIO_POSITION', 'TRADING_LOG', 'CREDENTIAL', 'HEALTH', 'POLITICAL_INFERENCE'])(
    '%s 无论是否确认都禁止写入长期记忆',
    (topic) => {
      expect(() =>
        assertMemoryWriteAllowed({
          category: AiMemoryCategory.PROFILE,
          sensitivity: AiMemorySensitivity.PERSONAL,
          source: 'USER_COMMAND',
          topic,
          confirmedByUser: true,
        }),
      ).toThrow(MemoryPolicyError)
    },
  )

  it.each<MemoryPolicyTopic>(['PORTFOLIO_POSITION', 'TRADING_LOG', 'CREDENTIAL', 'HEALTH', 'POLITICAL_INFERENCE'])(
    '%s 候选阶段也禁止持久化',
    (topic) => {
      expect(() =>
        assertMemoryCandidateAllowed({
          category: AiMemoryCategory.PREFERENCE,
          sensitivity: AiMemorySensitivity.NORMAL,
          topic,
        }),
      ).toThrow(MemoryPolicyError)
    },
  )

  it('未经用户确认的 candidate 不允许升级为长期记忆', () => {
    expect(() =>
      assertMemoryWriteAllowed({
        category: AiMemoryCategory.PREFERENCE,
        sensitivity: AiMemorySensitivity.NORMAL,
        source: 'USER_COMMAND',
        topic: 'GENERAL',
        confirmedByUser: false,
      }),
    ).toThrow('长期记忆必须由用户明确确认')
  })

  it('金融敏感数据只允许明确偏好或约束，不允许画像或市场事实', () => {
    for (const category of [AiMemoryCategory.PREFERENCE, AiMemoryCategory.CONSTRAINT]) {
      expect(() =>
        assertMemoryWriteAllowed({
          category,
          sensitivity: AiMemorySensitivity.FINANCIAL,
          source: 'USER_SETTING',
          topic: 'GENERAL',
          confirmedByUser: true,
        }),
      ).not.toThrow()
    }

    for (const category of [AiMemoryCategory.PROFILE, AiMemoryCategory.DOMAIN_FACT]) {
      expect(() =>
        assertMemoryWriteAllowed({
          category,
          sensitivity: AiMemorySensitivity.FINANCIAL,
          source: 'USER_COMMAND',
          topic: 'GENERAL',
          confirmedByUser: true,
        }),
      ).toThrow(MemoryPolicyError)
    }
  })

  it('过期时间必须晚于当前时间', () => {
    expect(() => resolveMemoryExpiry(AiMemoryCategory.PREFERENCE, now, now)).toThrow(MemoryPolicyError)
  })
})
