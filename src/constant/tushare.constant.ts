/** Tushare Pro 接口名 */
export enum TushareApiName {
  STOCK_BASIC = 'stock_basic',
  STOCK_COMPANY = 'stock_company',
  TRADE_CAL = 'trade_cal',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  ADJ_FACTOR = 'adj_factor',
  DAILY_BASIC = 'daily_basic',
  MONEYFLOW_DC = 'moneyflow_dc',
  MONEYFLOW_IND_DC = 'moneyflow_ind_dc',
  MONEYFLOW_MKT_DC = 'moneyflow_mkt_dc',
  EXPRESS = 'express',
  FINA_INDICATOR = 'fina_indicator',
  DIVIDEND = 'dividend',
  TOP10_HOLDERS = 'top10_holders',
  TOP10_FLOAT_HOLDERS = 'top10_floatholders',
}

/** A 股常用交易所代码 */
export enum StockExchange {
  SSE = 'SSE',
  SZSE = 'SZSE',
  BSE = 'BSE',
  HKEX = 'HKEX',
}

/** 股票上市状态 */
export enum StockListStatus {
  LISTED = 'L',
  DELISTED = 'D',
  PAUSED = 'P',
}

/** 交易日历开闭市状态 */
export enum TradeCalendarOpenStatus {
  CLOSED = '0',
  OPEN = '1',
}

/** 东财板块资金流向分类 */
export enum MoneyflowContentType {
  INDUSTRY = '行业',
  CONCEPT = '概念',
  REGION = '地域',
}

/** 同步任务枚举，需与 Prisma Schema 中的 TushareSyncTask 保持一致 */
export enum TushareSyncTaskName {
  STOCK_BASIC = 'STOCK_BASIC',
  STOCK_COMPANY = 'STOCK_COMPANY',
  TRADE_CAL = 'TRADE_CAL',
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  ADJ_FACTOR = 'ADJ_FACTOR',
  DAILY_BASIC = 'DAILY_BASIC',
  MONEYFLOW_DC = 'MONEYFLOW_DC',
  MONEYFLOW_IND_DC = 'MONEYFLOW_IND_DC',
  MONEYFLOW_MKT_DC = 'MONEYFLOW_MKT_DC',
  EXPRESS = 'EXPRESS',
  FINA_INDICATOR = 'FINA_INDICATOR',
  DIVIDEND = 'DIVIDEND',
  TOP10_HOLDERS = 'TOP10_HOLDERS',
  TOP10_FLOAT_HOLDERS = 'TOP10_FLOAT_HOLDERS',
}

/** 同步执行状态 */
export enum TushareSyncExecutionStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

/** 每日盘后同步时间：18:30（上海时区） */
export const TUSHARE_SYNC_CRON = '0 30 18 * * *'
export const TUSHARE_SYNC_TIME_ZONE = 'Asia/Shanghai'
export const TUSHARE_SYNC_CUTOFF_HOUR = 18
export const TUSHARE_SYNC_CUTOFF_MINUTE = 30

/** 历史补数默认起点，可通过环境变量覆盖 */
export const TUSHARE_DEFAULT_SYNC_START_DATE = '20100101'

/** 用于驱动交易日判断的交易所 */
export const TUSHARE_TRADE_CALENDAR_EXCHANGES = [StockExchange.SSE, StockExchange.SZSE] as const

/** 股票基础信息需覆盖全部上市状态，避免漏掉退市或暂停上市股票 */
export const TUSHARE_STOCK_LIST_STATUSES = [
  StockListStatus.LISTED,
  StockListStatus.DELISTED,
  StockListStatus.PAUSED,
] as const

/** 板块资金流向需要按类型分别同步 */
export const TUSHARE_MONEYFLOW_CONTENT_TYPES = [
  MoneyflowContentType.INDUSTRY,
  MoneyflowContentType.CONCEPT,
  MoneyflowContentType.REGION,
] as const

/** 接口字段清单：字段来自 Tushare 文档镜像模型元数据 */
export const TUSHARE_STOCK_BASIC_FIELDS = [
  'ts_code',
  'symbol',
  'name',
  'area',
  'industry',
  'fullname',
  'enname',
  'cnspell',
  'market',
  'exchange',
  'curr_type',
  'list_status',
  'list_date',
  'delist_date',
  'is_hs',
  'act_name',
  'act_ent_type',
] as const

export const TUSHARE_STOCK_COMPANY_FIELDS = [
  'ts_code',
  'com_name',
  'com_id',
  'chairman',
  'manager',
  'secretary',
  'reg_capital',
  'setup_date',
  'province',
  'city',
  'introduction',
  'website',
  'email',
  'office',
  'ann_date',
  'business_scope',
  'employees',
  'main_business',
  'exchange',
] as const

export const TUSHARE_TRADE_CAL_FIELDS = ['exchange', 'cal_date', 'is_open', 'pretrade_date'] as const

