import { Injectable } from '@nestjs/common'
import type { Income, BalanceSheet, Cashflow } from '@prisma/client'
import { PrismaService } from 'src/shared/prisma.service'
import { FinancialSyncService } from 'src/tushare/sync/financial-sync.service'
import { StockDetailFinancialsDto } from './dto/stock-detail-financials.dto'
import { StockDetailShareholdersDto } from './dto/stock-detail-shareholders.dto'
import { StockDetailShareCapitalDto } from './dto/stock-detail-share-capital.dto'
import { StockDetailFinancingDto } from './dto/stock-detail-financing.dto'
import { StockDetailFinancialStatementsDto } from './dto/stock-detail-financial-statements.dto'

// ─── 三大财务报表工具函数 ──────────────────────────────────────────────────────

/** 将 Date 格式化为 YYYYMMDD 字符串，用于查找同比期 */
function fmtPeriodKey(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/** 返回同比期 key（上一年同季度，YYYYMMDD） */
function prevYearKey(date: Date): string {
  const y = date.getUTCFullYear() - 1
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/** 计算同比变动率（%），若上年值为零或空则返回 null */
function yoy(curr: number | null, prev: number | null): number | null {
  if (curr === null || prev === null || prev === 0) return null
  return Math.round(((curr - prev) / Math.abs(prev)) * 10000) / 100
}

function buildIncomeItems(rows: Income[], limit: number) {
  // rows 已按 endDate desc 排序
  const byKey = new Map<string, any>()
  for (const r of rows) byKey.set(fmtPeriodKey(r.endDate), r)

  return rows.slice(0, limit).map((r) => {
    const prev = byKey.get(prevYearKey(r.endDate)) ?? null
    return {
      endDate: r.endDate,
      annDate: r.annDate,
      reportType: r.reportType,
      totalRevenue: r.totalRevenue,
      revenue: r.revenue,
      operateProfit: r.operateProfit,
      totalProfit: r.totalProfit,
      nIncome: r.nIncome,
      nIncomeAttrP: r.nIncomeAttrP,
      basicEps: r.basicEps,
      sellExp: r.sellExp,
      adminExp: r.adminExp,
      finExp: r.finExp,
      rdExp: r.rdExp,
      ebit: r.ebit,
      ebitda: r.ebitda,
      totalRevenueYoy: prev ? yoy(r.totalRevenue, prev.totalRevenue) : null,
      nIncomeYoy: prev ? yoy(r.nIncome, prev.nIncome) : null,
      operateProfitYoy: prev ? yoy(r.operateProfit, prev.operateProfit) : null,
    }
  })
}

function buildBalanceSheetItems(rows: BalanceSheet[], limit: number) {
  const byKey = new Map<string, any>()
  for (const r of rows) byKey.set(fmtPeriodKey(r.endDate), r)

  return rows.slice(0, limit).map((r) => {
    const prev = byKey.get(prevYearKey(r.endDate)) ?? null
    return {
      endDate: r.endDate,
      annDate: r.annDate,
      reportType: r.reportType,
      totalAssets: r.totalAssets,
      totalCurAssets: r.totalCurAssets,
      totalNca: r.totalNca,
      moneyCap: r.moneyCap,
      inventories: r.inventories,
      accountsReceiv: r.accountsReceiv,
      totalLiab: r.totalLiab,
      totalCurLiab: r.totalCurLiab,
      totalNcl: r.totalNcl,
      stBorr: r.stBorr,
      ltBorr: r.ltBorr,
      totalHldrEqyExcMinInt: r.totalHldrEqyExcMinInt,
      totalHldrEqyIncMinInt: r.totalHldrEqyIncMinInt,
      totalAssetsYoy: prev ? yoy(r.totalAssets, prev.totalAssets) : null,
      equityYoy: prev ? yoy(r.totalHldrEqyExcMinInt, prev.totalHldrEqyExcMinInt) : null,
    }
  })
}

function buildCashflowItems(rows: Cashflow[], limit: number) {
  const byKey = new Map<string, any>()
  for (const r of rows) byKey.set(fmtPeriodKey(r.endDate), r)

  return rows.slice(0, limit).map((r) => {
    const prev = byKey.get(prevYearKey(r.endDate)) ?? null
    return {
      endDate: r.endDate,
      annDate: r.annDate,
      reportType: r.reportType,
      nCashflowAct: r.nCashflowAct,
      nCashflowInvAct: r.nCashflowInvAct,
      nCashFlowsFncAct: r.nCashFlowsFncAct,
      freeCashflow: r.freeCashflow,
      nIncrCashCashEqu: r.nIncrCashCashEqu,
      cFrSaleSg: r.cFrSaleSg,
      cPaidGoodsS: r.cPaidGoodsS,
      nCashflowActYoy: prev ? yoy(r.nCashflowAct, prev.nCashflowAct) : null,
      freeCashflowYoy: prev ? yoy(r.freeCashflow, prev.freeCashflow) : null,
    }
  })
}

@Injectable()
export class StockFinancialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialSyncService: FinancialSyncService,
  ) {}

  async getDetailFinancials({ tsCode, periods = 8 }: StockDetailFinancialsDto) {
    const finaRecords = await this.prisma.finaIndicator.findMany({
      where: { tsCode },
      orderBy: { endDate: 'desc' },
      take: periods,
    })

    const history = [...finaRecords].reverse().map((r) => ({
      endDate: r.endDate,
      annDate: r.annDate,
      eps: r.eps,
      dtEps: r.dtEps,
      roe: r.roe,
      dtRoe: r.dtRoe,
      roa: r.roa,
      grossprofit_margin: r.grossprofit_margin,
      netprofit_margin: r.netprofit_margin,
      debtToAssets: r.debtToAssets,
      currentRatio: r.currentRatio,
      quickRatio: r.quickRatio,
      revenueYoy: r.revenueYoy,
      netprofitYoy: r.netprofitYoy,
      ocfToNetprofit: r.ocfToNetprofit,
      fcff: r.fcff,
    }))

    const latest = history[history.length - 1] ?? null

    // 同时返回最近几期业绩快报（作为更实时的财务补充）
    const expressRecords = await this.prisma.express.findMany({
      where: { tsCode },
      orderBy: { annDate: 'desc' },
      take: 4,
    })

    return {
      tsCode,
      latest,
      history,
      recentExpress: expressRecords.map((e) => ({
        annDate: e.annDate,
        endDate: e.endDate,
        revenue: e.revenue,
        nIncome: e.nIncome,
        dilutedEps: e.dilutedEps,
        dilutedRoe: e.dilutedRoe,
        yoyNetProfit: e.yoyNetProfit,
        yoySales: e.yoySales,
      })),
    }
  }

  async getDetailShareholders({ tsCode }: StockDetailShareholdersDto) {
    const [top10, top10Float] = await Promise.all([
      // 取最近 4 个报告期的前十大股东
      this.prisma.top10Holders.findMany({
        where: { tsCode },
        orderBy: { endDate: 'desc' },
        take: 40,
      }),
      this.prisma.top10FloatHolders.findMany({
        where: { tsCode },
        orderBy: { endDate: 'desc' },
        take: 40,
      }),
    ])

    // 将 top10Holders 按 endDate 分组，返回最新一期，按持股数量降序
    const latestHolderPeriod = top10[0]?.endDate ?? null
    const latestHolders = latestHolderPeriod
      ? top10
          .filter((h) => h.endDate.getTime() === latestHolderPeriod.getTime())
          .sort((a, b) => (b.holdAmount ?? 0) - (a.holdAmount ?? 0))
      : []

    const latestFloatPeriod = top10Float[0]?.endDate ?? null
    const latestFloatHolders = latestFloatPeriod
      ? top10Float
          .filter((h) => h.endDate.getTime() === latestFloatPeriod.getTime())
          .sort((a, b) => (b.holdAmount ?? 0) - (a.holdAmount ?? 0))
      : []

    return {
      tsCode,
      top10Holders: {
        endDate: latestHolderPeriod,
        holders: latestHolders.map((h) => ({
          holderName: h.holderName,
          holdAmount: h.holdAmount,
          holdRatio: h.holdRatio,
          holdFloatRatio: h.holdFloatRatio,
          holdChange: h.holdChange,
          holderType: h.holderType,
          annDate: h.annDate,
        })),
      },
      top10FloatHolders: {
        endDate: latestFloatPeriod,
        holders: latestFloatHolders.map((h) => ({
          holderName: h.holderName,
          holdAmount: h.holdAmount,
          holdRatio: h.holdRatio,
          holdFloatRatio: h.holdFloatRatio,
          holdChange: h.holdChange,
          holderType: h.holderType,
          annDate: h.annDate,
        })),
      },
    }
  }

  async getDetailDividendFinancing({ tsCode }: StockDetailFinancingDto) {
    // 仅返回分红历史（配股逻辑已移除）
    const localDividendCount = await this.prisma.dividend.count({ where: { tsCode } })
    if (localDividendCount === 0) {
      await this.financialSyncService.syncDividendsForStock(tsCode).catch(() => {})
    }

    const dividends = await this.prisma.dividend.findMany({
      where: { tsCode },
      orderBy: { annDate: 'desc' },
    })

    return {
      tsCode,
      dividends: dividends.map((d) => ({
        annDate: d.annDate,
        endDate: d.endDate,
        divProc: d.divProc,
        stkDiv: d.stkDiv,
        stkBoRate: d.stkBoRate,
        stkCoRate: d.stkCoRate,
        cashDiv: d.cashDiv,
        cashDivTax: d.cashDivTax,
        recordDate: d.recordDate,
        exDate: d.exDate,
        payDate: d.payDate,
        divListdate: d.divListdate,
        impAnnDate: d.impAnnDate,
        baseDate: d.baseDate,
        baseShare: d.baseShare,
      })),
    }
  }

  async getDetailShareCapital({ tsCode }: StockDetailShareCapitalDto) {
    const latestRecord = await this.prisma.dailyBasic.findFirst({
      where: { tsCode },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true, totalShare: true, floatShare: true, freeShare: true },
    })

    const latest =
      latestRecord && latestRecord.totalShare !== null && latestRecord.floatShare !== null
        ? {
            totalShare: latestRecord.totalShare,
            floatShare: latestRecord.floatShare,
            freeShare: latestRecord.freeShare ?? latestRecord.floatShare,
            restrictedShare: latestRecord.totalShare - latestRecord.floatShare,
            announceDate: latestRecord.tradeDate,
          }
        : null

    interface ShareCapitalHistoryRow {
      tradeDate: Date
      totalShare: number | null
      floatShare: number | null
    }

    const historyRows = await this.prisma.$queryRaw<ShareCapitalHistoryRow[]>`
      SELECT DISTINCT ON (EXTRACT(YEAR FROM trade_date))
        trade_date AS "tradeDate",
        total_share AS "totalShare",
        float_share AS "floatShare"
      FROM stock_daily_valuation_metrics
      WHERE ts_code = ${tsCode}
      ORDER BY EXTRACT(YEAR FROM trade_date) DESC, trade_date DESC
      LIMIT 10
    `

    const history = historyRows.map((r) => ({
      changeDate: r.tradeDate,
      totalShare: r.totalShare,
      floatShare: r.floatShare,
      changeReason: '定期披露',
    }))

    return { tsCode, latest, history }
  }

  async getDetailFinancialStatements({ tsCode, periods = 8 }: StockDetailFinancialStatementsDto) {
    // 多取 4 期以便计算最早一期的同比
    const fetchLimit = periods + 4

    const [incomeRows, balanceRows, cashflowRows] = await Promise.all([
      this.prisma.income.findMany({
        where: { tsCode, reportType: '1' },
        orderBy: { endDate: 'desc' },
        take: fetchLimit,
      }),
      this.prisma.balanceSheet.findMany({
        where: { tsCode, reportType: '1' },
        orderBy: { endDate: 'desc' },
        take: fetchLimit,
      }),
      this.prisma.cashflow.findMany({
        where: { tsCode, reportType: '1' },
        orderBy: { endDate: 'desc' },
        take: fetchLimit,
      }),
    ])

    return {
      tsCode,
      income: buildIncomeItems(incomeRows, periods),
      balanceSheet: buildBalanceSheetItems(balanceRows, periods),
      cashflow: buildCashflowItems(cashflowRows, periods),
    }
  }

  async getDetailFinancing({ tsCode }: StockDetailFinancingDto) {
    // 配股表已移除：返回空列表（保留接口兼容）
    return { tsCode, items: [] }
  }
}
