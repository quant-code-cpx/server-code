import { Injectable } from '@nestjs/common'
import type { FactPacket, FinalAnswerDraft } from './workflow.types'

export interface CitationCoverageResult {
  valid: boolean
  coverage: number
  issues: string[]
}

@Injectable()
export class CitationCoverageService {
  validate(draft: FinalAnswerDraft, facts: readonly FactPacket[]): CitationCoverageResult {
    const issues: string[] = []
    const factsById = new Map(facts.map((fact) => [fact.factId, fact]))
    const citableFacts = facts.filter(isCitableFact)
    const citableFactIds = new Set(citableFacts.map((fact) => fact.factId))
    const claimKeys = new Set<string>()
    let supportedClaims = 0
    const claims = Array.isArray(draft?.claims) ? draft.claims : []

    if (!draft || typeof draft.markdown !== 'string' || !draft.markdown.trim()) issues.push('回答正文为空')
    if (!Array.isArray(draft?.claims)) issues.push('回答 claims 非法')
    else {
      for (const claim of claims) {
        if (!claim.claimKey?.trim()) issues.push('claimKey 为空')
        else if (claimKeys.has(claim.claimKey)) issues.push(`claimKey 重复：${claim.claimKey}`)
        else claimKeys.add(claim.claimKey)
        if (!Array.isArray(claim.factIds) || claim.factIds.length === 0) {
          issues.push(`Claim ${claim.claimKey || 'unknown'} 缺少引用`)
          continue
        }
        const searchFacts = claim.factIds.filter((factId) => factsById.get(factId)?.toolKey === 'search_web')
        const missing = claim.factIds.filter((factId) => !factsById.has(factId))
        const uncitable = claim.factIds.filter((factId) => factsById.has(factId) && !citableFactIds.has(factId))
        if (searchFacts.length > 0) {
          issues.push(`Claim ${claim.claimKey} 引用了搜索摘要事实不可引用：${searchFacts.join(',')}`)
        }
        if (missing.length > 0) issues.push(`Claim ${claim.claimKey} 引用了未知事实：${missing.join(',')}`)
        if (uncitable.length > searchFacts.length) {
          issues.push(`Claim ${claim.claimKey} 引用了不可引用事实：${uncitable.join(',')}`)
        }
        if (missing.length === 0 && uncitable.length === 0) supportedClaims += 1
      }
    }

    if (citableFacts.length > 0 && claims.length === 0) issues.push('存在事实包但回答未声明可验证 Claim')
    if (citableFacts.length === 0 && claims.length > 0) issues.push('没有事实包时禁止创建事实引用')
    const totalClaims = claims.length
    return {
      valid: issues.length === 0,
      coverage: totalClaims === 0 ? (citableFacts.length === 0 ? 1 : 0) : supportedClaims / totalClaims,
      issues,
    }
  }
}

export function isCitableFact(fact: FactPacket): boolean {
  return fact.toolKey !== 'search_web'
}
