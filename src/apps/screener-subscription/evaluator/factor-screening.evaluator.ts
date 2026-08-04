import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { FactorConditionSpec, FactorScreeningRuleSpec, SubscriptionRuleType } from '../rule'
import { isSpecialTreatmentStockName } from '../rule/subscription-universe.util'
import {
  EvaluationContext,
  EvaluationEvidence,
  EvaluationOutcome,
  SubscriptionEvaluator,
} from './subscription-evaluator.interface'

type SnapshotValue = { value: number | null; percentile: number | null }

/**
 * B2 因子集合评估器：只读取指定交易日的预计算快照，不回退到实时因子计算，
 * 因而预览和定时执行始终使用同一可审计截面。
 */
@Injectable()
export class FactorScreeningEvaluator implements SubscriptionEvaluator<FactorScreeningRuleSpec> {
  readonly type = SubscriptionRuleType.FACTOR_SCREENING

  constructor(private readonly prisma: PrismaService) {}

  async evaluate(context: EvaluationContext, spec: FactorScreeningRuleSpec): Promise<EvaluationOutcome> {
    const [universe, definitions, snapshots] = await Promise.all([
      this.resolveUniverse(context.tradeDate, spec),
      this.prisma.factorDefinition.findMany({
        where: { name: { in: spec.conditions.map((condition) => condition.factorId) } },
        select: { name: true, isEnabled: true },
      }),
      this.prisma.factorSnapshot.findMany({
        where: {
          tradeDate: context.tradeDate,
          factorName: { in: spec.conditions.map((condition) => condition.factorId) },
        },
        select: { factorName: true, tsCode: true, value: true, percentile: true, syncedAt: true },
      }),
    ])
    this.assertDefinitions(spec.conditions, definitions)

    const snapshotMaps = new Map<string, Map<string, SnapshotValue>>()
    let latestSyncedAt: Date | null = null
    for (const snapshot of snapshots) {
      const values = snapshotMaps.get(snapshot.factorName) ?? new Map<string, SnapshotValue>()
      values.set(snapshot.tsCode, {
        value: snapshot.value === null ? null : Number(snapshot.value),
        percentile: snapshot.percentile === null ? null : Number(snapshot.percentile),
      })
      snapshotMaps.set(snapshot.factorName, values)
      if (!latestSyncedAt || snapshot.syncedAt > latestSyncedAt) latestSyncedAt = snapshot.syncedAt
    }

    let matchedCodes = [...universe]
    for (const condition of spec.conditions) {
      const values = snapshotMaps.get(condition.factorId)
      if (!values) {
        throw new BadRequestException({ code: 'RULE_INVALID', message: `因子 ${condition.factorId} 缺少有效快照` })
      }
      // 分位条件的分母始终是完整规则宇宙；前一条条件只决定本条通过者
      // 最终是否还留在交集里，不能改变 Top/Bottom 的排名基准。
      const passed = this.passedCodes(values, [...universe], condition)
      matchedCodes = matchedCodes.filter((tsCode) => passed.has(tsCode))
    }

    return {
      asOfTradeDate: context.tradeDate,
      universeCount: universe.size,
      matchedCodes,
      dataVersions: {
        FACTOR_SNAPSHOT: `target:${context.tradeDate}:synced:${latestSyncedAt?.toISOString() ?? 'unknown'}`,
      },
      warnings: [],
    }
  }

