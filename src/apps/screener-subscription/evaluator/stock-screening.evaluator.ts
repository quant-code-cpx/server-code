import { Injectable } from '@nestjs/common'
import { StockScreenerService } from 'src/apps/stock/stock-screener.service'
import { ScreenerFiltersDto } from 'src/apps/stock/dto/stock-screener-query.dto'
import { PrismaService } from 'src/shared/prisma.service'
import {
  EvaluationContext,
  EvaluationEvidence,
  EvaluationOutcome,
  SubscriptionEvaluator,
} from './subscription-evaluator.interface'
import { StockScreeningRuleSpec, SubscriptionRuleType } from '../rule'

@Injectable()
export class StockScreeningEvaluator implements SubscriptionEvaluator<StockScreeningRuleSpec> {
  readonly type = SubscriptionRuleType.STOCK_SCREENING

  constructor(
    private readonly stockScreener: StockScreenerService,
    private readonly prisma: PrismaService,
  ) {}

  async evaluate(context: EvaluationContext, spec: StockScreeningRuleSpec): Promise<EvaluationOutcome> {
    const result = await this.stockScreener.screenCodes({
      filters: spec.filters as unknown as ScreenerFiltersDto,
      tradeDate: context.tradeDate,
    })
    const universeCount = await this.prisma.stockBasic.count({
      where: {
        AND: [
          { OR: [{ listDate: null }, { listDate: { lte: this.toDate(context.tradeDate) } }] },
          { OR: [{ delistDate: null }, { delistDate: { gt: this.toDate(context.tradeDate) } }] },
        ],
      },
    })
    return {
      asOfTradeDate: result.tradeDate,
      universeCount,
      matchedCodes: result.matchedCodes,
      dataVersions: { MARKET_DAILY: `asOf:${result.tradeDate}` },
      warnings: [],
    }
  }

  async explain(
    context: EvaluationContext,
    spec: StockScreeningRuleSpec,
    candidates: Array<{ tsCode: string; kind: EvaluationEvidence['kind'] }>,
  ): Promise<EvaluationEvidence[]> {
    return candidates.map((candidate) => ({
      tsCode: candidate.tsCode,
      kind: candidate.kind,
      reason: candidate.kind === 'EXIT' ? '股票不再满足基础选股规则' : '股票满足基础选股规则',
      details: { asOfTradeDate: context.tradeDate, filters: spec.filters },
    }))
  }

  private toDate(tradeDate: string): Date {
    return new Date(`${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}T00:00:00.000Z`)
  }
}
