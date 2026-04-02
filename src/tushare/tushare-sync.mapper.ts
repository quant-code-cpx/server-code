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

export function mapMoneyflowRecord(record: TushareRecord): Prisma.MoneyflowCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const tradeDate = readDate(record, 'trade_date')
  if (!tsCode || !tradeDate) {
    return null
  }

  return {
    tsCode,
    tradeDate,
    buySmVol: readInt(record, 'buy_sm_vol'),
    buySmAmount: readNumber(record, 'buy_sm_amount'),
    sellSmVol: readInt(record, 'sell_sm_vol'),
    sellSmAmount: readNumber(record, 'sell_sm_amount'),
    buyMdVol: readInt(record, 'buy_md_vol'),
    buyMdAmount: readNumber(record, 'buy_md_amount'),
    sellMdVol: readInt(record, 'sell_md_vol'),
    sellMdAmount: readNumber(record, 'sell_md_amount'),
    buyLgVol: readInt(record, 'buy_lg_vol'),
    buyLgAmount: readNumber(record, 'buy_lg_amount'),
    sellLgVol: readInt(record, 'sell_lg_vol'),
    sellLgAmount: readNumber(record, 'sell_lg_amount'),
    buyElgVol: readInt(record, 'buy_elg_vol'),
    buyElgAmount: readNumber(record, 'buy_elg_amount'),
    sellElgVol: readInt(record, 'sell_elg_vol'),
    sellElgAmount: readNumber(record, 'sell_elg_amount'),
    netMfVol: readInt(record, 'net_mf_vol'),
    netMfAmount: readNumber(record, 'net_mf_amount'),
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

export function mapBalanceSheetRecord(record: TushareRecord): Prisma.BalanceSheetCreateManyInput | null {
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
    totalShare: readNumber(record, 'total_share'),
    capRese: readNumber(record, 'cap_rese'),
    undistrPorfit: readNumber(record, 'undistr_porfit'),
    surplusRese: readNumber(record, 'surplus_rese'),
    specialRese: readNumber(record, 'special_rese'),
    moneyCap: readNumber(record, 'money_cap'),
    tradAsset: readNumber(record, 'trad_asset'),
    notesReceiv: readNumber(record, 'notes_receiv'),
    accountsReceiv: readNumber(record, 'accounts_receiv'),
    othReceiv: readNumber(record, 'oth_receiv'),
    prepayment: readNumber(record, 'prepayment'),
    divReceiv: readNumber(record, 'div_receiv'),
    intReceiv: readNumber(record, 'int_receiv'),
    inventories: readNumber(record, 'inventories'),
    amorExp: readNumber(record, 'amor_exp'),
    ncaWithin1y: readNumber(record, 'nca_within_1y'),
    settRsrv: readNumber(record, 'sett_rsrv'),
    loantoOthBankFi: readNumber(record, 'loanto_oth_bank_fi'),
    premiumReceiv: readNumber(record, 'premium_receiv'),
    reinsurReceiv: readNumber(record, 'reinsur_receiv'),
    reinsurResReceiv: readNumber(record, 'reinsur_res_receiv'),
    purResaleFa: readNumber(record, 'pur_resale_fa'),
    othCurAssets: readNumber(record, 'oth_cur_assets'),
    totalCurAssets: readNumber(record, 'total_cur_assets'),
    faAvailForSale: readNumber(record, 'fa_avail_for_sale'),
    htmInvest: readNumber(record, 'htm_invest'),
    ltEqtInvest: readNumber(record, 'lt_eqt_invest'),
    investRealEstate: readNumber(record, 'invest_real_estate'),
    timeDeposits: readNumber(record, 'time_deposits'),
    othAssets: readNumber(record, 'oth_assets'),
    ltRec: readNumber(record, 'lt_rec'),
    fixAssets: readNumber(record, 'fix_assets'),
    cip: readNumber(record, 'cip'),
    constMaterials: readNumber(record, 'const_materials'),
    fixedAssetsDisp: readNumber(record, 'fixed_assets_disp'),
    producBioAssets: readNumber(record, 'produc_bio_assets'),
    oilAndGasAssets: readNumber(record, 'oil_and_gas_assets'),
    intanAssets: readNumber(record, 'intan_assets'),
    rAndD: readNumber(record, 'r_and_d'),
    goodwill: readNumber(record, 'goodwill'),
    ltAmorExp: readNumber(record, 'lt_amor_exp'),
    deferTaxAssets: readNumber(record, 'defer_tax_assets'),
    decrInDisbur: readNumber(record, 'decr_in_disbur'),
    othNca: readNumber(record, 'oth_nca'),
    totalNca: readNumber(record, 'total_nca'),
    cashReserCb: readNumber(record, 'cash_reser_cb'),
    deposInOthBfi: readNumber(record, 'depos_in_oth_bfi'),
    precMetals: readNumber(record, 'prec_metals'),
    derivAssets: readNumber(record, 'deriv_assets'),
    rrReinsUnePrem: readNumber(record, 'rr_reins_une_prem'),
    rrReinsOutstdCla: readNumber(record, 'rr_reins_outstd_cla'),
    rrReinsLinsLiab: readNumber(record, 'rr_reins_lins_liab'),
    rrReinsLthinsLiab: readNumber(record, 'rr_reins_lthins_liab'),
    refundDepos: readNumber(record, 'refund_depos'),
    phPledgeLoans: readNumber(record, 'ph_pledge_loans'),
    refundCapDepos: readNumber(record, 'refund_cap_depos'),
    indepAcctAssets: readNumber(record, 'indep_acct_assets'),
    clientDepos: readNumber(record, 'client_depos'),
    clientProv: readNumber(record, 'client_prov'),
    transacSeatFee: readNumber(record, 'transac_seat_fee'),
    investAsReceiv: readNumber(record, 'invest_as_receiv'),
    totalAssets: readNumber(record, 'total_assets'),
    ltBorr: readNumber(record, 'lt_borr'),
    stBorr: readNumber(record, 'st_borr'),
    cbBorr: readNumber(record, 'cb_borr'),
    deposIbDeposits: readNumber(record, 'depos_ib_deposits'),
    loanOthBank: readNumber(record, 'loan_oth_bank'),
    tradingFl: readNumber(record, 'trading_fl'),
    notesPayable: readNumber(record, 'notes_payable'),
    acctPayable: readNumber(record, 'acct_payable'),
    advReceipts: readNumber(record, 'adv_receipts'),
    soldForRepurFa: readNumber(record, 'sold_for_repur_fa'),
    commPayable: readNumber(record, 'comm_payable'),
    payrollPayable: readNumber(record, 'payroll_payable'),
    taxesPayable: readNumber(record, 'taxes_payable'),
    intPayable: readNumber(record, 'int_payable'),
    divPayable: readNumber(record, 'div_payable'),
    othPayable: readNumber(record, 'oth_payable'),
    accExp: readNumber(record, 'acc_exp'),
    deferredInc: readNumber(record, 'deferred_inc'),
    stBondsPayable: readNumber(record, 'st_bonds_payable'),
    payableToReinsurer: readNumber(record, 'payable_to_reinsurer'),
    rsrvInsurCont: readNumber(record, 'rsrv_insur_cont'),
    actingTradingSec: readNumber(record, 'acting_trading_sec'),
    actingUwSec: readNumber(record, 'acting_uw_sec'),
    nonCurLiabDue1y: readNumber(record, 'non_cur_liab_due_1y'),
    othCurLiab: readNumber(record, 'oth_cur_liab'),
    totalCurLiab: readNumber(record, 'total_cur_liab'),
    bondPayable: readNumber(record, 'bond_payable'),
    ltPayable: readNumber(record, 'lt_payable'),
    specificPayables: readNumber(record, 'specific_payables'),
    estimatedLiab: readNumber(record, 'estimated_liab'),
    deferTaxLiab: readNumber(record, 'defer_tax_liab'),
    deferIncNonCurLiab: readNumber(record, 'defer_inc_non_cur_liab'),
    othNcl: readNumber(record, 'oth_ncl'),
    totalNcl: readNumber(record, 'total_ncl'),
    deposOthBfi: readNumber(record, 'depos_oth_bfi'),
    derivLiab: readNumber(record, 'deriv_liab'),
    depos: readNumber(record, 'depos'),
    agencyBusLiab: readNumber(record, 'agency_bus_liab'),
    othLiab: readNumber(record, 'oth_liab'),
    premRecivAdva: readNumber(record, 'prem_receiv_adva'),
    deposReceived: readNumber(record, 'depos_received'),
    phInvest: readNumber(record, 'ph_invest'),
    reserUnePrem: readNumber(record, 'reser_une_prem'),
    reserOutstdClaims: readNumber(record, 'reser_outstd_claims'),
    reserLinsLiab: readNumber(record, 'reser_lins_liab'),
    reserLthinsLiab: readNumber(record, 'reser_lthins_liab'),
    indeptAccLiab: readNumber(record, 'indept_acc_liab'),
    pledgeBorr: readNumber(record, 'pledge_borr'),
    indemPayable: readNumber(record, 'indem_payable'),
    policyDivPayable: readNumber(record, 'policy_div_payable'),
    totalLiab: readNumber(record, 'total_liab'),
    treasuryShare: readNumber(record, 'treasury_share'),
    ordinRiskReser: readNumber(record, 'ordin_risk_reser'),
    forexDiffer: readNumber(record, 'forex_differ'),
    investLossUnconf: readNumber(record, 'invest_loss_unconf'),
    minorityInt: readNumber(record, 'minority_int'),
    totalHldrEqyExcMinInt: readNumber(record, 'total_hldr_eqy_exc_min_int'),
    totalHldrEqyIncMinInt: readNumber(record, 'total_hldr_eqy_inc_min_int'),
    totalLiabHldrEqy: readNumber(record, 'total_liab_hldr_eqy'),
    ltPayrollPayable: readNumber(record, 'lt_payroll_payable'),
    othCompIncome: readNumber(record, 'oth_comp_income'),
    othEqtTools: readNumber(record, 'oth_eqt_tools'),
    othEqtToolsPShr: readNumber(record, 'oth_eqt_tools_p_shr'),
    lendingFunds: readNumber(record, 'lending_funds'),
    accReceivable: readNumber(record, 'acc_receivable'),
    stFinPayable: readNumber(record, 'st_fin_payable'),
    payables: readNumber(record, 'payables'),
    hfsAssets: readNumber(record, 'hfs_assets'),
    hfsSales: readNumber(record, 'hfs_sales'),
    costFinAssets: readNumber(record, 'cost_fin_assets'),
    fairValueFinAssets: readNumber(record, 'fair_value_fin_assets'),
    cipTotal: readNumber(record, 'cip_total'),
    othPayTotal: readNumber(record, 'oth_pay_total'),
    longPayTotal: readNumber(record, 'long_pay_total'),
    debtInvest: readNumber(record, 'debt_invest'),
    othDebtInvest: readNumber(record, 'oth_debt_invest'),
    othEqInvest: readNumber(record, 'oth_eq_invest'),
    othIlliqFinAssets: readNumber(record, 'oth_illiq_fin_assets'),
    othEqPpbond: readNumber(record, 'oth_eq_ppbond'),
    receivFinancing: readNumber(record, 'receiv_financing'),
    useRightAssets: readNumber(record, 'use_right_assets'),
    leaseLiab: readNumber(record, 'lease_liab'),
    contractAssets: readNumber(record, 'contract_assets'),
    contractLiab: readNumber(record, 'contract_liab'),
    accountsRecivBill: readNumber(record, 'accounts_receiv_bill'),
    accountsPay: readNumber(record, 'accounts_pay'),
    othRcvTotal: readNumber(record, 'oth_rcv_total'),
    fixAssetsTotal: readNumber(record, 'fix_assets_total'),
    updateFlag: readString(record, 'update_flag'),
  }
}

