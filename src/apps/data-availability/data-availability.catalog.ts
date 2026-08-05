import { TushareSyncTask } from '@prisma/client'

export const DATA_AVAILABILITY_DATASETS = [
  'STOCK_DAILY',
  'STOCK_DAILY_BASIC',
  'STOCK_ADJ_FACTOR',
  'STOCK_TECHNICAL_FACTOR',
  'STOCK_MONEYFLOW',
  'FINANCIAL_INDICATOR',
  'INCOME_STATEMENT',
  'BALANCE_SHEET',
  'CASHFLOW',
  'INDEX_DAILY',
  'SECTOR_DAILY',
  'MARKET_MONEYFLOW',
  'HSGT',
  'MARGIN_DETAIL',
  'CYQ_PERF',
  'CYQ_CHIPS',
] as const

export type DataAvailabilityDataset = (typeof DATA_AVAILABILITY_DATASETS)[number]

export interface DataAvailabilityCatalogEntry {
  dataset: DataAvailabilityDataset
  sourceModel: string
  dateField: 'tradeDate' | 'annDate'
  supportsSecurityScope: boolean
  syncTask: TushareSyncTask
  qualityDataSet: string
  allowedLagTradingDays: number
  recommendedTool: string | null
}

export const DATA_AVAILABILITY_CATALOG: Readonly<Record<DataAvailabilityDataset, DataAvailabilityCatalogEntry>> =
  Object.freeze({
    STOCK_DAILY: entry('STOCK_DAILY', 'Daily', 'tradeDate', true, TushareSyncTask.DAILY, 1, 'get_stock_price_history'),
    STOCK_DAILY_BASIC: entry(
      'STOCK_DAILY_BASIC',
      'DailyBasic',
      'tradeDate',
      true,
      TushareSyncTask.DAILY_BASIC,
      1,
      'get_stock_overview',
    ),
    STOCK_ADJ_FACTOR: entry(
      'STOCK_ADJ_FACTOR',
      'AdjFactor',
      'tradeDate',
      true,
      TushareSyncTask.ADJ_FACTOR,
      1,
      'get_stock_price_history',
    ),
    STOCK_TECHNICAL_FACTOR: entry(
      'STOCK_TECHNICAL_FACTOR',
      'StkFactor',
      'tradeDate',
      true,
      TushareSyncTask.STK_FACTOR,
      1,
      'get_stock_technical_indicators',
    ),
    STOCK_MONEYFLOW: entry(
      'STOCK_MONEYFLOW',
      'Moneyflow',
      'tradeDate',
      true,
      TushareSyncTask.MONEYFLOW,
      2,
      'get_stock_moneyflow',
    ),
    FINANCIAL_INDICATOR: entry(
      'FINANCIAL_INDICATOR',
      'FinaIndicator',
      'annDate',
      true,
      TushareSyncTask.FINA_INDICATOR,
      130,
      'get_financial_indicators',
    ),
    INCOME_STATEMENT: entry(
      'INCOME_STATEMENT',
      'Income',
      'annDate',
      true,
      TushareSyncTask.INCOME,
      130,
      'get_financial_statements',
    ),
    BALANCE_SHEET: entry(
      'BALANCE_SHEET',
      'BalanceSheet',
      'annDate',
      true,
      TushareSyncTask.BALANCE_SHEET,
      130,
      'get_financial_statements',
    ),
    CASHFLOW: entry('CASHFLOW', 'Cashflow', 'annDate', true, TushareSyncTask.CASHFLOW, 130, 'get_financial_statements'),
    INDEX_DAILY: entry(
      'INDEX_DAILY',
      'IndexDaily',
      'tradeDate',
      false,
      TushareSyncTask.INDEX_DAILY,
      1,
      'get_stock_relative_strength',
    ),
    SECTOR_DAILY: entry(
      'SECTOR_DAILY',
      'ThsDaily',
      'tradeDate',
      false,
      TushareSyncTask.THS_DAILY,
      2,
      'get_market_snapshot',
    ),
    MARKET_MONEYFLOW: entry(
      'MARKET_MONEYFLOW',
      'MoneyflowMktDc',
      'tradeDate',
      false,
      TushareSyncTask.MONEYFLOW_MKT_DC,
      2,
      'get_market_snapshot',
    ),
    HSGT: entry('HSGT', 'MoneyflowHsgt', 'tradeDate', false, TushareSyncTask.MONEYFLOW_HSGT, 5, 'get_market_snapshot'),
    MARGIN_DETAIL: entry(
      'MARGIN_DETAIL',
      'MarginDetail',
      'tradeDate',
      true,
      TushareSyncTask.MARGIN_DETAIL,
      2,
      'get_stock_margin_history',
    ),
    CYQ_PERF: entry('CYQ_PERF', 'CyqPerf', 'tradeDate', true, TushareSyncTask.CYQ_PERF, 2, 'get_stock_chip_profile'),
    CYQ_CHIPS: entry(
      'CYQ_CHIPS',
      'CyqChips',
      'tradeDate',
      true,
      TushareSyncTask.CYQ_CHIPS,
      2,
      'get_stock_chip_profile',
    ),
  })

function entry(
  dataset: DataAvailabilityDataset,
  sourceModel: string,
  dateField: DataAvailabilityCatalogEntry['dateField'],
  supportsSecurityScope: boolean,
  syncTask: TushareSyncTask,
  allowedLagTradingDays: number,
  recommendedTool: string | null,
): DataAvailabilityCatalogEntry {
  return Object.freeze({
    dataset,
    sourceModel,
    dateField,
    supportsSecurityScope,
    syncTask,
    qualityDataSet: syncTask.toLowerCase(),
    allowedLagTradingDays,
    recommendedTool,
  })
}
