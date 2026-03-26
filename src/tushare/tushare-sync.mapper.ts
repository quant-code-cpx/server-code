import * as dayjs from 'dayjs'
const timezone = require('dayjs/plugin/timezone')
const utc = require('dayjs/plugin/utc')
import {
  MoneyflowContentType as PrismaMoneyflowContentType,
  Prisma,
  StockExchange as PrismaStockExchange,
  StockListStatus as PrismaStockListStatus,
} from '@prisma/client'
import { MoneyflowContentType, StockExchange, StockListStatus } from 'src/constant/tushare.constant'

dayjs.extend(utc)
dayjs.extend(timezone)

type TushareRecord = Record<string, unknown>

function readString(record: TushareRecord, key: string): string | null {
  const value = record[key]
  if (value === null || value === undefined || value === '') {
    return null
  }
  return String(value)
}

function readNumber(record: TushareRecord, key: string): number | null {
  const value = record[key]
  if (value === null || value === undefined || value === '') {
    return null
  }

  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

function readInt(record: TushareRecord, key: string): number | null {
  const value = readNumber(record, key)
  return value === null ? null : Math.trunc(value)
}

function readDate(record: TushareRecord, key: string): Date | null {
  const value = readString(record, key)
  if (!value) {
    return null
  }

  if (!/^\d{8}$/.test(value)) {
    return null
  }

  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  const parsed = new Date(Date.UTC(year, month - 1, day))

  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function mapExchange(value: string | null): PrismaStockExchange | null {
  switch (value) {
    case StockExchange.SSE:
      return PrismaStockExchange.SSE
    case StockExchange.SZSE:
      return PrismaStockExchange.SZSE
    case StockExchange.BSE:
      return PrismaStockExchange.BSE
    case StockExchange.HKEX:
      return PrismaStockExchange.HKEX
    default:
      return null
  }
}

function mapListStatus(value: string | null): PrismaStockListStatus | null {
  switch (value) {
    case StockListStatus.LISTED:
      return PrismaStockListStatus.L
    case StockListStatus.DELISTED:
      return PrismaStockListStatus.D
    case StockListStatus.PAUSED:
      return PrismaStockListStatus.P
    default:
      return null
  }
}

function mapMoneyflowContentType(value: string | null): PrismaMoneyflowContentType | null {
  switch (value) {
    case MoneyflowContentType.INDUSTRY:
      return PrismaMoneyflowContentType.INDUSTRY
    case MoneyflowContentType.CONCEPT:
      return PrismaMoneyflowContentType.CONCEPT
    case MoneyflowContentType.REGION:
      return PrismaMoneyflowContentType.REGION
    default:
      return null
  }
}

/**
 * 以下映射方法负责将 Tushare 原始返回值转为 Prisma createMany 所需结构；
 * 一方面统一日期 / 数值转换，另一方面将非法枚举值拦截在入库前。
 */
export function mapStockBasicRecord(record: TushareRecord): Prisma.StockBasicCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  if (!tsCode) {
    return null
  }

  return {
    tsCode,
    symbol: readString(record, 'symbol'),
    name: readString(record, 'name'),
    area: readString(record, 'area'),
    industry: readString(record, 'industry'),
    fullname: readString(record, 'fullname'),
    enname: readString(record, 'enname'),
    cnspell: readString(record, 'cnspell'),
    market: readString(record, 'market'),
    exchange: mapExchange(readString(record, 'exchange')) ?? undefined,
    currType: readString(record, 'curr_type'),
    listStatus: mapListStatus(readString(record, 'list_status')) ?? undefined,
    listDate: readDate(record, 'list_date'),
    delistDate: readDate(record, 'delist_date'),
    isHs: readString(record, 'is_hs'),
    actName: readString(record, 'act_name'),
    actEntType: readString(record, 'act_ent_type'),
  }
}

export function mapStockCompanyRecord(record: TushareRecord): Prisma.StockCompanyCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  if (!tsCode) {
    return null
  }

  return {
    tsCode,
    comName: readString(record, 'com_name'),
    comId: readString(record, 'com_id'),
    chairman: readString(record, 'chairman'),
    manager: readString(record, 'manager'),
    secretary: readString(record, 'secretary'),
    regCapital: readNumber(record, 'reg_capital'),
    setupDate: readDate(record, 'setup_date'),
    province: readString(record, 'province'),
    city: readString(record, 'city'),
    introduction: readString(record, 'introduction'),
    website: readString(record, 'website'),
    email: readString(record, 'email'),
    office: readString(record, 'office'),
    annDate: readDate(record, 'ann_date'),
    businessScope: readString(record, 'business_scope'),
    employees: readInt(record, 'employees'),
    mainBusiness: readString(record, 'main_business'),
    exchange: mapExchange(readString(record, 'exchange')) ?? undefined,
  }
}

