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
    const factIds = new Set(facts.map((fact) => fact.factId))
    const claimKeys = new Set<string>()
    let supportedClaims = 0

    if (!draft || typeof draft.markdown !== 'string' || !draft.markdown.trim()) issues.push('回答正文为空')
    if (!Array.isArray(draft?.claims)) issues.push('回答 claims 非法')
    else {
      for (const claim of draft.claims) {
        if (!claim.claimKey?.trim()) issues.push('claimKey 为空')
        else if (claimKeys.has(claim.claimKey)) issues.push(`claimKey 重复：${claim.claimKey}`)
        else claimKeys.add(claim.claimKey)
        if (!Array.isArray(claim.factIds) || claim.factIds.length === 0) {
          issues.push(`Claim ${claim.claimKey || 'unknown'} 缺少引用`)
          continue
        }
        const missing = claim.factIds.filter((factId) => !factIds.has(factId))
        if (missing.length > 0) issues.push(`Claim ${claim.claimKey} 引用了未知事实：${missing.join(',')}`)
        else supportedClaims += 1
      }
    }

    if (facts.length > 0 && draft.claims.length === 0) issues.push('存在事实包但回答未声明可验证 Claim')
    if (facts.length === 0 && draft.claims.length > 0) issues.push('没有事实包时禁止创建事实引用')
    const totalClaims = draft?.claims?.length ?? 0
    return {
      valid: issues.length === 0,
      coverage: totalClaims === 0 ? (facts.length === 0 ? 1 : 0) : supportedClaims / totalClaims,
      issues,
    }
  }
}
