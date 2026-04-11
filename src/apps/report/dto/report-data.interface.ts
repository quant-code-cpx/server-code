/** 回测报告结构化数据 */
export interface BacktestReportData {
  strategy: {
    name: string
    params: Record<string, unknown>
    startDate: string
    endDate: string
    benchmark: string
    initialCapital: number
  }

  metrics: {
    totalReturn: number | null
    annualizedReturn: number | null
    benchmarkReturn: number | null
    excessReturn: number | null
    maxDrawdown: number | null
    sharpeRatio: number | null
    sortinoRatio: number | null
    calmarRatio: number | null
    winRate: number | null
    tradeCount: number | null
    volatility: number | null
    alpha: number | null
    beta: number | null
  }

  navCurve: {
    dates: string[]
    navValues: number[]
    benchmarkValues: number[]
  }

  drawdownCurve: {
    dates: string[]
    values: number[]
  }

  monthlyReturns: {
    year: number
    month: number
    return: number
  }[]

  trades: {
    date: string
    tsCode: string
    side: string
    price: number
    quantity: number
    amount: number
  }[]

  endPositions: {
    tsCode: string
    quantity: number
    weight: number | null
    unrealizedPnl: number | null
  }[]
}

/** 个股研报结构化数据 */
export interface StockReportData {
  overview: {
    tsCode: string
    name: string | null
    industry: string | null
    listDate: string | null
    area: string | null
  }

  priceHistory: {
    dates: string[]
    opens: number[]
    highs: number[]
    lows: number[]
    closes: number[]
    volumes: number[]
  }

  technicalIndicators: Record<string, unknown> | null

  financialSummary: {
    periods: string[]
    roe: (number | null)[]
    netProfitMargin: (number | null)[]
    revenueYoyGrowth: (number | null)[]
  } | null

  top10Holders: {
    holderName: string | null
    holdAmount: number | null
    holdRatio: number | null
  }[]

  dividends: {
    endDate: string | null
    divProc: string | null
    cashDivTax: number | null
    stkDiv: number | null
  }[]
}

/** 组合分析报告结构化数据 */
export interface PortfolioReportData {
  overview: {
    id: string
    name: string
    description: string | null
    totalMarketValue: number
    totalCost: number
    totalPnl: number
    createdAt: string
  }

  holdings: {
    tsCode: string
    name: string | null
    quantity: number
    costPrice: number
    currentPrice: number | null
    marketValue: number | null
    weight: number | null
    pnl: number | null
    pnlPct: number | null
  }[]

  industryDistribution: {
    industry: string
    weight: number
    count: number
  }[]
}