export function mapTradeCalRecord(record: TushareRecord): Prisma.TradeCalCreateManyInput | null {
  const exchange = mapExchange(readString(record, 'exchange'))
  const calDate = readDate(record, 'cal_date')
  if (!exchange || !calDate) {
    return null
  }

  return {
    exchange,
    calDate,
    isOpen: readString(record, 'is_open'),
    pretradeDate: readDate(record, 'pretrade_date'),
  }
}

function mapOhlcvRecord<
  T extends Prisma.DailyCreateManyInput | Prisma.WeeklyCreateManyInput | Prisma.MonthlyCreateManyInput,
>(record: TushareRecord): Omit<T, 'syncedAt'> | null {
  const tsCode = readString(record, 'ts_code')
  const tradeDate = readDate(record, 'trade_date')
  if (!tsCode || !tradeDate) {
    return null
  }

  return {
    tsCode,
    tradeDate,
    open: readNumber(record, 'open'),
    high: readNumber(record, 'high'),
    low: readNumber(record, 'low'),
    close: readNumber(record, 'close'),
    preClose: readNumber(record, 'pre_close'),
    change: readNumber(record, 'change'),
    pctChg: readNumber(record, 'pct_chg'),
    vol: readNumber(record, 'vol'),
    amount: readNumber(record, 'amount'),
  } as Omit<T, 'syncedAt'>
}

export function mapDailyRecord(record: TushareRecord): Prisma.DailyCreateManyInput | null {
  return mapOhlcvRecord<Prisma.DailyCreateManyInput>(record)
}

export function mapWeeklyRecord(record: TushareRecord): Prisma.WeeklyCreateManyInput | null {
  return mapOhlcvRecord<Prisma.WeeklyCreateManyInput>(record)
}

export function mapMonthlyRecord(record: TushareRecord): Prisma.MonthlyCreateManyInput | null {
  return mapOhlcvRecord<Prisma.MonthlyCreateManyInput>(record)
}

export function mapAdjFactorRecord(record: TushareRecord): Prisma.AdjFactorCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const tradeDate = readDate(record, 'trade_date')
  if (!tsCode || !tradeDate) {
    return null
  }

  return {
    tsCode,
    tradeDate,
    adjFactor: readNumber(record, 'adj_factor'),
  }
}

export function mapDailyBasicRecord(record: TushareRecord): Prisma.DailyBasicCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const tradeDate = readDate(record, 'trade_date')
  if (!tsCode || !tradeDate) {
    return null
  }

  return {
    tsCode,
    tradeDate,
    close: readNumber(record, 'close'),
    turnoverRate: readNumber(record, 'turnover_rate'),
    turnoverRateF: readNumber(record, 'turnover_rate_f'),
    volumeRatio: readNumber(record, 'volume_ratio'),
    pe: readNumber(record, 'pe'),
    peTtm: readNumber(record, 'pe_ttm'),
    pb: readNumber(record, 'pb'),
    ps: readNumber(record, 'ps'),
    psTtm: readNumber(record, 'ps_ttm'),
    dvRatio: readNumber(record, 'dv_ratio'),
    dvTtm: readNumber(record, 'dv_ttm'),
    totalShare: readNumber(record, 'total_share'),
    floatShare: readNumber(record, 'float_share'),
    freeShare: readNumber(record, 'free_share'),
    totalMv: readNumber(record, 'total_mv'),
    circMv: readNumber(record, 'circ_mv'),
    limitStatus: readInt(record, 'limit_status'),
  }
}

