import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/shared/prisma.service'
import { StockDetailMoneyFlowDto } from './dto/stock-detail-money-flow.dto'

@Injectable()
export class StockMoneyFlowService {
  constructor(private readonly prisma: PrismaService) {}

  async getDetailTodayFlow(tsCode: string) {
    const record = await this.prisma.moneyflow.findFirst({
      where: { tsCode },
      orderBy: { tradeDate: 'desc' },
    })

    if (!record) return null

    const r2 = (v: number | null | undefined) => (v != null ? Math.round(v * 100) / 100 : null)

    const buyElg = r2(record.buyElgAmount)
    const sellElg = r2(record.sellElgAmount)
    const buyLg = r2(record.buyLgAmount)
    const sellLg = r2(record.sellLgAmount)
    const buyMd = r2(record.buyMdAmount)
    const sellMd = r2(record.sellMdAmount)
    const buySm = r2(record.buySmAmount)
    const sellSm = r2(record.sellSmAmount)

    const net = (buy: number | null, sell: number | null) => (buy != null && sell != null ? r2(buy - sell) : null)

    const mainBuy = buyElg != null && buyLg != null ? r2(buyElg + buyLg) : null
    const mainSell = sellElg != null && sellLg != null ? r2(sellElg + sellLg) : null

    return {
      tsCode,
      tradeDate: record.tradeDate,
      superLarge: { buyAmount: buyElg, sellAmount: sellElg, netAmount: net(buyElg, sellElg) },
      large: { buyAmount: buyLg, sellAmount: sellLg, netAmount: net(buyLg, sellLg) },
      medium: { buyAmount: buyMd, sellAmount: sellMd, netAmount: net(buyMd, sellMd) },
      small: { buyAmount: buySm, sellAmount: sellSm, netAmount: net(buySm, sellSm) },
      mainForce: { buyAmount: mainBuy, sellAmount: mainSell, netAmount: net(mainBuy, mainSell) },
      netMfAmount: r2(record.netMfAmount),
    }
  }

  async getDetailMoneyFlow({ tsCode, days = 60 }: StockDetailMoneyFlowDto) {
    interface MoneyFlowRow {
      tradeDate: Date
      close: number | null
      pctChg: number | null
      netMfAmount: number | null
      buyElgAmount: number | null
      sellElgAmount: number | null
      buyLgAmount: number | null
      sellLgAmount: number | null
      buyMdAmount: number | null
      sellMdAmount: number | null
      buySmAmount: number | null
      sellSmAmount: number | null
    }

    const records = await this.prisma.$queryRaw<MoneyFlowRow[]>`
      SELECT
        mf.trade_date        AS "tradeDate",
        d.close,
        d.pct_chg            AS "pctChg",
        mf.net_mf_amount     AS "netMfAmount",
        mf.buy_elg_amount    AS "buyElgAmount",
        mf.sell_elg_amount   AS "sellElgAmount",
        mf.buy_lg_amount     AS "buyLgAmount",
        mf.sell_lg_amount    AS "sellLgAmount",
        mf.buy_md_amount     AS "buyMdAmount",
        mf.sell_md_amount    AS "sellMdAmount",
        mf.buy_sm_amount     AS "buySmAmount",
        mf.sell_sm_amount    AS "sellSmAmount"
      FROM stock_capital_flows mf
      LEFT JOIN stock_daily_prices d
        ON d.ts_code = mf.ts_code AND d.trade_date = mf.trade_date
      WHERE mf.ts_code = ${tsCode}
      ORDER BY mf.trade_date DESC
      LIMIT ${days}
    `

    // 汇总 5 / 20 / 60 日净流入
    const summarize = (n: number) => records.slice(0, n).reduce((acc, r) => acc + (r.netMfAmount ?? 0), 0)

    const items = [...records].reverse().map((r) => ({
      tradeDate: r.tradeDate,
      close: r.close,
      pctChg: r.pctChg,
      netMfAmount: r.netMfAmount,
      buyElgAmount: r.buyElgAmount,
      sellElgAmount: r.sellElgAmount,
      buyLgAmount: r.buyLgAmount,
      sellLgAmount: r.sellLgAmount,
      buyMdAmount: r.buyMdAmount,
      sellMdAmount: r.sellMdAmount,
      buySmAmount: r.buySmAmount,
      sellSmAmount: r.sellSmAmount,
    }))

    return {
      tsCode,
      summary: {
        netMfAmount5d: Math.round(summarize(5) * 100) / 100,
        netMfAmount20d: Math.round(summarize(20) * 100) / 100,
        netMfAmount60d: Math.round(summarize(Math.min(60, records.length)) * 100) / 100,
      },
      items,
    }
  }

