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
        let claimTokensSupported = true
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
        if (missing.length === 0 && uncitable.length === 0) {
          const citedFacts = claim.factIds.flatMap((factId) => {
            const cited = factsById.get(factId)
            return cited ? [cited] : []
          })
          const unsupportedTokens = findUnsupportedVerifiableTokens(claim.text, citedFacts)
          if (unsupportedTokens.length > 0) {
            claimTokensSupported = false
            issues.push(`Claim ${claim.claimKey} 包含无法由引用事实支持的数字或日期：${unsupportedTokens.join(',')}`)
          }
        }
        if (missing.length === 0 && uncitable.length === 0 && claimTokensSupported) supportedClaims += 1
      }
    }

    if (claims.length > 0) {
      const citedFacts = claims.flatMap((claim) =>
        claim.factIds.flatMap((factId) => {
          const cited = factsById.get(factId)
          return cited && isCitableFact(cited) ? [cited] : []
        }),
      )
      const unsupportedMarkdownTokens = findUnsupportedVerifiableTokens(draft.markdown, citedFacts)
      if (unsupportedMarkdownTokens.length > 0) {
        issues.push(`回答正文包含无法由已声明引用支持的数字或日期：${unsupportedMarkdownTokens.join(',')}`)
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

function findUnsupportedVerifiableTokens(claimText: string, facts: readonly FactPacket[]): string[] {
  const summaries = facts.map((fact) => fact.summary).join('\n')
  const tokens = extractVerifiableTokens(claimText)
  return [...new Set(tokens.filter((token) => !summarySupportsToken(summaries, token, claimText)))]
}

function extractVerifiableTokens(text: string): string[] {
  const dates = text.match(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g) ?? []
  // 区间表达“35.91-40.55元”中的连字符是分隔符，不是第二个数的负号。
  const values = text.match(/(?<![\d.])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:%|％|亿元|万元|元|倍|点)/g) ?? []
  return [...dates, ...values]
}

function summarySupportsToken(summary: string, rawToken: string, claimText: string): boolean {
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(rawToken)) {
    const normalizedToken = rawToken.replaceAll('/', '-')
    const normalizedSummary = summary.replaceAll('/', '-')
    return (
      normalizedSummary.includes(normalizedToken) || normalizedSummary.includes(normalizedToken.replaceAll('-', ''))
    )
  }
  const token = parseNumericToken(rawToken)
  if (!token) return true
  const negativeDirection = hasImplicitNegativeDirection(claimText, rawToken)
  const sourceValues = [...extractNumbers(summary), ...extractAggregateNumbers(summary, claimText, token.unit)]
  return sourceValues.some((sourceValue) =>
    displayCandidates(sourceValue, token.unit).some((candidate) => {
      if (roundForDisplay(candidate, token.fractionDigits) === token.value) return true
      return (
        negativeDirection && candidate < 0 && roundForDisplay(Math.abs(candidate), token.fractionDigits) === token.value
      )
    }),
  )
}

function hasImplicitNegativeDirection(claimText: string, rawToken: string): boolean {
  if (/^\s*[-−]/.test(rawToken)) return false
  let index = claimText.indexOf(rawToken)
  while (index >= 0) {
    const context = claimText.slice(Math.max(0, index - 20), index)
    if (
      /(跌\s*$|净流出|下跌|跌幅|下挫|下行|回落|收跌|下降|减少|亏损|回撤|为负|负收益|跑输|(?<!最)(?:低|少)(?:于|约)?\s*$)/.test(
        context,
      )
    ) {
      return true
    }
    index = claimText.indexOf(rawToken, index + rawToken.length)
  }
  return false
}

interface NumericToken {
  value: number
  fractionDigits: number
  unit: '%' | '元' | '万元' | '亿元' | '倍' | '点'
}

function parseNumericToken(rawToken: string): NumericToken | null {
  const matched = /^([-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?)\s*(%|％|亿元|万元|元|倍|点)$/.exec(rawToken)
  if (!matched) return null
  const value = Number(matched[1].replaceAll(',', ''))
  if (!Number.isFinite(value)) return null
  return {
    value,
    fractionDigits: matched[2]?.length ?? 0,
    unit: matched[3] === '％' ? '%' : (matched[3] as NumericToken['unit']),
  }
}

function extractNumbers(summary: string): number[] {
  return [...summary.matchAll(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g)]
    .map((matched) => Number(matched[0].replaceAll(',', '')))
    .filter((value) => Number.isFinite(value))
}

function extractAggregateNumbers(summary: string, claimText: string, unit: NumericToken['unit']): number[] {
  if (!['元', '万元', '亿元'].includes(unit)) return []
  const wantsSum = /(累计|合计|总计|总额)/.test(claimText)
  const wantsAverage = /(平均|均值|日均)/.test(claimText)
  if (!wantsSum && !wantsAverage) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(summary)
  } catch {
    return []
  }
  const groups = new Map<string, number[]>()
  collectNumericPathGroups(parsed, '$', groups, { visited: 0 })
  const aggregates: number[] = []
  for (const [path, values] of groups) {
    if (values.length < 2 || values.length > 1_000 || !/(?:amount|amt|money|marketvalue)$/i.test(path)) continue
    const sum = values.reduce((total, value) => total + value, 0)
    if (wantsSum && Number.isFinite(sum)) aggregates.push(sum)
    if (wantsAverage && Number.isFinite(sum / values.length)) aggregates.push(sum / values.length)
  }
  return aggregates
}

function collectNumericPathGroups(
  value: unknown,
  path: string,
  groups: Map<string, number[]>,
  budget: { visited: number },
): void {
  budget.visited += 1
  if (budget.visited > 10_000) return
  if (typeof value === 'number' && Number.isFinite(value)) {
    const values = groups.get(path) ?? []
    values.push(value)
    groups.set(path, values)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumericPathGroups(item, `${path}[]`, groups, budget)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    collectNumericPathGroups(item, `${path}.${key}`, groups, budget)
  }
}

function displayCandidates(sourceValue: number, unit: NumericToken['unit']): number[] {
  switch (unit) {
    case '%':
      return [sourceValue, sourceValue * 100]
    case '亿元':
      // 数据源金额可能以元、千元或万元返回，统一转换为亿元后再验证展示值。
      return [sourceValue, sourceValue / 100_000_000, sourceValue / 100_000, sourceValue / 10_000]
    case '万元':
      return [sourceValue / 10_000, sourceValue / 10, sourceValue]
    default:
      return [sourceValue]
  }
}

function roundForDisplay(value: number, fractionDigits: number): number {
  const multiplier = 10 ** fractionDigits
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier
}

export function isCitableFact(fact: FactPacket): boolean {
  return fact.toolKey !== 'search_web'
}