export const TUSHARE_OHLCV_FIELDS = [
  'ts_code',
  'trade_date',
  'open',
  'high',
  'low',
  'close',
  'pre_close',
  'change',
  'pct_chg',
  'vol',
  'amount',
] as const

export const TUSHARE_ADJ_FACTOR_FIELDS = ['ts_code', 'trade_date', 'adj_factor'] as const

export const TUSHARE_DAILY_BASIC_FIELDS = [
  'ts_code',
  'trade_date',
  'close',
  'turnover_rate',
  'turnover_rate_f',
  'volume_ratio',
  'pe',
  'pe_ttm',
  'pb',
  'ps',
  'ps_ttm',
  'dv_ratio',
  'dv_ttm',
  'total_share',
  'float_share',
  'free_share',
  'total_mv',
  'circ_mv',
  'limit_status',
] as const

export const TUSHARE_MONEYFLOW_DC_FIELDS = [
  'trade_date',
  'ts_code',
  'name',
  'pct_change',
  'close',
  'net_amount',
  'net_amount_rate',
  'buy_elg_amount',
  'buy_elg_amount_rate',
  'buy_lg_amount',
  'buy_lg_amount_rate',
  'buy_md_amount',
  'buy_md_amount_rate',
  'buy_sm_amount',
  'buy_sm_amount_rate',
] as const

export const TUSHARE_MONEYFLOW_IND_DC_FIELDS = [
  'trade_date',
  'content_type',
  'ts_code',
  'name',
  'pct_change',
  'close',
  'net_amount',
  'net_amount_rate',
  'buy_elg_amount',
  'buy_elg_amount_rate',
  'buy_lg_amount',
  'buy_lg_amount_rate',
  'buy_md_amount',
  'buy_md_amount_rate',
  'buy_sm_amount',
  'buy_sm_amount_rate',
  'buy_sm_amount_stock',
  'rank',
] as const

export const TUSHARE_MONEYFLOW_MKT_DC_FIELDS = [
  'trade_date',
  'close_sh',
  'pct_change_sh',
  'close_sz',
  'pct_change_sz',
  'net_amount',
  'net_amount_rate',
  'buy_elg_amount',
  'buy_elg_amount_rate',
  'buy_lg_amount',
  'buy_lg_amount_rate',
  'buy_md_amount',
  'buy_md_amount_rate',
  'buy_sm_amount',
  'buy_sm_amount_rate',
] as const

export const TUSHARE_EXPRESS_FIELDS = [
  'ts_code',
  'ann_date',
  'end_date',
  'revenue',
  'operate_profit',
  'total_profit',
  'n_income',
  'total_assets',
  'total_hldr_eqy_exc_min_int',
  'diluted_eps',
  'diluted_roe',
  'yoy_net_profit',
  'bps',
  'yoy_sales',
  'yoy_op',
  'yoy_tp',
  'yoy_dedu_np',
  'yoy_eps',
  'yoy_roe',
  'growth_assets',
  'yoy_equity',
  'growth_bps',
  'or_last_year',
  'op_last_year',
  'tp_last_year',
  'np_last_year',
  'eps_last_year',
  'open_net_assets',
  'open_bps',
  'perf_summary',
  'is_audit',
  'remark',
  'update_flag',
] as const

export const TUSHARE_FINA_INDICATOR_FIELDS = [
  'ts_code',
  'ann_date',
  'end_date',
  'eps',
  'dt_eps',
  'total_revenue_ps',
  'revenue_ps',
  'grossprofit_margin',
  'netprofit_margin',
  'roe',
  'dt_roe',
  'roa',
  'roa2',
  'debt_to_assets',
  'current_ratio',
  'quick_ratio',
  'cash_ratio',
  'fcff',
  'fcfe',
  'ebit',
  'ebitda',
  'netdebt',
  'ocf_to_netprofit',
  'ocf_to_or',
  'revenue_yoy',
  'netprofit_yoy',
  'ocf_yoy',
  'dt_eps_yoy',
  'roe_yoy',
  'bps_yoy',
  'assets_yoy',
  'eqt_yoy',
  'tr_yoy',
] as const

export const TUSHARE_DIVIDEND_FIELDS = [
  'ts_code',
  'end_date',
  'ann_date',
  'div_proc',
  'stk_div',
  'stk_bo_rate',
  'stk_co_rate',
  'cash_div',
  'cash_div_tax',
  'record_date',
  'ex_date',
  'pay_date',
  'div_listdate',
  'imp_ann_date',
  'base_date',
  'base_share',
] as const

export const TUSHARE_TOP10_HOLDERS_FIELDS = [
  'ts_code',
  'ann_date',
  'end_date',
  'holder_name',
  'hold_amount',
  'hold_ratio',
  'holder_type',
] as const

export const TUSHARE_TOP10_FLOAT_HOLDERS_FIELDS = [
  'ts_code',
  'ann_date',
  'end_date',
  'holder_name',
  'hold_amount',
  'hold_ratio',
  'holder_type',
] as const
