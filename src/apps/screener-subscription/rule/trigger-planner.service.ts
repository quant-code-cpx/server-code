import { Injectable } from '@nestjs/common'
import {
  CollectionTriggerHit,
  CollectionTriggerPlan,
  CollectionTriggerPlannerInput,
  SubscriptionTriggerSpec,
} from './subscription-rule.types'
import { RuleNormalizerService } from './rule-normalizer.service'

/**
 * 集合规则的差集和通知触发规划。此服务不截断 hits；摘要限制属于通知 worker。
 */
@Injectable()
export class TriggerPlannerService {
  constructor(private readonly normalizer: RuleNormalizerService) {}

  planCollection(input: CollectionTriggerPlannerInput): CollectionTriggerPlan {
    if (typeof input.hasBaseline !== 'boolean') {
      throw new TypeError('hasBaseline 必须明确传入，空集合不能推断为首次执行')
    }

    const triggerSpec = this.normalizer.normalizeTriggerSpec(input.triggerSpec)
    const previousMatchCodes = uniqueSortedCodes(input.previousMatchCodes)
    const currentMatchCodes = uniqueSortedCodes(input.currentMatchCodes)
    const previousSet = new Set(previousMatchCodes)
    const currentSet = new Set(currentMatchCodes)

    const observedEnterCodes = currentMatchCodes.filter((code) => !previousSet.has(code))
    const observedExitCodes = previousMatchCodes.filter((code) => !currentSet.has(code))
    const canEmitInitialEnter = input.hasBaseline || triggerSpec.notifyOnInitialMatch
    const enterCodes = allowsEnter(triggerSpec) && canEmitInitialEnter ? observedEnterCodes : []
    const exitCodes = allowsExit(triggerSpec) && input.hasBaseline ? observedExitCodes : []

    const hits: CollectionTriggerHit[] = [
      ...enterCodes.map((tsCode) => ({ tsCode, kind: 'ENTER' as const })),
      ...exitCodes.map((tsCode) => ({ tsCode, kind: 'EXIT' as const })),
    ]

    return {
      isInitialBaseline: !input.hasBaseline,
      matchedCodes: currentMatchCodes,
      observedEnterCodes,
      observedExitCodes,
      enterCodes,
      exitCodes,
      hits,
    }
  }
}

function allowsEnter(triggerSpec: SubscriptionTriggerSpec): boolean {
  return triggerSpec.mode === 'ENTER' || triggerSpec.mode === 'BOTH'
}

function allowsExit(triggerSpec: SubscriptionTriggerSpec): boolean {
  return triggerSpec.mode === 'EXIT' || triggerSpec.mode === 'BOTH'
}

function uniqueSortedCodes(codes: readonly string[]): string[] {
  const unique = new Set<string>()
  for (const code of codes) {
    if (typeof code !== 'string' || code.trim().length === 0) {
      throw new TypeError('匹配股票代码必须是非空字符串')
    }
    unique.add(code.trim().toUpperCase())
  }
  return [...unique].sort()
}