export function mapMoneyflowDcRecord(record: TushareRecord): Prisma.MoneyflowDcCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const tradeDate = readDate(record, 'trade_date')
  if (!tsCode || !tradeDate) {
    return null
  }

  return {
    tsCode,
    tradeDate,
    name: readString(record, 'name'),
    pctChange: readNumber(record, 'pct_change'),
    close: readNumber(record, 'close'),
    netAmount: readNumber(record, 'net_amount'),
    netAmountRate: readNumber(record, 'net_amount_rate'),
    buyElgAmount: readNumber(record, 'buy_elg_amount'),
    buyElgAmountRate: readNumber(record, 'buy_elg_amount_rate'),
    buyLgAmount: readNumber(record, 'buy_lg_amount'),
    buyLgAmountRate: readNumber(record, 'buy_lg_amount_rate'),
    buyMdAmount: readNumber(record, 'buy_md_amount'),
    buyMdAmountRate: readNumber(record, 'buy_md_amount_rate'),
    buySmAmount: readNumber(record, 'buy_sm_amount'),
    buySmAmountRate: readNumber(record, 'buy_sm_amount_rate'),
  }
}

export function mapMoneyflowIndDcRecord(record: TushareRecord): Prisma.MoneyflowIndDcCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const tradeDate = readDate(record, 'trade_date')
  const contentType = mapMoneyflowContentType(readString(record, 'content_type'))
  if (!tsCode || !tradeDate || !contentType) {
    return null
  }

  return {
    tsCode,
    tradeDate,
    contentType,
    name: readString(record, 'name'),
    pctChange: readNumber(record, 'pct_change'),
    close: readNumber(record, 'close'),
    netAmount: readNumber(record, 'net_amount'),
    netAmountRate: readNumber(record, 'net_amount_rate'),
    buyElgAmount: readNumber(record, 'buy_elg_amount'),
    buyElgAmountRate: readNumber(record, 'buy_elg_amount_rate'),
    buyLgAmount: readNumber(record, 'buy_lg_amount'),
    buyLgAmountRate: readNumber(record, 'buy_lg_amount_rate'),
    buyMdAmount: readNumber(record, 'buy_md_amount'),
    buyMdAmountRate: readNumber(record, 'buy_md_amount_rate'),
    buySmAmount: readNumber(record, 'buy_sm_amount'),
    buySmAmountRate: readNumber(record, 'buy_sm_amount_rate'),
    buySmAmountStock: readString(record, 'buy_sm_amount_stock'),
    rank: readInt(record, 'rank'),
  }
}

export function mapMoneyflowMktDcRecord(record: TushareRecord): Prisma.MoneyflowMktDcCreateManyInput | null {
  const tradeDate = readDate(record, 'trade_date')
  if (!tradeDate) {
    return null
  }

  return {
    tradeDate,
    closeSh: readNumber(record, 'close_sh'),
    pctChangeSh: readNumber(record, 'pct_change_sh'),
    closeSz: readNumber(record, 'close_sz'),
    pctChangeSz: readNumber(record, 'pct_change_sz'),
    netAmount: readNumber(record, 'net_amount'),
    netAmountRate: readNumber(record, 'net_amount_rate'),
    buyElgAmount: readNumber(record, 'buy_elg_amount'),
    buyElgAmountRate: readNumber(record, 'buy_elg_amount_rate'),
    buyLgAmount: readNumber(record, 'buy_lg_amount'),
    buyLgAmountRate: readNumber(record, 'buy_lg_amount_rate'),
    buyMdAmount: readNumber(record, 'buy_md_amount'),
    buyMdAmountRate: readNumber(record, 'buy_md_amount_rate'),
    buySmAmount: readNumber(record, 'buy_sm_amount'),
    buySmAmountRate: readNumber(record, 'buy_sm_amount_rate'),
  }
}