export function mapCashflowRecord(record: TushareRecord): Prisma.CashflowCreateManyInput | null {
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
    compType: readString(record, 'comp_type'),
    reportType: readString(record, 'report_type'),
    endType: readString(record, 'end_type'),
    netProfit: readNumber(record, 'net_profit'),
    finanExp: readNumber(record, 'finan_exp'),
    cFrSaleSg: readNumber(record, 'c_fr_sale_sg'),
    recpTaxRends: readNumber(record, 'recp_tax_rends'),
    nDeposIncrFi: readNumber(record, 'n_depos_incr_fi'),
    nIncrLoansCb: readNumber(record, 'n_incr_loans_cb'),
    nIncBorrOthFi: readNumber(record, 'n_inc_borr_oth_fi'),
    premFrOrigContr: readNumber(record, 'prem_fr_orig_contr'),
    nIncrInsuredDep: readNumber(record, 'n_incr_insured_dep'),
    nReinsurPrem: readNumber(record, 'n_reinsur_prem'),
    nIncrDispTfa: readNumber(record, 'n_incr_disp_tfa'),
    ifcCashIncr: readNumber(record, 'ifc_cash_incr'),
    nIncrDispFaas: readNumber(record, 'n_incr_disp_faas'),
    nIncrLoansOthBank: readNumber(record, 'n_incr_loans_oth_bank'),
    nCapIncrRepur: readNumber(record, 'n_cap_incr_repur'),
    cFrOthOperateA: readNumber(record, 'c_fr_oth_operate_a'),
    cInfFrOperateA: readNumber(record, 'c_inf_fr_operate_a'),
    cPaidGoodsS: readNumber(record, 'c_paid_goods_s'),
    cPaidToForEmpl: readNumber(record, 'c_paid_to_for_empl'),
    cPaidForTaxes: readNumber(record, 'c_paid_for_taxes'),
    nIncrCltLoanAdv: readNumber(record, 'n_incr_clt_loan_adv'),
    nIncrDepCbob: readNumber(record, 'n_incr_dep_cbob'),
    cPayClaimsOrigInco: readNumber(record, 'c_pay_claims_orig_inco'),
    payHandlingChrg: readNumber(record, 'pay_handling_chrg'),
    payCommInsurPlcy: readNumber(record, 'pay_comm_insur_plcy'),
    othCashPayOperAct: readNumber(record, 'oth_cash_pay_oper_act'),
    stCashOutAct: readNumber(record, 'st_cash_out_act'),
    nCashflowAct: readNumber(record, 'n_cashflow_act'),
    othRecpRalInvAct: readNumber(record, 'oth_recp_ral_inv_act'),
    cDispWithdrwlInvest: readNumber(record, 'c_disp_withdrwl_invest'),
    cRecpReturnInvest: readNumber(record, 'c_recp_return_invest'),
    nRecpDispFiolta: readNumber(record, 'n_recp_disp_fiolta'),
    nRecpDispSobu: readNumber(record, 'n_recp_disp_sobu'),
    stotInflowsInvAct: readNumber(record, 'stot_inflows_inv_act'),
    cPayAcqConstFiolta: readNumber(record, 'c_pay_acq_const_fiolta'),
    cPaidInvest: readNumber(record, 'c_paid_invest'),
    nDispSubsOthBiz: readNumber(record, 'n_disp_subs_oth_biz'),
    othPayRalInvAct: readNumber(record, 'oth_pay_ral_inv_act'),
    nIncrPledgeLoan: readNumber(record, 'n_incr_pledge_loan'),
    stotOutInvAct: readNumber(record, 'stot_out_inv_act'),
    nCashflowInvAct: readNumber(record, 'n_cashflow_inv_act'),
    cRecpBorrow: readNumber(record, 'c_recp_borrow'),
    procIssueBonds: readNumber(record, 'proc_issue_bonds'),
    othCashRecpRalFncAct: readNumber(record, 'oth_cash_recp_ral_fnc_act'),
    stotCashInFncAct: readNumber(record, 'stot_cash_in_fnc_act'),
    freeCashflow: readNumber(record, 'free_cashflow'),
    cPrepayAmtBorr: readNumber(record, 'c_prepay_amt_borr'),
    cPayDistDpcpIntExp: readNumber(record, 'c_pay_dist_dpcp_int_exp'),
    inclDvdProfitPaidScMs: readNumber(record, 'incl_dvd_profit_paid_sc_ms'),
    othCashpayRalFncAct: readNumber(record, 'oth_cashpay_ral_fnc_act'),
    stotCashoutFncAct: readNumber(record, 'stot_cashout_fnc_act'),
    nCashFlowsFncAct: readNumber(record, 'n_cash_flows_fnc_act'),
    effFxFluCash: readNumber(record, 'eff_fx_flu_cash'),
    nIncrCashCashEqu: readNumber(record, 'n_incr_cash_cash_equ'),
    cCashEquBegPeriod: readNumber(record, 'c_cash_equ_beg_period'),
    cCashEquEndPeriod: readNumber(record, 'c_cash_equ_end_period'),
    cRecpCapContrib: readNumber(record, 'c_recp_cap_contrib'),
    inclCashRecSaims: readNumber(record, 'incl_cash_rec_saims'),
    unconInvestLoss: readNumber(record, 'uncon_invest_loss'),
    provDeprAssets: readNumber(record, 'prov_depr_assets'),
    deprFaCogaDpba: readNumber(record, 'depr_fa_coga_dpba'),
    amortIntangAssets: readNumber(record, 'amort_intang_assets'),
    ltAmortDeferredExp: readNumber(record, 'lt_amort_deferred_exp'),
    decrDeferredExp: readNumber(record, 'decr_deferred_exp'),
    incrAccExp: readNumber(record, 'incr_acc_exp'),
    lossDispFiolta: readNumber(record, 'loss_disp_fiolta'),
    lossScrFa: readNumber(record, 'loss_scr_fa'),
    lossFvChg: readNumber(record, 'loss_fv_chg'),
    investLoss: readNumber(record, 'invest_loss'),
    decrDefIncTaxAssets: readNumber(record, 'decr_def_inc_tax_assets'),
    incrDefIncTaxLiab: readNumber(record, 'incr_def_inc_tax_liab'),
    decrInventories: readNumber(record, 'decr_inventories'),
    decrOperPayable: readNumber(record, 'decr_oper_payable'),
    incrOperPayable: readNumber(record, 'incr_oper_payable'),
    others: readNumber(record, 'others'),
    imNetCashflowOperAct: readNumber(record, 'im_net_cashflow_oper_act'),
    convDebtIntoCap: readNumber(record, 'conv_debt_into_cap'),
    convCopbondsDueWithin1y: readNumber(record, 'conv_copbonds_due_within_1y'),
    faFncLeases: readNumber(record, 'fa_fnc_leases'),
    imNIncrCashEqu: readNumber(record, 'im_n_incr_cash_equ'),
    netDismCapitalAdd: readNumber(record, 'net_dism_capital_add'),
    netCashReceSec: readNumber(record, 'net_cash_rece_sec'),
    creditImpALoss: readNumber(record, 'credit_impa_loss'),
    useRightAssetDep: readNumber(record, 'use_right_asset_dep'),
    othLossAsset: readNumber(record, 'oth_loss_asset'),
    endBalCash: readNumber(record, 'end_bal_cash'),
    begBalCash: readNumber(record, 'beg_bal_cash'),
    endBalCashEqu: readNumber(record, 'end_bal_cash_equ'),
    begBalCashEqu: readNumber(record, 'beg_bal_cash_equ'),
    updateFlag: readString(record, 'update_flag'),
  }
}