  async getDetailMainMoneyFlow({ tsCode, days = 60 }: StockDetailMoneyFlowDto) {
    interface MainFlowRow {
      tradeDate: Date
      close: number | null
      pctChg: number | null
      buyElgAmount: number | null
      sellElgAmount: number | null
      buyLgAmount: number | null
      sellLgAmount: number | null
      buyMdAmount: number | null
      sellMdAmount: number | null
      buySmAmount: number | null
      sellSmAmount: number | null
    }

    const records = await this.prisma.$queryRaw<MainFlowRow[]>`
      SELECT
        mf.trade_date        AS "tradeDate",
        d.close,
        d.pct_chg            AS "pctChg",
        mf.buy_elg_amount    AS "buyElgAmount",
        mf.sell_elg_amount   AS "sellElgAmount",
        mf.buy_lg_amount     AS "buyLgAmount",
        mf.sell_lg_amount    AS "sellLgAmount",
        mf.buy_md_amount     AS "buyMdAmount",
        mf.sell_md_amount    AS "sellMdAmount",
        mf.buy_sm_amount     AS "buySmAmount",
        mf.sell_sm_amount    AS "sellSmAmount"
      FROM stock_capital_flows mf
      LEFT JOIN stock_daily_prices d
        ON d.ts_code = mf.ts_code AND d.trade_date = mf.trade_date
      WHERE mf.ts_code = ${tsCode}
      ORDER BY mf.trade_date DESC
      LIMIT ${days}
    `

    const r2 = (v: number) => Math.round(v * 100) / 100

    // 主力 = 特大单 + 大单
    const calcMainNet = (r: MainFlowRow) =>
      (r.buyElgAmount ?? 0) + (r.buyLgAmount ?? 0) - (r.sellElgAmount ?? 0) - (r.sellLgAmount ?? 0)

    const calculateMainNetFlowSum = (n: number) => r2(records.slice(0, n).reduce((acc, r) => acc + calcMainNet(r), 0))

    const formatDate = (d: Date): string => {
      const y = d.getFullYear()
      const m = String(d.getMonth() + 1).padStart(2, '0')
      const day = String(d.getDate()).padStart(2, '0')
      return `${y}${m}${day}`
    }

    const history = [...records].reverse().map((r) => {
      const mainNetInflow = calcMainNet(r)
      const superLargeNetInflow = (r.buyElgAmount ?? 0) - (r.sellElgAmount ?? 0)
      const largeNetInflow = (r.buyLgAmount ?? 0) - (r.sellLgAmount ?? 0)
      const mainBuy = (r.buyElgAmount ?? 0) + (r.buyLgAmount ?? 0)
      const mainSell = (r.sellElgAmount ?? 0) + (r.sellLgAmount ?? 0)
      const mainTotal = mainBuy + mainSell
      const mainNetInflowRate = mainTotal > 0 ? r2((mainNetInflow / mainTotal) * 100) : null
      return {
        tradeDate: formatDate(r.tradeDate),
        close: r.close,
        pctChg: r.pctChg,
        mainNetInflow: r2(mainNetInflow),
        superLargeNetInflow: r2(superLargeNetInflow),
        largeNetInflow: r2(largeNetInflow),
        mainNetInflowRate,
      }
    })

    return {
      tsCode,
      summary: {
        mainNetInflow5d: calculateMainNetFlowSum(Math.min(5, records.length)),
        mainNetInflow10d: calculateMainNetFlowSum(Math.min(10, records.length)),
        mainNetInflow20d: calculateMainNetFlowSum(Math.min(20, records.length)),
        controlDegree: null,
        trend: null,
      },
      history,
    }
  }
}