export function mapIncomeRecord(record: TushareRecord): Prisma.IncomeCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const endDate = readDate(record, 'end_date')
  if (!tsCode || !endDate) {
    return null
  }

  return {
    tsCode,
    annDate: readDate(record, 'ann_date'),
    fAnnDate: readDate(record, 'f_ann_date'),
    endDate,
    reportType: readString(record, 'report_type'),
    compType: readString(record, 'comp_type'),
    endType: readString(record, 'end_type'),
    basicEps: readNumber(record, 'basic_eps'),
    dilutedEps: readNumber(record, 'diluted_eps'),
    totalRevenue: readNumber(record, 'total_revenue'),
    revenue: readNumber(record, 'revenue'),
    intIncome: readNumber(record, 'int_income'),
    premEarned: readNumber(record, 'prem_earned'),
    commIncome: readNumber(record, 'comm_income'),
    nCommisIncome: readNumber(record, 'n_commis_income'),
    nOthIncome: readNumber(record, 'n_oth_income'),
    nOthBIncome: readNumber(record, 'n_oth_b_income'),
    premIncome: readNumber(record, 'prem_income'),
    outPrem: readNumber(record, 'out_prem'),
    unePremReser: readNumber(record, 'une_prem_reser'),
    reinsIncome: readNumber(record, 'reins_income'),
    nSecTbIncome: readNumber(record, 'n_sec_tb_income'),
    nSecUwIncome: readNumber(record, 'n_sec_uw_income'),
    nAssetMgIncome: readNumber(record, 'n_asset_mg_income'),
    othBIncome: readNumber(record, 'oth_b_income'),
    fvValueChgGain: readNumber(record, 'fv_value_chg_gain'),
    investIncome: readNumber(record, 'invest_income'),
    assInvestIncome: readNumber(record, 'ass_invest_income'),
    forexGain: readNumber(record, 'forex_gain'),
    totalCogs: readNumber(record, 'total_cogs'),
    operCost: readNumber(record, 'oper_cost'),
    intExp: readNumber(record, 'int_exp'),
    commExp: readNumber(record, 'comm_exp'),
    bizTaxSurchg: readNumber(record, 'biz_tax_surchg'),
    sellExp: readNumber(record, 'sell_exp'),
    adminExp: readNumber(record, 'admin_exp'),
    finExp: readNumber(record, 'fin_exp'),
    assetsImpairLoss: readNumber(record, 'assets_impair_loss'),
    premRefund: readNumber(record, 'prem_refund'),
    compensPayout: readNumber(record, 'compens_payout'),
    reserInsurLiab: readNumber(record, 'reser_insur_liab'),
    divPayt: readNumber(record, 'div_payt'),
    reinsExp: readNumber(record, 'reins_exp'),
    operExp: readNumber(record, 'oper_exp'),
    compensPayoutRefu: readNumber(record, 'compens_payout_refu'),
    insurReserRefu: readNumber(record, 'insur_reser_refu'),
    reinsCostRefund: readNumber(record, 'reins_cost_refund'),
    otherBusCost: readNumber(record, 'other_bus_cost'),
    operateProfit: readNumber(record, 'operate_profit'),
    nonOperIncome: readNumber(record, 'non_oper_income'),
    nonOperExp: readNumber(record, 'non_oper_exp'),
    ncaDisploss: readNumber(record, 'nca_disploss'),
    totalProfit: readNumber(record, 'total_profit'),
    incomeTax: readNumber(record, 'income_tax'),
    nIncome: readNumber(record, 'n_income'),
    nIncomeAttrP: readNumber(record, 'n_income_attr_p'),
    minorityGain: readNumber(record, 'minority_gain'),
    othComprIncome: readNumber(record, 'oth_compr_income'),
    tComprIncome: readNumber(record, 't_compr_income'),
    comprIncAttrP: readNumber(record, 'compr_inc_attr_p'),
    comprIncAttrMS: readNumber(record, 'compr_inc_attr_m_s'),
    ebit: readNumber(record, 'ebit'),
    ebitda: readNumber(record, 'ebitda'),
    insuranceExp: readNumber(record, 'insurance_exp'),
    undistProfit: readNumber(record, 'undist_profit'),
    distableProfit: readNumber(record, 'distable_profit'),
    rdExp: readNumber(record, 'rd_exp'),
    finExpIntExp: readNumber(record, 'fin_exp_int_exp'),
    finExpIntInc: readNumber(record, 'fin_exp_int_inc'),
    transferSurplusRese: readNumber(record, 'transfer_surplus_rese'),
    transferHousingImprest: readNumber(record, 'transfer_housing_imprest'),
    transferOth: readNumber(record, 'transfer_oth'),
    adjLossgain: readNumber(record, 'adj_lossgain'),
    withdraLegalSurplus: readNumber(record, 'withdra_legal_surplus'),
    withdraLegalPubfund: readNumber(record, 'withdra_legal_pubfund'),
    withdraBizDevfund: readNumber(record, 'withdra_biz_devfund'),
    withdraReseFund: readNumber(record, 'withdra_rese_fund'),
    withdraOthErsu: readNumber(record, 'withdra_oth_ersu'),
    workersWelfare: readNumber(record, 'workers_welfare'),
    distrProfitShrhder: readNumber(record, 'distr_profit_shrhder'),
    prfsharePayableDvd: readNumber(record, 'prfshare_payable_dvd'),
    comsharePayableDvd: readNumber(record, 'comshare_payable_dvd'),
    capitComstockDiv: readNumber(record, 'capit_comstock_div'),
    netAfterNrLpCorrect: readNumber(record, 'net_after_nr_lp_correct'),
    creditImpaLoss: readNumber(record, 'credit_impa_loss'),
    netExpoHedgingBenefits: readNumber(record, 'net_expo_hedging_benefits'),
    othImpairLossAssets: readNumber(record, 'oth_impair_loss_assets'),
    totalOpcost: readNumber(record, 'total_opcost'),
    amodcostFinAssets: readNumber(record, 'amodcost_fin_assets'),
    othIncome: readNumber(record, 'oth_income'),
    assetDispIncome: readNumber(record, 'asset_disp_income'),
    continuedNetProfit: readNumber(record, 'continued_net_profit'),
    endNetProfit: readNumber(record, 'end_net_profit'),
    updateFlag: readString(record, 'update_flag'),
  }
}