export function mapStkLimitRecord(record: TushareRecord): Prisma.StkLimitCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const tradeDate = readString(record, 'trade_date')
  if (!tsCode || !tradeDate) return null
  return {
    tsCode,
    tradeDate,
    upLimit: readNumber(record, 'up_limit'),
    downLimit: readNumber(record, 'down_limit'),
  }
}

export function mapSuspendDRecord(record: TushareRecord): Prisma.SuspendDCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const tradeDate = readString(record, 'trade_date')
  if (!tsCode || !tradeDate) return null
  return {
    tsCode,
    tradeDate,
    suspendTiming: readString(record, 'suspend_timing'),
    suspendType: readString(record, 'suspend_type'),
  }
}

export function mapIndexWeightRecord(record: TushareRecord): Prisma.IndexWeightCreateManyInput | null {
  const indexCode = readString(record, 'index_code')
  const conCode = readString(record, 'con_code')
  const tradeDate = readString(record, 'trade_date')
  if (!indexCode || !conCode || !tradeDate) return null
  return {
    indexCode,
    conCode,
    tradeDate,
    weight: readNumber(record, 'weight'),
  }
}

export function mapMarginDetailRecord(record: TushareRecord): Prisma.MarginDetailCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const tradeDate = readDate(record, 'trade_date')
  if (!tsCode || !tradeDate) return null
  return {
    tsCode,
    tradeDate,
    rzye: readNumber(record, 'rzye'),
    rzmre: readNumber(record, 'rzmre'),
    rzche: readNumber(record, 'rzche'),
    rzjmre: readNumber(record, 'rzjmre'),
    rqye: readNumber(record, 'rqye'),
    rqmcl: readNumber(record, 'rqmcl'),
    rqchl: readNumber(record, 'rqchl'),
    rqyl: readNumber(record, 'rqyl'),
    rzrqye: readNumber(record, 'rzrqye'),
    rzrqyl: readNumber(record, 'rzrqyl'),
  }
}