  async explain(
    context: EvaluationContext,
    spec: FactorScreeningRuleSpec,
    candidates: Array<{ tsCode: string; kind: EvaluationEvidence['kind'] }>,
  ): Promise<EvaluationEvidence[]> {
    if (!candidates.length) return []
    const [definitions, snapshots] = await Promise.all([
      this.prisma.factorDefinition.findMany({
        where: { name: { in: spec.conditions.map((condition) => condition.factorId) } },
        select: { name: true, label: true },
      }),
      this.prisma.factorSnapshot.findMany({
        where: {
          tradeDate: context.tradeDate,
          factorName: { in: spec.conditions.map((condition) => condition.factorId) },
          tsCode: { in: candidates.map((candidate) => candidate.tsCode) },
        },
        select: { factorName: true, tsCode: true, value: true, percentile: true },
      }),
    ])
    const labels = new Map(definitions.map((definition) => [definition.name, definition.label]))
    const values = new Map<string, Map<string, SnapshotValue>>()
    for (const snapshot of snapshots) {
      const byFactor = values.get(snapshot.tsCode) ?? new Map<string, SnapshotValue>()
      byFactor.set(snapshot.factorName, {
        value: snapshot.value === null ? null : Number(snapshot.value),
        percentile: snapshot.percentile === null ? null : Number(snapshot.percentile),
      })
      values.set(snapshot.tsCode, byFactor)
    }
    return candidates.map((candidate) => ({
      tsCode: candidate.tsCode,
      kind: candidate.kind,
      reason: '股票满足因子筛选规则',
      details: {
        asOfTradeDate: context.tradeDate,
        conditions: spec.conditions.map((condition) => ({
          factorId: condition.factorId,
          label: labels.get(condition.factorId) ?? condition.factorId,
          operator: condition.operator,
          compareValue: condition.value,
          currentValue: values.get(candidate.tsCode)?.get(condition.factorId)?.value ?? null,
          percentile: values.get(candidate.tsCode)?.get(condition.factorId)?.percentile ?? null,
        })),
      },
    }))
  }

  private async resolveUniverse(tradeDate: string, spec: FactorScreeningRuleSpec): Promise<Set<string>> {
    const targetDate = new Date(
      `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}T00:00:00.000Z`,
    )
    const [stocks, dailyCodes] = await Promise.all([
      this.prisma.stockBasic.findMany({
        where: {
          listStatus: 'L',
          AND: [
            { OR: [{ listDate: null }, { listDate: { lte: targetDate } }] },
            { OR: [{ delistDate: null }, { delistDate: { gt: targetDate } }] },
          ],
        },
        select: { tsCode: true, name: true },
      }),
      spec.universe.excludeSuspended
        ? this.prisma.daily.findMany({ where: { tradeDate: targetDate }, select: { tsCode: true } })
        : Promise.resolve([]),
    ])
    const activeDaily = new Set(dailyCodes.map((row) => row.tsCode))
    return new Set(
      stocks
        .filter((stock) => !spec.universe.excludeSt || !isSpecialTreatmentStockName(stock.name))
        .filter((stock) => !spec.universe.excludeBse || !stock.tsCode.endsWith('.BJ'))
        .filter((stock) => !spec.universe.excludeSuspended || activeDaily.has(stock.tsCode))
        .map((stock) => stock.tsCode),
    )
  }

  private assertDefinitions(
    conditions: FactorConditionSpec[],
    definitions: Array<{ name: string; isEnabled: boolean }>,
  ): void {
    const definitionMap = new Map(definitions.map((definition) => [definition.name, definition]))
    for (const condition of conditions) {
      const definition = definitionMap.get(condition.factorId)
      if (!definition)
        throw new BadRequestException({ code: 'RULE_INVALID', message: `因子 ${condition.factorId} 不存在` })
      if (!definition.isEnabled) {
        throw new BadRequestException({ code: 'RULE_INVALID', message: `因子 ${condition.factorId} 已停用` })
      }
    }
  }

  private passedCodes(
    values: Map<string, SnapshotValue>,
    universeCodes: string[],
    condition: FactorConditionSpec,
  ): Set<string> {
    if (condition.operator === 'TOP_PERCENT' || condition.operator === 'BOTTOM_PERCENT') {
      const ranked = universeCodes
        .map((tsCode) => ({ tsCode, value: values.get(tsCode)?.value ?? null }))
        .filter((item): item is { tsCode: string; value: number } => item.value !== null)
        .sort((left, right) =>
          condition.operator === 'TOP_PERCENT' ? right.value - left.value : left.value - right.value,
        )
      const limit = Math.max(1, Math.ceil((ranked.length * (condition.value as number)) / 100))
      return new Set(ranked.slice(0, limit).map((item) => item.tsCode))
    }
    return new Set(
      universeCodes.filter((tsCode) => {
        const value = values.get(tsCode)?.value
        if (value === null || value === undefined) return false
        if (condition.operator === 'GT') return value > (condition.value as number)
        if (condition.operator === 'GTE') return value >= (condition.value as number)
        if (condition.operator === 'LT') return value < (condition.value as number)
        if (condition.operator === 'LTE') return value <= (condition.value as number)
        const [min, max] = condition.value as [number, number]
        return value >= min && value <= max
      }),
    )
  }
}