export function mapExpressRecord(record: TushareRecord): Prisma.ExpressCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const annDate = readDate(record, 'ann_date')
  const endDate = readDate(record, 'end_date')
  if (!tsCode || !annDate || !endDate) {
    return null
  }

  return {
    tsCode,
    annDate,
    endDate,
    revenue: readNumber(record, 'revenue'),
    operateProfit: readNumber(record, 'operate_profit'),
    totalProfit: readNumber(record, 'total_profit'),
    nIncome: readNumber(record, 'n_income'),
    totalAssets: readNumber(record, 'total_assets'),
    totalHldrEqyExcMinInt: readNumber(record, 'total_hldr_eqy_exc_min_int'),
    dilutedEps: readNumber(record, 'diluted_eps'),
    dilutedRoe: readNumber(record, 'diluted_roe'),
    yoyNetProfit: readNumber(record, 'yoy_net_profit'),
    bps: readNumber(record, 'bps'),
    yoySales: readNumber(record, 'yoy_sales'),
    yoyOp: readNumber(record, 'yoy_op'),
    yoyTp: readNumber(record, 'yoy_tp'),
    yoyDeduNp: readNumber(record, 'yoy_dedu_np'),
    yoyEps: readNumber(record, 'yoy_eps'),
    yoyRoe: readNumber(record, 'yoy_roe'),
    growthAssets: readNumber(record, 'growth_assets'),
    yoyEquity: readNumber(record, 'yoy_equity'),
    growthBps: readNumber(record, 'growth_bps'),
    orLastYear: readNumber(record, 'or_last_year'),
    opLastYear: readNumber(record, 'op_last_year'),
    tpLastYear: readNumber(record, 'tp_last_year'),
    npLastYear: readNumber(record, 'np_last_year'),
    epsLastYear: readNumber(record, 'eps_last_year'),
    openNetAssets: readNumber(record, 'open_net_assets'),
    openBps: readNumber(record, 'open_bps'),
    perfSummary: readString(record, 'perf_summary'),
    isAudit: readInt(record, 'is_audit'),
    remark: readString(record, 'remark'),
    updateFlag: readString(record, 'update_flag'),
  }
}

export function mapFinaIndicatorRecord(record: TushareRecord): Prisma.FinaIndicatorCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const endDate = readDate(record, 'end_date')
  if (!tsCode || !endDate) {
    return null
  }

  return {
    tsCode,
    annDate: readDate(record, 'ann_date'),
    endDate,
    eps: readNumber(record, 'eps'),
    dtEps: readNumber(record, 'dt_eps'),
    totalRevenuePers: readNumber(record, 'total_revenue_ps'),
    revenuePers: readNumber(record, 'revenue_ps'),
    grossprofit_margin: readNumber(record, 'grossprofit_margin'),
    netprofit_margin: readNumber(record, 'netprofit_margin'),
    roe: readNumber(record, 'roe'),
    dtRoe: readNumber(record, 'roe_dt'),
    roa: readNumber(record, 'roa'),
    roa2: readNumber(record, 'roic'),
    debtToAssets: readNumber(record, 'debt_to_assets'),
    currentRatio: readNumber(record, 'current_ratio'),
    quickRatio: readNumber(record, 'quick_ratio'),
    cashRatio: readNumber(record, 'cash_ratio'),
    fcff: readNumber(record, 'fcff'),
    fcfe: readNumber(record, 'fcfe'),
    ebit: readNumber(record, 'ebit'),
    ebitda: readNumber(record, 'ebitda'),
    netdebt: readNumber(record, 'netdebt'),
    ocfToNetprofit: readNumber(record, 'ocf_to_netprofit'),
    ocfToOr: readNumber(record, 'ocf_to_or'),
    revenueYoy: readNumber(record, 'or_yoy'),
    netprofitYoy: readNumber(record, 'netprofit_yoy'),
    ocfYoy: readNumber(record, 'ocf_yoy'),
    dtEpsYoy: readNumber(record, 'dt_eps_yoy'),
    roeYoy: readNumber(record, 'roe_yoy'),
    bpsYoy: readNumber(record, 'bps_yoy'),
    assetsYoy: readNumber(record, 'assets_yoy'),
    eqtYoy: readNumber(record, 'eqt_yoy'),
    trYoy: readNumber(record, 'tr_yoy'),
  }
}