export function mapTopListRecord(record: TushareRecord): Prisma.TopListCreateManyInput | null {
  const tradeDate = readString(record, 'trade_date')
  const tsCode = readString(record, 'ts_code')
  if (!tradeDate || !tsCode) return null
  return {
    tradeDate,
    tsCode,
    name: readString(record, 'name'),
    close: readNumber(record, 'close'),
    pctChange: readNumber(record, 'pct_change'),
    turnoverRate: readNumber(record, 'turnover_rate'),
    amount: readNumber(record, 'amount'),
    lSell: readNumber(record, 'l_sell'),
    lBuy: readNumber(record, 'l_buy'),
    lAmount: readNumber(record, 'l_amount'),
    netAmount: readNumber(record, 'net_amount'),
    netRate: readNumber(record, 'net_rate'),
    amountRate: readNumber(record, 'amount_rate'),
    floatValues: readNumber(record, 'float_values'),
    reason: readString(record, 'reason'),
  }
}

export function mapTopInstRecord(record: TushareRecord): Prisma.TopInstCreateManyInput | null {
  const tradeDate = readString(record, 'trade_date')
  const tsCode = readString(record, 'ts_code')
  const exalter = readString(record, 'exalter')
  if (!tradeDate || !tsCode || !exalter) return null
  return {
    tradeDate,
    tsCode,
    exalter,
    buy: readNumber(record, 'buy'),
    buyCost: readNumber(record, 'buy_cost'),
    sell: readNumber(record, 'sell'),
    sellCost: readNumber(record, 'sell_cost'),
    netBuy: readNumber(record, 'net_buy'),
    side: readString(record, 'side'),
    reason: readString(record, 'reason'),
  }
}

export function mapBlockTradeRecord(record: TushareRecord): Prisma.BlockTradeCreateManyInput | null {
  const tradeDate = readString(record, 'trade_date')
  const tsCode = readString(record, 'ts_code')
  if (!tradeDate || !tsCode) return null
  return {
    tradeDate,
    tsCode,
    price: readNumber(record, 'price'),
    vol: readNumber(record, 'vol'),
    amount: readNumber(record, 'amount'),
    buyer: readString(record, 'buyer'),
    seller: readString(record, 'seller'),
  }
}

export function mapShareFloatRecord(record: TushareRecord): Prisma.ShareFloatCreateManyInput | null {
  const tsCode = readString(record, 'ts_code')
  const floatDate = readString(record, 'float_date')
  if (!tsCode || !floatDate) return null
  return {
    tsCode,
    annDate: readString(record, 'ann_date'),
    floatDate,
    floatShare: readNumber(record, 'float_share'),
    floatRatio: readNumber(record, 'float_ratio'),
    holderName: readString(record, 'holder_name'),
    shareType: readString(record, 'share_type'),
  }
}
