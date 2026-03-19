import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone'
import utc from 'dayjs/plugin/utc'
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

  const parsed = dayjs.tz(value, 'YYYYMMDD', 'Asia/Shanghai')
  return parsed.isValid() ? parsed.toDate() : null
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

function mapOhlcvRecord<T extends Prisma.DailyCreateManyInput | Prisma.WeeklyCreateManyInput | Prisma.MonthlyCreateManyInput>(
  record: TushareRecord,
): Omit<T, 'syncedAt'> | null {
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
    updateFlag: readDate(record, 'update_flag'),
  }
}