export function mapDividendRecord(record: TushareRecord): Prisma.DividendCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  if (!tsCode) {
    return null
  }

  return {
    tsCode,
    annDate: readDate(record, 'ann_date'),
    endDate: readDate(record, 'end_date'),
    divProc: readString(record, 'div_proc'),
    stkDiv: readNumber(record, 'stk_div'),
    stkBoRate: readNumber(record, 'stk_bo_rate'),
    stkCoRate: readNumber(record, 'stk_co_rate'),
    cashDiv: readNumber(record, 'cash_div'),
    cashDivTax: readNumber(record, 'cash_div_tax'),
    recordDate: readDate(record, 'record_date'),
    exDate: readDate(record, 'ex_date'),
    payDate: readDate(record, 'pay_date'),
    divListdate: readDate(record, 'div_listdate'),
    impAnnDate: readDate(record, 'imp_ann_date'),
    baseDate: readDate(record, 'base_date'),
    baseShare: readNumber(record, 'base_share'),
  }
}

export function mapTop10HoldersRecord(record: TushareRecord): Prisma.Top10HoldersCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const endDate = readDate(record, 'end_date')
  const holderName = readString(record, 'holder_name')
  if (!tsCode || !endDate || !holderName) {
    return null
  }

  return {
    tsCode,
    annDate: readDate(record, 'ann_date'),
    endDate,
    holderName,
    holdAmount: readNumber(record, 'hold_amount'),
    holdRatio: readNumber(record, 'hold_ratio'),
    holdFloatRatio: readNumber(record, 'hold_float_ratio'),
    holdChange: readNumber(record, 'hold_change'),
    holderType: readString(record, 'holder_type'),
  }
}

export function mapTop10FloatHoldersRecord(record: TushareRecord): Prisma.Top10FloatHoldersCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const endDate = readDate(record, 'end_date')
  const holderName = readString(record, 'holder_name')
  if (!tsCode || !endDate || !holderName) {
    return null
  }

  return {
    tsCode,
    annDate: readDate(record, 'ann_date'),
    endDate,
    holderName,
    holdAmount: readNumber(record, 'hold_amount'),
    holdRatio: readNumber(record, 'hold_ratio'),
    holdFloatRatio: readNumber(record, 'hold_float_ratio'),
    holdChange: readNumber(record, 'hold_change'),
    holderType: readString(record, 'holder_type'),
  }
}

export function mapIndexDailyRecord(record: TushareRecord): Prisma.IndexDailyCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const tradeDate = readDate(record, 'trade_date')
  if (!tsCode || !tradeDate) {
    return null
  }

  return {
    tsCode,
    tradeDate,
    open: readNumber(record, 'open'),
    high: readNumber(record, 'high'),
    low: readNumber(record, 'low'),
    close: readNumber(record, 'close'),
    preClose: readNumber(record, 'pre_close'),
    change: readNumber(record, 'change'),
    pctChg: readNumber(record, 'pct_chg'),
    vol: readNumber(record, 'vol'),
    amount: readNumber(record, 'amount'),
  }
}

export function mapMoneyflowHsgtRecord(record: TushareRecord): Prisma.MoneyflowHsgtCreateManyInput | null {
  const tradeDate = readDate(record, 'trade_date')
  if (!tradeDate) {
    return null
  }

  return {
    tradeDate,
    ggtSs: readNumber(record, 'ggt_ss'),
    ggtSz: readNumber(record, 'ggt_sz'),
    hgt: readNumber(record, 'hgt'),
    sgt: readNumber(record, 'sgt'),
    northMoney: readNumber(record, 'north_money'),
    southMoney: readNumber(record, 'south_money'),
  }
}
