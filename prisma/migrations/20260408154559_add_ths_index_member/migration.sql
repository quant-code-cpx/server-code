-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_CREATE', 'USER_DELETE', 'USER_UPDATE_STATUS', 'USER_UPDATE_INFO', 'USER_RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "factor_category" AS ENUM ('valuation', 'size', 'momentum', 'volatility', 'liquidity', 'quality', 'growth', 'capital_flow', 'technical', 'leverage', 'dividend', 'custom');

-- CreateEnum
CREATE TYPE "factor_source_type" AS ENUM ('field_ref', 'derived', 'custom_sql');

-- CreateEnum
CREATE TYPE "subscription_frequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "StockExchange" AS ENUM ('SSE', 'SZSE', 'BSE', 'HKEX');

-- CreateEnum
CREATE TYPE "StockListStatus" AS ENUM ('L', 'D', 'P');

-- CreateEnum
CREATE TYPE "MoneyflowContentType" AS ENUM ('行业', '概念', '地域');

-- CreateEnum
CREATE TYPE "TushareSyncTask" AS ENUM ('STOCK_BASIC', 'STOCK_COMPANY', 'TRADE_CAL', 'DAILY', 'WEEKLY', 'MONTHLY', 'ADJ_FACTOR', 'DAILY_BASIC', 'INDEX_DAILY', 'MONEYFLOW_DC', 'MONEYFLOW_IND_DC', 'MONEYFLOW_MKT_DC', 'MONEYFLOW_HSGT', 'INCOME', 'BALANCE_SHEET', 'CASHFLOW', 'EXPRESS', 'FINA_INDICATOR', 'DIVIDEND', 'TOP10_HOLDERS', 'TOP10_FLOAT_HOLDERS', 'STK_LIMIT', 'SUSPEND_D', 'INDEX_WEIGHT', 'MARGIN_DETAIL', 'TOP_LIST', 'TOP_INST', 'BLOCK_TRADE', 'SHARE_FLOAT', 'DATA_QUALITY_CHECK', 'FORECAST', 'STK_HOLDER_NUMBER', 'HK_HOLD', 'INDEX_DAILY_BASIC', 'STK_HOLDER_TRADE', 'PLEDGE_STAT', 'FINA_AUDIT', 'DISCLOSURE_DATE', 'FINA_MAINBZ', 'INDEX_CLASSIFY', 'INDEX_MEMBER_ALL', 'REPURCHASE', 'CB_BASIC', 'CB_DAILY', 'THS_INDEX', 'THS_MEMBER');

-- CreateEnum
CREATE TYPE "TushareSyncStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "TushareSyncProgressStatus" AS ENUM ('IDLE', 'RUNNING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TushareSyncRetryStatus" AS ENUM ('PENDING', 'RETRYING', 'SUCCEEDED', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DEACTIVATED', 'DELETED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "operatorId" INTEGER NOT NULL,
    "operatorAccount" VARCHAR(64) NOT NULL,
    "action" "AuditAction" NOT NULL,
    "targetId" INTEGER,
    "targetAccount" VARCHAR(64),
    "details" JSONB,
    "ipAddress" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_runs" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "job_id" TEXT,
    "name" VARCHAR(128),
    "strategy_type" VARCHAR(64) NOT NULL,
    "strategy_config" JSONB NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "benchmark_ts_code" VARCHAR(16) NOT NULL,
    "universe" VARCHAR(32) NOT NULL,
    "custom_universe" JSONB,
    "initial_capital" DECIMAL(20,4) NOT NULL,
    "rebalance_frequency" VARCHAR(32) NOT NULL,
    "price_mode" VARCHAR(32) NOT NULL,
    "commission_rate" DECIMAL(10,6),
    "stamp_duty_rate" DECIMAL(10,6),
    "min_commission" DECIMAL(20,4),
    "slippage_bps" INTEGER,
    "status" VARCHAR(32) NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "failed_reason" TEXT,
    "total_return" DOUBLE PRECISION,
    "annualized_return" DOUBLE PRECISION,
    "benchmark_return" DOUBLE PRECISION,
    "excess_return" DOUBLE PRECISION,
    "max_drawdown" DOUBLE PRECISION,
    "sharpe_ratio" DOUBLE PRECISION,
    "sortino_ratio" DOUBLE PRECISION,
    "calmar_ratio" DOUBLE PRECISION,
    "volatility" DOUBLE PRECISION,
    "alpha" DOUBLE PRECISION,
    "beta" DOUBLE PRECISION,
    "information_ratio" DOUBLE PRECISION,
    "win_rate" DOUBLE PRECISION,
    "turnover_rate" DOUBLE PRECISION,
    "trade_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backtest_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_daily_navs" (
    "run_id" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "nav" DECIMAL(20,8) NOT NULL,
    "benchmark_nav" DECIMAL(20,8),
    "daily_return" DOUBLE PRECISION,
    "benchmark_return" DOUBLE PRECISION,
    "drawdown" DOUBLE PRECISION,
    "cash" DECIMAL(20,4),
    "position_value" DECIMAL(20,4),
    "exposure" DOUBLE PRECISION,
    "cash_ratio" DOUBLE PRECISION,

    CONSTRAINT "backtest_daily_navs_pkey" PRIMARY KEY ("run_id","trade_date")
);

-- CreateTable
CREATE TABLE "backtest_trades" (
    "id" BIGSERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "side" VARCHAR(8) NOT NULL,
    "price" DECIMAL(20,4) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "commission" DECIMAL(20,4),
    "stamp_duty" DECIMAL(20,4),
    "slippage_cost" DECIMAL(20,4),
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_position_snapshots" (
    "run_id" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "cost_price" DECIMAL(20,4),
    "close_price" DECIMAL(20,4),
    "market_value" DECIMAL(20,4),
    "weight" DOUBLE PRECISION,
    "unrealized_pnl" DECIMAL(20,4),
    "holding_days" INTEGER,

    CONSTRAINT "backtest_position_snapshots_pkey" PRIMARY KEY ("run_id","trade_date","ts_code")
);

-- CreateTable
CREATE TABLE "backtest_rebalance_logs" (
    "id" BIGSERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "signal_date" DATE NOT NULL,
    "execute_date" DATE NOT NULL,
    "target_count" INTEGER,
    "executed_buy_count" INTEGER,
    "executed_sell_count" INTEGER,
    "skipped_limit_count" INTEGER,
    "skipped_suspend_count" INTEGER,
    "message" TEXT,

    CONSTRAINT "backtest_rebalance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_walk_forward_runs" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(128),
    "base_strategy_type" VARCHAR(64) NOT NULL,
    "base_strategy_config" JSONB NOT NULL,
    "param_search_space" JSONB NOT NULL,
    "optimize_metric" VARCHAR(64) NOT NULL,
    "full_start_date" DATE NOT NULL,
    "full_end_date" DATE NOT NULL,
    "in_sample_days" INTEGER NOT NULL,
    "out_of_sample_days" INTEGER NOT NULL,
    "step_days" INTEGER NOT NULL,
    "benchmark_ts_code" VARCHAR(16) NOT NULL,
    "universe" VARCHAR(32) NOT NULL,
    "initial_capital" DECIMAL(20,4) NOT NULL,
    "rebalance_frequency" VARCHAR(32) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "failed_reason" TEXT,
    "window_count" INTEGER,
    "completed_windows" INTEGER DEFAULT 0,
    "oos_annualized_return" DOUBLE PRECISION,
    "oos_sharpe_ratio" DOUBLE PRECISION,
    "oos_max_drawdown" DOUBLE PRECISION,
    "is_oos_return_vs_is" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backtest_walk_forward_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_walk_forward_windows" (
    "id" TEXT NOT NULL,
    "wf_run_id" TEXT NOT NULL,
    "window_index" INTEGER NOT NULL,
    "is_start_date" DATE NOT NULL,
    "is_end_date" DATE NOT NULL,
    "oos_start_date" DATE NOT NULL,
    "oos_end_date" DATE NOT NULL,
    "optimized_params" JSONB,
    "is_backtest_run_id" TEXT,
    "oos_backtest_run_id" TEXT,
    "is_return" DOUBLE PRECISION,
    "is_sharpe" DOUBLE PRECISION,
    "oos_return" DOUBLE PRECISION,
    "oos_sharpe" DOUBLE PRECISION,
    "oos_max_drawdown" DOUBLE PRECISION,

    CONSTRAINT "backtest_walk_forward_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backtest_comparison_groups" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(128),
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "benchmark_ts_code" VARCHAR(16) NOT NULL,
    "universe" VARCHAR(32) NOT NULL,
    "initial_capital" DECIMAL(20,4) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "run_ids" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backtest_comparison_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_quality_checks" (
    "id" SERIAL NOT NULL,
    "check_date" TIMESTAMP(3) NOT NULL,
    "data_set" TEXT NOT NULL,
    "check_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_validation_logs" (
    "id" SERIAL NOT NULL,
    "task" TEXT NOT NULL,
    "trade_date" TEXT NOT NULL,
    "ts_code" TEXT,
    "rule_name" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_validation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factor_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" "factor_category" NOT NULL,
    "source_type" "factor_source_type" NOT NULL,
    "expression" TEXT,
    "source_table" TEXT,
    "source_field" TEXT,
    "params" JSONB,
    "is_builtin" BOOLEAN NOT NULL DEFAULT true,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "factor_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factor_snapshots" (
    "factor_name" TEXT NOT NULL,
    "trade_date" TEXT NOT NULL,
    "ts_code" TEXT NOT NULL,
    "value" DECIMAL(20,6),
    "percentile" DECIMAL(6,4),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factor_snapshots_pkey" PRIMARY KEY ("factor_name","trade_date","ts_code")
);

-- CreateTable
CREATE TABLE "factor_snapshot_summaries" (
    "factor_name" TEXT NOT NULL,
    "trade_date" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "missing" INTEGER NOT NULL,
    "mean" DECIMAL(20,6),
    "median" DECIMAL(20,6),
    "std_dev" DECIMAL(20,6),
    "min" DECIMAL(20,6),
    "max" DECIMAL(20,6),
    "q25" DECIMAL(20,6),
    "q75" DECIMAL(20,6),
    "skewness" DECIMAL(10,6),
    "kurtosis" DECIMAL(10,6),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factor_snapshot_summaries_pkey" PRIMARY KEY ("factor_name","trade_date")
);

-- CreateTable
CREATE TABLE "heatmap_snapshots" (
    "trade_date" VARCHAR(8) NOT NULL,
    "group_by" VARCHAR(16) NOT NULL,
    "group_name" VARCHAR(128) NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "name" VARCHAR(64),
    "pct_chg" DECIMAL(10,4),
    "total_mv" DECIMAL(20,4),
    "amount" DECIMAL(20,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "heatmap_snapshots_pkey" PRIMARY KEY ("trade_date","group_by","ts_code")
);

-- CreateTable
CREATE TABLE "heatmap_snapshot_statuses" (
    "trade_date" VARCHAR(8) NOT NULL,
    "group_by" VARCHAR(16) NOT NULL,
    "stock_count" INTEGER NOT NULL,
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "aggregated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "heatmap_snapshot_statuses_pkey" PRIMARY KEY ("trade_date","group_by")
);

-- CreateTable
CREATE TABLE "research_notes" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "ts_code" VARCHAR(16),
    "title" VARCHAR(100) NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screener_strategies" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(200),
    "filters" JSONB NOT NULL,
    "sort_by" VARCHAR(30),
    "sort_order" VARCHAR(4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screener_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screener_subscriptions" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "strategy_id" INTEGER,
    "filters" JSONB NOT NULL,
    "sort_by" VARCHAR(30),
    "sort_order" VARCHAR(4),
    "frequency" "subscription_frequency" NOT NULL DEFAULT 'DAILY',
    "status" "subscription_status" NOT NULL DEFAULT 'ACTIVE',
    "last_run_at" TIMESTAMP(3),
    "last_run_result" JSONB,
    "last_match_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consecutive_fails" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screener_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screener_subscription_logs" (
    "id" SERIAL NOT NULL,
    "subscription_id" INTEGER NOT NULL,
    "trade_date" VARCHAR(8) NOT NULL,
    "match_count" INTEGER NOT NULL,
    "new_entry_count" INTEGER NOT NULL,
    "exit_count" INTEGER NOT NULL,
    "new_entry_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exit_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "execution_ms" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screener_subscription_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "strategy_type" VARCHAR(50) NOT NULL,
    "strategy_config" JSONB NOT NULL,
    "backtest_defaults" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_drafts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategy_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_factors" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "adj_factor" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_adjustment_factors_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "balance_sheet_reports" (
    "id" BIGSERIAL NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE,
    "f_ann_date" DATE,
    "end_date" DATE NOT NULL,
    "report_type" VARCHAR(16),
    "comp_type" VARCHAR(16),
    "end_type" VARCHAR(16),
    "total_share" DOUBLE PRECISION,
    "cap_rese" DOUBLE PRECISION,
    "undistr_porfit" DOUBLE PRECISION,
    "surplus_rese" DOUBLE PRECISION,
    "special_rese" DOUBLE PRECISION,
    "money_cap" DOUBLE PRECISION,
    "trad_asset" DOUBLE PRECISION,
    "notes_receiv" DOUBLE PRECISION,
    "accounts_receiv" DOUBLE PRECISION,
    "oth_receiv" DOUBLE PRECISION,
    "prepayment" DOUBLE PRECISION,
    "div_receiv" DOUBLE PRECISION,
    "int_receiv" DOUBLE PRECISION,
    "inventories" DOUBLE PRECISION,
    "amor_exp" DOUBLE PRECISION,
    "nca_within_1y" DOUBLE PRECISION,
    "sett_rsrv" DOUBLE PRECISION,
    "loanto_oth_bank_fi" DOUBLE PRECISION,
    "premium_receiv" DOUBLE PRECISION,
    "reinsur_receiv" DOUBLE PRECISION,
    "reinsur_res_receiv" DOUBLE PRECISION,
    "pur_resale_fa" DOUBLE PRECISION,
    "oth_cur_assets" DOUBLE PRECISION,
    "total_cur_assets" DOUBLE PRECISION,
    "fa_avail_for_sale" DOUBLE PRECISION,
    "htm_invest" DOUBLE PRECISION,
    "lt_eqt_invest" DOUBLE PRECISION,
    "invest_real_estate" DOUBLE PRECISION,
    "time_deposits" DOUBLE PRECISION,
    "oth_assets" DOUBLE PRECISION,
    "lt_rec" DOUBLE PRECISION,
    "fix_assets" DOUBLE PRECISION,
    "cip" DOUBLE PRECISION,
    "const_materials" DOUBLE PRECISION,
    "fixed_assets_disp" DOUBLE PRECISION,
    "produc_bio_assets" DOUBLE PRECISION,
    "oil_and_gas_assets" DOUBLE PRECISION,
    "intan_assets" DOUBLE PRECISION,
    "r_and_d" DOUBLE PRECISION,
    "goodwill" DOUBLE PRECISION,
    "lt_amor_exp" DOUBLE PRECISION,
    "defer_tax_assets" DOUBLE PRECISION,
    "decr_in_disbur" DOUBLE PRECISION,
    "oth_nca" DOUBLE PRECISION,
    "total_nca" DOUBLE PRECISION,
    "cash_reser_cb" DOUBLE PRECISION,
    "depos_in_oth_bfi" DOUBLE PRECISION,
    "prec_metals" DOUBLE PRECISION,
    "deriv_assets" DOUBLE PRECISION,
    "rr_reins_une_prem" DOUBLE PRECISION,
    "rr_reins_outstd_cla" DOUBLE PRECISION,
    "rr_reins_lins_liab" DOUBLE PRECISION,
    "rr_reins_lthins_liab" DOUBLE PRECISION,
    "refund_depos" DOUBLE PRECISION,
    "ph_pledge_loans" DOUBLE PRECISION,
    "refund_cap_depos" DOUBLE PRECISION,
    "indep_acct_assets" DOUBLE PRECISION,
    "client_depos" DOUBLE PRECISION,
    "client_prov" DOUBLE PRECISION,
    "transac_seat_fee" DOUBLE PRECISION,
    "invest_as_receiv" DOUBLE PRECISION,
    "total_assets" DOUBLE PRECISION,
    "lt_borr" DOUBLE PRECISION,
    "st_borr" DOUBLE PRECISION,
    "cb_borr" DOUBLE PRECISION,
    "depos_ib_deposits" DOUBLE PRECISION,
    "loan_oth_bank" DOUBLE PRECISION,
    "trading_fl" DOUBLE PRECISION,
    "notes_payable" DOUBLE PRECISION,
    "acct_payable" DOUBLE PRECISION,
    "adv_receipts" DOUBLE PRECISION,
    "sold_for_repur_fa" DOUBLE PRECISION,
    "comm_payable" DOUBLE PRECISION,
    "payroll_payable" DOUBLE PRECISION,
    "taxes_payable" DOUBLE PRECISION,
    "int_payable" DOUBLE PRECISION,
    "div_payable" DOUBLE PRECISION,
    "oth_payable" DOUBLE PRECISION,
    "acc_exp" DOUBLE PRECISION,
    "deferred_inc" DOUBLE PRECISION,
    "st_bonds_payable" DOUBLE PRECISION,
    "payable_to_reinsurer" DOUBLE PRECISION,
    "rsrv_insur_cont" DOUBLE PRECISION,
    "acting_trading_sec" DOUBLE PRECISION,
    "acting_uw_sec" DOUBLE PRECISION,
    "non_cur_liab_due_1y" DOUBLE PRECISION,
    "oth_cur_liab" DOUBLE PRECISION,
    "total_cur_liab" DOUBLE PRECISION,
    "bond_payable" DOUBLE PRECISION,
    "lt_payable" DOUBLE PRECISION,
    "specific_payables" DOUBLE PRECISION,
    "estimated_liab" DOUBLE PRECISION,
    "defer_tax_liab" DOUBLE PRECISION,
    "defer_inc_non_cur_liab" DOUBLE PRECISION,
    "oth_ncl" DOUBLE PRECISION,
    "total_ncl" DOUBLE PRECISION,
    "depos_oth_bfi" DOUBLE PRECISION,
    "deriv_liab" DOUBLE PRECISION,
    "depos" DOUBLE PRECISION,
    "agency_bus_liab" DOUBLE PRECISION,
    "oth_liab" DOUBLE PRECISION,
    "prem_receiv_adva" DOUBLE PRECISION,
    "depos_received" DOUBLE PRECISION,
    "ph_invest" DOUBLE PRECISION,
    "reser_une_prem" DOUBLE PRECISION,
    "reser_outstd_claims" DOUBLE PRECISION,
    "reser_lins_liab" DOUBLE PRECISION,
    "reser_lthins_liab" DOUBLE PRECISION,
    "indept_acc_liab" DOUBLE PRECISION,
    "pledge_borr" DOUBLE PRECISION,
    "indem_payable" DOUBLE PRECISION,
    "policy_div_payable" DOUBLE PRECISION,
    "total_liab" DOUBLE PRECISION,
    "treasury_share" DOUBLE PRECISION,
    "ordin_risk_reser" DOUBLE PRECISION,
    "forex_differ" DOUBLE PRECISION,
    "invest_loss_unconf" DOUBLE PRECISION,
    "minority_int" DOUBLE PRECISION,
    "total_hldr_eqy_exc_min_int" DOUBLE PRECISION,
    "total_hldr_eqy_inc_min_int" DOUBLE PRECISION,
    "total_liab_hldr_eqy" DOUBLE PRECISION,
    "lt_payroll_payable" DOUBLE PRECISION,
    "oth_comp_income" DOUBLE PRECISION,
    "oth_eqt_tools" DOUBLE PRECISION,
    "oth_eqt_tools_p_shr" DOUBLE PRECISION,
    "lending_funds" DOUBLE PRECISION,
    "acc_receivable" DOUBLE PRECISION,
    "st_fin_payable" DOUBLE PRECISION,
    "payables" DOUBLE PRECISION,
    "hfs_assets" DOUBLE PRECISION,
    "hfs_sales" DOUBLE PRECISION,
    "cost_fin_assets" DOUBLE PRECISION,
    "fair_value_fin_assets" DOUBLE PRECISION,
    "cip_total" DOUBLE PRECISION,
    "oth_pay_total" DOUBLE PRECISION,
    "long_pay_total" DOUBLE PRECISION,
    "debt_invest" DOUBLE PRECISION,
    "oth_debt_invest" DOUBLE PRECISION,
    "oth_eq_invest" DOUBLE PRECISION,
    "oth_illiq_fin_assets" DOUBLE PRECISION,
    "oth_eq_ppbond" DOUBLE PRECISION,
    "receiv_financing" DOUBLE PRECISION,
    "use_right_assets" DOUBLE PRECISION,
    "lease_liab" DOUBLE PRECISION,
    "contract_assets" DOUBLE PRECISION,
    "contract_liab" DOUBLE PRECISION,
    "accounts_receiv_bill" DOUBLE PRECISION,
    "accounts_pay" DOUBLE PRECISION,
    "oth_rcv_total" DOUBLE PRECISION,
    "fix_assets_total" DOUBLE PRECISION,
    "update_flag" VARCHAR(8),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_sheet_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "block_trade_daily" (
    "id" SERIAL NOT NULL,
    "trade_date" TEXT NOT NULL,
    "ts_code" TEXT NOT NULL,
    "price" DECIMAL(20,4),
    "vol" DECIMAL(20,4),
    "amount" DECIMAL(20,4),
    "buyer" TEXT,
    "seller" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_trade_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashflow_reports" (
    "id" BIGSERIAL NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE,
    "f_ann_date" DATE,
    "end_date" DATE NOT NULL,
    "comp_type" VARCHAR(16),
    "report_type" VARCHAR(16),
    "end_type" VARCHAR(16),
    "net_profit" DOUBLE PRECISION,
    "finan_exp" DOUBLE PRECISION,
    "c_fr_sale_sg" DOUBLE PRECISION,
    "recp_tax_rends" DOUBLE PRECISION,
    "n_depos_incr_fi" DOUBLE PRECISION,
    "n_incr_loans_cb" DOUBLE PRECISION,
    "n_inc_borr_oth_fi" DOUBLE PRECISION,
    "prem_fr_orig_contr" DOUBLE PRECISION,
    "n_incr_insured_dep" DOUBLE PRECISION,
    "n_reinsur_prem" DOUBLE PRECISION,
    "n_incr_disp_tfa" DOUBLE PRECISION,
    "ifc_cash_incr" DOUBLE PRECISION,
    "n_incr_disp_faas" DOUBLE PRECISION,
    "n_incr_loans_oth_bank" DOUBLE PRECISION,
    "n_cap_incr_repur" DOUBLE PRECISION,
    "c_fr_oth_operate_a" DOUBLE PRECISION,
    "c_inf_fr_operate_a" DOUBLE PRECISION,
    "c_paid_goods_s" DOUBLE PRECISION,
    "c_paid_to_for_empl" DOUBLE PRECISION,
    "c_paid_for_taxes" DOUBLE PRECISION,
    "n_incr_clt_loan_adv" DOUBLE PRECISION,
    "n_incr_dep_cbob" DOUBLE PRECISION,
    "c_pay_claims_orig_inco" DOUBLE PRECISION,
    "pay_handling_chrg" DOUBLE PRECISION,
    "pay_comm_insur_plcy" DOUBLE PRECISION,
    "oth_cash_pay_oper_act" DOUBLE PRECISION,
    "st_cash_out_act" DOUBLE PRECISION,
    "n_cashflow_act" DOUBLE PRECISION,
    "oth_recp_ral_inv_act" DOUBLE PRECISION,
    "c_disp_withdrwl_invest" DOUBLE PRECISION,
    "c_recp_return_invest" DOUBLE PRECISION,
    "n_recp_disp_fiolta" DOUBLE PRECISION,
    "n_recp_disp_sobu" DOUBLE PRECISION,
    "stot_inflows_inv_act" DOUBLE PRECISION,
    "c_pay_acq_const_fiolta" DOUBLE PRECISION,
    "c_paid_invest" DOUBLE PRECISION,
    "n_disp_subs_oth_biz" DOUBLE PRECISION,
    "oth_pay_ral_inv_act" DOUBLE PRECISION,
    "n_incr_pledge_loan" DOUBLE PRECISION,
    "stot_out_inv_act" DOUBLE PRECISION,
    "n_cashflow_inv_act" DOUBLE PRECISION,
    "c_recp_borrow" DOUBLE PRECISION,
    "proc_issue_bonds" DOUBLE PRECISION,
    "oth_cash_recp_ral_fnc_act" DOUBLE PRECISION,
    "stot_cash_in_fnc_act" DOUBLE PRECISION,
    "free_cashflow" DOUBLE PRECISION,
    "c_prepay_amt_borr" DOUBLE PRECISION,
    "c_pay_dist_dpcp_int_exp" DOUBLE PRECISION,
    "incl_dvd_profit_paid_sc_ms" DOUBLE PRECISION,
    "oth_cashpay_ral_fnc_act" DOUBLE PRECISION,
    "stot_cashout_fnc_act" DOUBLE PRECISION,
    "n_cash_flows_fnc_act" DOUBLE PRECISION,
    "eff_fx_flu_cash" DOUBLE PRECISION,
    "n_incr_cash_cash_equ" DOUBLE PRECISION,
    "c_cash_equ_beg_period" DOUBLE PRECISION,
    "c_cash_equ_end_period" DOUBLE PRECISION,
    "c_recp_cap_contrib" DOUBLE PRECISION,
    "incl_cash_rec_saims" DOUBLE PRECISION,
    "uncon_invest_loss" DOUBLE PRECISION,
    "prov_depr_assets" DOUBLE PRECISION,
    "depr_fa_coga_dpba" DOUBLE PRECISION,
    "amort_intang_assets" DOUBLE PRECISION,
    "lt_amort_deferred_exp" DOUBLE PRECISION,
    "decr_deferred_exp" DOUBLE PRECISION,
    "incr_acc_exp" DOUBLE PRECISION,
    "loss_disp_fiolta" DOUBLE PRECISION,
    "loss_scr_fa" DOUBLE PRECISION,
    "loss_fv_chg" DOUBLE PRECISION,
    "invest_loss" DOUBLE PRECISION,
    "decr_def_inc_tax_assets" DOUBLE PRECISION,
    "incr_def_inc_tax_liab" DOUBLE PRECISION,
    "decr_inventories" DOUBLE PRECISION,
    "decr_oper_payable" DOUBLE PRECISION,
    "incr_oper_payable" DOUBLE PRECISION,
    "others" DOUBLE PRECISION,
    "im_net_cashflow_oper_act" DOUBLE PRECISION,
    "conv_debt_into_cap" DOUBLE PRECISION,
    "conv_copbonds_due_within_1y" DOUBLE PRECISION,
    "fa_fnc_leases" DOUBLE PRECISION,
    "im_n_incr_cash_equ" DOUBLE PRECISION,
    "net_dism_capital_add" DOUBLE PRECISION,
    "net_cash_rece_sec" DOUBLE PRECISION,
    "credit_impa_loss" DOUBLE PRECISION,
    "use_right_asset_dep" DOUBLE PRECISION,
    "oth_loss_asset" DOUBLE PRECISION,
    "end_bal_cash" DOUBLE PRECISION,
    "beg_bal_cash" DOUBLE PRECISION,
    "end_bal_cash_equ" DOUBLE PRECISION,
    "beg_bal_cash_equ" DOUBLE PRECISION,
    "update_flag" VARCHAR(8),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashflow_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convertible_bond_basic" (
    "ts_code" VARCHAR(16) NOT NULL,
    "bond_full_name" VARCHAR(64),
    "bond_short_name" VARCHAR(32),
    "cb_code" VARCHAR(16),
    "stk_code" VARCHAR(16),
    "stk_short_name" VARCHAR(32),
    "maturity" DOUBLE PRECISION,
    "par" DOUBLE PRECISION,
    "issue_price" DOUBLE PRECISION,
    "issue_size" DOUBLE PRECISION,
    "remain_size" DOUBLE PRECISION,
    "value_date" DATE,
    "maturity_date" DATE,
    "rate_type" VARCHAR(16),
    "coupon_rate" DOUBLE PRECISION,
    "add_rate" DOUBLE PRECISION,
    "pay_per_year" INTEGER,
    "list_date" DATE,
    "delist_date" DATE,
    "exchange" VARCHAR(8),
    "conv_start_date" DATE,
    "conv_end_date" DATE,
    "conv_stop_date" DATE,
    "first_conv_price" DOUBLE PRECISION,
    "conv_price" DOUBLE PRECISION,
    "rate_clause" TEXT,
    "put_clause" TEXT,
    "maturity_put_price" VARCHAR(64),
    "call_clause" TEXT,
    "reset_clause" TEXT,
    "conv_clause" TEXT,
    "guarantor" VARCHAR(128),
    "guarantee_type" VARCHAR(64),
    "issue_rating" VARCHAR(16),
    "newest_rating" VARCHAR(16),
    "rating_comp" VARCHAR(64),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convertible_bond_basic_pkey" PRIMARY KEY ("ts_code")
);

-- CreateTable
CREATE TABLE "convertible_bond_daily_prices" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "pre_close" DOUBLE PRECISION,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "close" DOUBLE PRECISION,
    "change" DOUBLE PRECISION,
    "pct_chg" DOUBLE PRECISION,
    "vol" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "bond_value" DOUBLE PRECISION,
    "bond_over_rate" DOUBLE PRECISION,
    "cb_value" DOUBLE PRECISION,
    "cb_over_rate" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convertible_bond_daily_prices_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "stock_daily_prices" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "close" DOUBLE PRECISION,
    "pre_close" DOUBLE PRECISION,
    "change" DOUBLE PRECISION,
    "pct_chg" DOUBLE PRECISION,
    "vol" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_daily_prices_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "stock_daily_valuation_metrics" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "close" DOUBLE PRECISION,
    "turnover_rate" DOUBLE PRECISION,
    "turnover_rate_f" DOUBLE PRECISION,
    "volume_ratio" DOUBLE PRECISION,
    "pe" DOUBLE PRECISION,
    "pe_ttm" DOUBLE PRECISION,
    "pb" DOUBLE PRECISION,
    "ps" DOUBLE PRECISION,
    "ps_ttm" DOUBLE PRECISION,
    "dv_ratio" DOUBLE PRECISION,
    "dv_ttm" DOUBLE PRECISION,
    "total_share" DOUBLE PRECISION,
    "float_share" DOUBLE PRECISION,
    "free_share" DOUBLE PRECISION,
    "total_mv" DOUBLE PRECISION,
    "circ_mv" DOUBLE PRECISION,
    "limit_status" INTEGER,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_daily_valuation_metrics_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "financial_disclosure_schedules" (
    "ts_code" VARCHAR(16) NOT NULL,
    "end_date" DATE NOT NULL,
    "ann_date" DATE,
    "pre_date" DATE,
    "actual_date" DATE,
    "modify_date" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_disclosure_schedules_pkey" PRIMARY KEY ("ts_code","end_date")
);

-- CreateTable
CREATE TABLE "stock_dividend_events" (
    "id" BIGSERIAL NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "end_date" DATE,
    "ann_date" DATE,
    "div_proc" VARCHAR(32),
    "stk_div" DOUBLE PRECISION,
    "stk_bo_rate" DOUBLE PRECISION,
    "stk_co_rate" DOUBLE PRECISION,
    "cash_div" DOUBLE PRECISION,
    "cash_div_tax" DOUBLE PRECISION,
    "record_date" DATE,
    "ex_date" DATE,
    "pay_date" DATE,
    "div_listdate" DATE,
    "imp_ann_date" DATE,
    "base_date" DATE,
    "base_share" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_dividend_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earnings_express_reports" (
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "revenue" DOUBLE PRECISION,
    "operate_profit" DOUBLE PRECISION,
    "total_profit" DOUBLE PRECISION,
    "n_income" DOUBLE PRECISION,
    "total_assets" DOUBLE PRECISION,
    "total_hldr_eqy_exc_min_int" DOUBLE PRECISION,
    "diluted_eps" DOUBLE PRECISION,
    "diluted_roe" DOUBLE PRECISION,
    "yoy_net_profit" DOUBLE PRECISION,
    "bps" DOUBLE PRECISION,
    "yoy_sales" DOUBLE PRECISION,
    "yoy_op" DOUBLE PRECISION,
    "yoy_tp" DOUBLE PRECISION,
    "yoy_dedu_np" DOUBLE PRECISION,
    "yoy_eps" DOUBLE PRECISION,
    "yoy_roe" DOUBLE PRECISION,
    "growth_assets" DOUBLE PRECISION,
    "yoy_equity" DOUBLE PRECISION,
    "growth_bps" DOUBLE PRECISION,
    "or_last_year" DOUBLE PRECISION,
    "op_last_year" DOUBLE PRECISION,
    "tp_last_year" DOUBLE PRECISION,
    "np_last_year" DOUBLE PRECISION,
    "eps_last_year" DOUBLE PRECISION,
    "open_net_assets" DOUBLE PRECISION,
    "open_bps" DOUBLE PRECISION,
    "perf_summary" TEXT,
    "is_audit" INTEGER,
    "remark" TEXT,
    "update_flag" VARCHAR(8),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earnings_express_reports_pkey" PRIMARY KEY ("ts_code","end_date","ann_date")
);

-- CreateTable
CREATE TABLE "financial_audit_opinions" (
    "ts_code" VARCHAR(16) NOT NULL,
    "end_date" DATE NOT NULL,
    "ann_date" DATE NOT NULL,
    "audit_result" VARCHAR(32),
    "audit_fees" DOUBLE PRECISION,
    "audit_agency" VARCHAR(128),
    "audit_sign" VARCHAR(128),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_audit_opinions_pkey" PRIMARY KEY ("ts_code","end_date")
);

-- CreateTable
CREATE TABLE "financial_indicator_snapshots" (
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE,
    "end_date" DATE NOT NULL,
    "eps" DOUBLE PRECISION,
    "dt_eps" DOUBLE PRECISION,
    "total_revenue_ps" DOUBLE PRECISION,
    "revenue_ps" DOUBLE PRECISION,
    "grossprofit_margin" DOUBLE PRECISION,
    "netprofit_margin" DOUBLE PRECISION,
    "roe" DOUBLE PRECISION,
    "dt_roe" DOUBLE PRECISION,
    "roa" DOUBLE PRECISION,
    "roa2" DOUBLE PRECISION,
    "debt_to_assets" DOUBLE PRECISION,
    "current_ratio" DOUBLE PRECISION,
    "quick_ratio" DOUBLE PRECISION,
    "cash_ratio" DOUBLE PRECISION,
    "fcff" DOUBLE PRECISION,
    "fcfe" DOUBLE PRECISION,
    "ebit" DOUBLE PRECISION,
    "ebitda" DOUBLE PRECISION,
    "netdebt" DOUBLE PRECISION,
    "ocf_to_netprofit" DOUBLE PRECISION,
    "ocf_to_or" DOUBLE PRECISION,
    "revenue_yoy" DOUBLE PRECISION,
    "netprofit_yoy" DOUBLE PRECISION,
    "ocf_yoy" DOUBLE PRECISION,
    "dt_eps_yoy" DOUBLE PRECISION,
    "roe_yoy" DOUBLE PRECISION,
    "bps_yoy" DOUBLE PRECISION,
    "assets_yoy" DOUBLE PRECISION,
    "eqt_yoy" DOUBLE PRECISION,
    "tr_yoy" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_indicator_snapshots_pkey" PRIMARY KEY ("ts_code","end_date")
);

-- CreateTable
CREATE TABLE "financial_main_business" (
    "id" SERIAL NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "end_date" DATE NOT NULL,
    "bz_item" VARCHAR(128) NOT NULL,
    "bz_sales" DOUBLE PRECISION,
    "bz_profit" DOUBLE PRECISION,
    "bz_cost" DOUBLE PRECISION,
    "curr_type" VARCHAR(8),
    "update_flag" VARCHAR(4),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_main_business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "earnings_forecast_reports" (
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "type" VARCHAR(10),
    "p_change_min" DOUBLE PRECISION,
    "p_change_max" DOUBLE PRECISION,
    "net_profit_min" DOUBLE PRECISION,
    "net_profit_max" DOUBLE PRECISION,
    "last_parent_net" DOUBLE PRECISION,
    "first_ann_date" DATE,
    "summary" TEXT,
    "change_reason" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "earnings_forecast_reports_pkey" PRIMARY KEY ("ts_code","ann_date","end_date")
);

-- CreateTable
CREATE TABLE "hk_hold_detail" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "exchange" VARCHAR(4) NOT NULL,
    "code" VARCHAR(16),
    "name" VARCHAR(32),
    "vol" BIGINT,
    "ratio" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hk_hold_detail_pkey" PRIMARY KEY ("ts_code","trade_date","exchange")
);

-- CreateTable
CREATE TABLE "income_statement_reports" (
    "id" BIGSERIAL NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE,
    "f_ann_date" DATE,
    "end_date" DATE NOT NULL,
    "report_type" VARCHAR(16),
    "comp_type" VARCHAR(16),
    "end_type" VARCHAR(16),
    "basic_eps" DOUBLE PRECISION,
    "diluted_eps" DOUBLE PRECISION,
    "total_revenue" DOUBLE PRECISION,
    "revenue" DOUBLE PRECISION,
    "int_income" DOUBLE PRECISION,
    "prem_earned" DOUBLE PRECISION,
    "comm_income" DOUBLE PRECISION,
    "n_commis_income" DOUBLE PRECISION,
    "n_oth_income" DOUBLE PRECISION,
    "n_oth_b_income" DOUBLE PRECISION,
    "prem_income" DOUBLE PRECISION,
    "out_prem" DOUBLE PRECISION,
    "une_prem_reser" DOUBLE PRECISION,
    "reins_income" DOUBLE PRECISION,
    "n_sec_tb_income" DOUBLE PRECISION,
    "n_sec_uw_income" DOUBLE PRECISION,
    "n_asset_mg_income" DOUBLE PRECISION,
    "oth_b_income" DOUBLE PRECISION,
    "fv_value_chg_gain" DOUBLE PRECISION,
    "invest_income" DOUBLE PRECISION,
    "ass_invest_income" DOUBLE PRECISION,
    "forex_gain" DOUBLE PRECISION,
    "total_cogs" DOUBLE PRECISION,
    "oper_cost" DOUBLE PRECISION,
    "int_exp" DOUBLE PRECISION,
    "comm_exp" DOUBLE PRECISION,
    "biz_tax_surchg" DOUBLE PRECISION,
    "sell_exp" DOUBLE PRECISION,
    "admin_exp" DOUBLE PRECISION,
    "fin_exp" DOUBLE PRECISION,
    "assets_impair_loss" DOUBLE PRECISION,
    "prem_refund" DOUBLE PRECISION,
    "compens_payout" DOUBLE PRECISION,
    "reser_insur_liab" DOUBLE PRECISION,
    "div_payt" DOUBLE PRECISION,
    "reins_exp" DOUBLE PRECISION,
    "oper_exp" DOUBLE PRECISION,
    "compens_payout_refu" DOUBLE PRECISION,
    "insur_reser_refu" DOUBLE PRECISION,
    "reins_cost_refund" DOUBLE PRECISION,
    "other_bus_cost" DOUBLE PRECISION,
    "operate_profit" DOUBLE PRECISION,
    "non_oper_income" DOUBLE PRECISION,
    "non_oper_exp" DOUBLE PRECISION,
    "nca_disploss" DOUBLE PRECISION,
    "total_profit" DOUBLE PRECISION,
    "income_tax" DOUBLE PRECISION,
    "n_income" DOUBLE PRECISION,
    "n_income_attr_p" DOUBLE PRECISION,
    "minority_gain" DOUBLE PRECISION,
    "oth_compr_income" DOUBLE PRECISION,
    "t_compr_income" DOUBLE PRECISION,
    "compr_inc_attr_p" DOUBLE PRECISION,
    "compr_inc_attr_m_s" DOUBLE PRECISION,
    "ebit" DOUBLE PRECISION,
    "ebitda" DOUBLE PRECISION,
    "insurance_exp" DOUBLE PRECISION,
    "undist_profit" DOUBLE PRECISION,
    "distable_profit" DOUBLE PRECISION,
    "rd_exp" DOUBLE PRECISION,
    "fin_exp_int_exp" DOUBLE PRECISION,
    "fin_exp_int_inc" DOUBLE PRECISION,
    "transfer_surplus_rese" DOUBLE PRECISION,
    "transfer_housing_imprest" DOUBLE PRECISION,
    "transfer_oth" DOUBLE PRECISION,
    "adj_lossgain" DOUBLE PRECISION,
    "withdra_legal_surplus" DOUBLE PRECISION,
    "withdra_legal_pubfund" DOUBLE PRECISION,
    "withdra_biz_devfund" DOUBLE PRECISION,
    "withdra_rese_fund" DOUBLE PRECISION,
    "withdra_oth_ersu" DOUBLE PRECISION,
    "workers_welfare" DOUBLE PRECISION,
    "distr_profit_shrhder" DOUBLE PRECISION,
    "prfshare_payable_dvd" DOUBLE PRECISION,
    "comshare_payable_dvd" DOUBLE PRECISION,
    "capit_comstock_div" DOUBLE PRECISION,
    "net_after_nr_lp_correct" DOUBLE PRECISION,
    "credit_impa_loss" DOUBLE PRECISION,
    "net_expo_hedging_benefits" DOUBLE PRECISION,
    "oth_impair_loss_assets" DOUBLE PRECISION,
    "total_opcost" DOUBLE PRECISION,
    "amodcost_fin_assets" DOUBLE PRECISION,
    "oth_income" DOUBLE PRECISION,
    "asset_disp_income" DOUBLE PRECISION,
    "continued_net_profit" DOUBLE PRECISION,
    "end_net_profit" DOUBLE PRECISION,
    "update_flag" VARCHAR(8),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "income_statement_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sw_industry_classification" (
    "index_code" VARCHAR(16) NOT NULL,
    "industry_name" VARCHAR(32) NOT NULL,
    "parent_code" VARCHAR(16) NOT NULL,
    "level" VARCHAR(4) NOT NULL,
    "industry_code" VARCHAR(16) NOT NULL,
    "is_pub" VARCHAR(4),
    "src" VARCHAR(8),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sw_industry_classification_pkey" PRIMARY KEY ("index_code")
);

-- CreateTable
CREATE TABLE "index_daily_prices" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "close" DOUBLE PRECISION,
    "pre_close" DOUBLE PRECISION,
    "change" DOUBLE PRECISION,
    "pct_chg" DOUBLE PRECISION,
    "vol" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_daily_prices_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "index_daily_valuation_metrics" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "total_mv" DOUBLE PRECISION,
    "float_mv" DOUBLE PRECISION,
    "total_share" DOUBLE PRECISION,
    "float_share" DOUBLE PRECISION,
    "free_share" DOUBLE PRECISION,
    "turnover_rate" DOUBLE PRECISION,
    "turnover_rate_f" DOUBLE PRECISION,
    "pe" DOUBLE PRECISION,
    "pe_ttm" DOUBLE PRECISION,
    "pb" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_daily_valuation_metrics_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "sw_industry_members" (
    "id" SERIAL NOT NULL,
    "l1_code" VARCHAR(16) NOT NULL,
    "l1_name" VARCHAR(32) NOT NULL,
    "l2_code" VARCHAR(16) NOT NULL,
    "l2_name" VARCHAR(32) NOT NULL,
    "l3_code" VARCHAR(16) NOT NULL,
    "l3_name" VARCHAR(32) NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "in_date" DATE,
    "out_date" DATE,
    "is_new" VARCHAR(4) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sw_industry_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "index_constituent_weights" (
    "index_code" TEXT NOT NULL,
    "con_code" TEXT NOT NULL,
    "trade_date" TEXT NOT NULL,
    "weight" DECIMAL(10,6),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "index_constituent_weights_pkey" PRIMARY KEY ("index_code","con_code","trade_date")
);

-- CreateTable
CREATE TABLE "margin_detail" (
    "ts_code" VARCHAR(12) NOT NULL,
    "trade_date" DATE NOT NULL,
    "rzye" DOUBLE PRECISION,
    "rzmre" DOUBLE PRECISION,
    "rzche" DOUBLE PRECISION,
    "rzjmre" DOUBLE PRECISION,
    "rqye" DOUBLE PRECISION,
    "rqmcl" DOUBLE PRECISION,
    "rqchl" DOUBLE PRECISION,
    "rqyl" DOUBLE PRECISION,
    "rzrqye" DOUBLE PRECISION,
    "rzrqyl" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "margin_detail_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "stock_capital_flows" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "buy_sm_vol" INTEGER,
    "buy_sm_amount" DOUBLE PRECISION,
    "sell_sm_vol" INTEGER,
    "sell_sm_amount" DOUBLE PRECISION,
    "buy_md_vol" INTEGER,
    "buy_md_amount" DOUBLE PRECISION,
    "sell_md_vol" INTEGER,
    "sell_md_amount" DOUBLE PRECISION,
    "buy_lg_vol" INTEGER,
    "buy_lg_amount" DOUBLE PRECISION,
    "sell_lg_vol" INTEGER,
    "sell_lg_amount" DOUBLE PRECISION,
    "buy_elg_vol" INTEGER,
    "buy_elg_amount" DOUBLE PRECISION,
    "sell_elg_vol" INTEGER,
    "sell_elg_amount" DOUBLE PRECISION,
    "net_mf_vol" INTEGER,
    "net_mf_amount" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_capital_flows_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "moneyflow_hsgt" (
    "trade_date" DATE NOT NULL,
    "ggt_ss" DOUBLE PRECISION,
    "ggt_sz" DOUBLE PRECISION,
    "hgt" DOUBLE PRECISION,
    "sgt" DOUBLE PRECISION,
    "north_money" DOUBLE PRECISION,
    "south_money" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moneyflow_hsgt_pkey" PRIMARY KEY ("trade_date")
);

-- CreateTable
CREATE TABLE "sector_capital_flows" (
    "ts_code" VARCHAR(32) NOT NULL,
    "trade_date" DATE NOT NULL,
    "content_type" "MoneyflowContentType" NOT NULL,
    "name" VARCHAR(128),
    "pct_change" DOUBLE PRECISION,
    "close" DOUBLE PRECISION,
    "net_amount" DOUBLE PRECISION,
    "net_amount_rate" DOUBLE PRECISION,
    "buy_elg_amount" DOUBLE PRECISION,
    "buy_elg_amount_rate" DOUBLE PRECISION,
    "buy_lg_amount" DOUBLE PRECISION,
    "buy_lg_amount_rate" DOUBLE PRECISION,
    "buy_md_amount" DOUBLE PRECISION,
    "buy_md_amount_rate" DOUBLE PRECISION,
    "buy_sm_amount" DOUBLE PRECISION,
    "buy_sm_amount_rate" DOUBLE PRECISION,
    "buy_sm_amount_stock" VARCHAR(64),
    "rank" INTEGER,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sector_capital_flows_pkey" PRIMARY KEY ("ts_code","trade_date","content_type")
);

-- CreateTable
CREATE TABLE "market_capital_flows" (
    "trade_date" DATE NOT NULL,
    "close_sh" DOUBLE PRECISION,
    "pct_change_sh" DOUBLE PRECISION,
    "close_sz" DOUBLE PRECISION,
    "pct_change_sz" DOUBLE PRECISION,
    "net_amount" DOUBLE PRECISION,
    "net_amount_rate" DOUBLE PRECISION,
    "buy_elg_amount" DOUBLE PRECISION,
    "buy_elg_amount_rate" DOUBLE PRECISION,
    "buy_lg_amount" DOUBLE PRECISION,
    "buy_lg_amount_rate" DOUBLE PRECISION,
    "buy_md_amount" DOUBLE PRECISION,
    "buy_md_amount_rate" DOUBLE PRECISION,
    "buy_sm_amount" DOUBLE PRECISION,
    "buy_sm_amount_rate" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_capital_flows_pkey" PRIMARY KEY ("trade_date")
);

-- CreateTable
CREATE TABLE "stock_monthly_prices" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "close" DOUBLE PRECISION,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "pre_close" DOUBLE PRECISION,
    "change" DOUBLE PRECISION,
    "pct_chg" DOUBLE PRECISION,
    "vol" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_monthly_prices_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "stock_pledge_statistics" (
    "ts_code" VARCHAR(16) NOT NULL,
    "end_date" DATE NOT NULL,
    "pledge_count" INTEGER NOT NULL,
    "unrest_pledge" DOUBLE PRECISION,
    "rest_pledge" DOUBLE PRECISION,
    "total_share" DOUBLE PRECISION,
    "pledge_ratio" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_pledge_statistics_pkey" PRIMARY KEY ("ts_code","end_date")
);

-- CreateTable
CREATE TABLE "stock_repurchase" (
    "id" SERIAL NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE NOT NULL,
    "end_date" DATE,
    "proc" VARCHAR(16),
    "exp_date" DATE,
    "vol" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "high_limit" DOUBLE PRECISION,
    "low_limit" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_repurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_float_schedule" (
    "id" SERIAL NOT NULL,
    "ts_code" TEXT NOT NULL,
    "ann_date" TEXT,
    "float_date" TEXT NOT NULL,
    "float_share" DECIMAL(20,4),
    "float_ratio" DECIMAL(10,6),
    "holder_name" TEXT,
    "share_type" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_float_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_holder_number" (
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "holder_num" INTEGER NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_holder_number_pkey" PRIMARY KEY ("ts_code","end_date")
);

-- CreateTable
CREATE TABLE "stock_holder_trades" (
    "id" SERIAL NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE NOT NULL,
    "holder_name" VARCHAR(128) NOT NULL,
    "holder_type" VARCHAR(4) NOT NULL,
    "in_de" VARCHAR(4) NOT NULL,
    "change_vol" DOUBLE PRECISION,
    "change_ratio" DOUBLE PRECISION,
    "after_share" DOUBLE PRECISION,
    "after_ratio" DOUBLE PRECISION,
    "avg_price" DOUBLE PRECISION,
    "total_share" DOUBLE PRECISION,
    "begin_date" DATE,
    "close_date" DATE,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_holder_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_limit_prices" (
    "ts_code" TEXT NOT NULL,
    "trade_date" TEXT NOT NULL,
    "up_limit" DECIMAL(20,4),
    "down_limit" DECIMAL(20,4),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_limit_prices_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "stock_basic_profiles" (
    "ts_code" VARCHAR(16) NOT NULL,
    "symbol" VARCHAR(16),
    "name" VARCHAR(64),
    "area" VARCHAR(64),
    "industry" VARCHAR(64),
    "fullname" VARCHAR(128),
    "enname" VARCHAR(128),
    "cnspell" VARCHAR(64),
    "market" VARCHAR(32),
    "exchange" "StockExchange",
    "curr_type" VARCHAR(16),
    "list_status" "StockListStatus",
    "list_date" DATE,
    "delist_date" DATE,
    "is_hs" VARCHAR(4),
    "act_name" VARCHAR(128),
    "act_ent_type" VARCHAR(64),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_basic_profiles_pkey" PRIMARY KEY ("ts_code")
);

-- CreateTable
CREATE TABLE "stock_company_profiles" (
    "ts_code" VARCHAR(16) NOT NULL,
    "com_name" VARCHAR(128),
    "com_id" VARCHAR(64),
    "chairman" VARCHAR(64),
    "manager" VARCHAR(64),
    "secretary" VARCHAR(64),
    "reg_capital" DOUBLE PRECISION,
    "setup_date" DATE,
    "province" VARCHAR(64),
    "city" VARCHAR(64),
    "introduction" TEXT,
    "website" VARCHAR(255),
    "email" VARCHAR(128),
    "office" TEXT,
    "ann_date" DATE,
    "business_scope" TEXT,
    "employees" INTEGER,
    "main_business" TEXT,
    "exchange" "StockExchange",
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_company_profiles_pkey" PRIMARY KEY ("ts_code")
);

-- CreateTable
CREATE TABLE "stock_suspend_events" (
    "ts_code" TEXT NOT NULL,
    "trade_date" TEXT NOT NULL,
    "suspend_timing" TEXT,
    "suspend_type" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_suspend_events_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "tushare_sync_progress" (
    "id" SERIAL NOT NULL,
    "task" "TushareSyncTask" NOT NULL,
    "last_success_key" TEXT,
    "total_keys" INTEGER,
    "completed_keys" INTEGER NOT NULL DEFAULT 0,
    "status" "TushareSyncProgressStatus" NOT NULL DEFAULT 'IDLE',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tushare_sync_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tushare_sync_retry_queue" (
    "id" SERIAL NOT NULL,
    "task" "TushareSyncTask" NOT NULL,
    "failed_key" TEXT,
    "error_message" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "next_retry_at" TIMESTAMP(3) NOT NULL,
    "status" "TushareSyncRetryStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tushare_sync_retry_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tushare_sync_logs" (
    "id" SERIAL NOT NULL,
    "task" "TushareSyncTask" NOT NULL,
    "status" "TushareSyncStatus" NOT NULL,
    "trade_date" DATE,
    "message" TEXT,
    "payload" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tushare_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ths_index_boards" (
    "ts_code" VARCHAR(24) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "count" INTEGER,
    "exchange" VARCHAR(8),
    "list_date" DATE,
    "type" VARCHAR(8) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ths_index_boards_pkey" PRIMARY KEY ("ts_code")
);

-- CreateTable
CREATE TABLE "ths_index_members" (
    "id" SERIAL NOT NULL,
    "ts_code" VARCHAR(24) NOT NULL,
    "con_code" VARCHAR(16) NOT NULL,
    "con_name" VARCHAR(64),
    "is_new" VARCHAR(4),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ths_index_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "top_ten_shareholder_snapshots" (
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE,
    "end_date" DATE NOT NULL,
    "holder_name" VARCHAR(128) NOT NULL,
    "hold_amount" DOUBLE PRECISION,
    "hold_ratio" DOUBLE PRECISION,
    "hold_float_ratio" DOUBLE PRECISION,
    "hold_change" DOUBLE PRECISION,
    "holder_type" VARCHAR(32),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "top_ten_shareholder_snapshots_pkey" PRIMARY KEY ("ts_code","end_date","holder_name")
);

-- CreateTable
CREATE TABLE "top_ten_float_shareholder_snapshots" (
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE,
    "end_date" DATE NOT NULL,
    "holder_name" VARCHAR(128) NOT NULL,
    "hold_amount" DOUBLE PRECISION,
    "hold_ratio" DOUBLE PRECISION,
    "hold_float_ratio" DOUBLE PRECISION,
    "hold_change" DOUBLE PRECISION,
    "holder_type" VARCHAR(32),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "top_ten_float_shareholder_snapshots_pkey" PRIMARY KEY ("ts_code","end_date","holder_name")
);

-- CreateTable
CREATE TABLE "top_inst_details" (
    "trade_date" TEXT NOT NULL,
    "ts_code" TEXT NOT NULL,
    "exalter" TEXT NOT NULL,
    "buy" DECIMAL(20,4),
    "buy_cost" DECIMAL(20,4),
    "sell" DECIMAL(20,4),
    "sell_cost" DECIMAL(20,4),
    "net_buy" DECIMAL(20,4),
    "side" TEXT,
    "reason" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "top_inst_details_pkey" PRIMARY KEY ("trade_date","ts_code","exalter")
);

-- CreateTable
CREATE TABLE "top_list_daily" (
    "trade_date" TEXT NOT NULL,
    "ts_code" TEXT NOT NULL,
    "name" TEXT,
    "close" DECIMAL(20,4),
    "pct_change" DECIMAL(10,4),
    "turnover_rate" DECIMAL(10,4),
    "amount" DECIMAL(20,4),
    "l_sell" DECIMAL(20,4),
    "l_buy" DECIMAL(20,4),
    "l_amount" DECIMAL(20,4),
    "net_amount" DECIMAL(20,4),
    "net_rate" DECIMAL(10,6),
    "amount_rate" DECIMAL(10,6),
    "float_values" DECIMAL(20,4),
    "reason" TEXT,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "top_list_daily_pkey" PRIMARY KEY ("trade_date","ts_code")
);

-- CreateTable
CREATE TABLE "exchange_trade_calendars" (
    "exchange" "StockExchange" NOT NULL,
    "cal_date" DATE NOT NULL,
    "is_open" CHAR(1),
    "pretrade_date" DATE,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_trade_calendars_pkey" PRIMARY KEY ("exchange","cal_date")
);

-- CreateTable
CREATE TABLE "stock_weekly_prices" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "close" DOUBLE PRECISION,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "pre_close" DOUBLE PRECISION,
    "change" DOUBLE PRECISION,
    "pct_chg" DOUBLE PRECISION,
    "vol" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_weekly_prices_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "account" VARCHAR(64) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "nickname" VARCHAR(64) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "email" VARCHAR(128),
    "wechat" VARCHAR(64),
    "lastLoginAt" TIMESTAMP(3),
    "backtestQuota" INTEGER NOT NULL DEFAULT 3,
    "watchlistLimit" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlists" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(200),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_stocks" (
    "id" SERIAL NOT NULL,
    "watchlist_id" INTEGER NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "notes" VARCHAR(500),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_price" DECIMAL(10,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watchlist_stocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_operatorId_idx" ON "audit_logs"("operatorId");

-- CreateIndex
CREATE INDEX "audit_logs_targetId_idx" ON "audit_logs"("targetId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "backtest_runs_user_id_created_at_idx" ON "backtest_runs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "backtest_runs_status_created_at_idx" ON "backtest_runs"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "backtest_daily_navs_trade_date_idx" ON "backtest_daily_navs"("trade_date");

-- CreateIndex
CREATE INDEX "backtest_trades_run_id_trade_date_idx" ON "backtest_trades"("run_id", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "backtest_trades_ts_code_trade_date_idx" ON "backtest_trades"("ts_code", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "backtest_position_snapshots_run_id_trade_date_idx" ON "backtest_position_snapshots"("run_id", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "backtest_rebalance_logs_run_id_signal_date_idx" ON "backtest_rebalance_logs"("run_id", "signal_date" DESC);

-- CreateIndex
CREATE INDEX "backtest_walk_forward_runs_user_id_created_at_idx" ON "backtest_walk_forward_runs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "backtest_walk_forward_windows_wf_run_id_window_index_key" ON "backtest_walk_forward_windows"("wf_run_id", "window_index");

-- CreateIndex
CREATE INDEX "backtest_comparison_groups_user_id_created_at_idx" ON "backtest_comparison_groups"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "data_quality_checks_data_set_check_date_idx" ON "data_quality_checks"("data_set", "check_date");

-- CreateIndex
CREATE INDEX "data_quality_checks_status_idx" ON "data_quality_checks"("status");

-- CreateIndex
CREATE INDEX "data_validation_logs_task_trade_date_idx" ON "data_validation_logs"("task", "trade_date");

-- CreateIndex
CREATE UNIQUE INDEX "factor_definitions_name_key" ON "factor_definitions"("name");

-- CreateIndex
CREATE INDEX "factor_definitions_category_idx" ON "factor_definitions"("category");

-- CreateIndex
CREATE INDEX "factor_definitions_is_builtin_is_enabled_idx" ON "factor_definitions"("is_builtin", "is_enabled");

-- CreateIndex
CREATE INDEX "factor_snapshots_factor_name_trade_date_idx" ON "factor_snapshots"("factor_name", "trade_date");

-- CreateIndex
CREATE INDEX "factor_snapshots_trade_date_factor_name_idx" ON "factor_snapshots"("trade_date", "factor_name");

-- CreateIndex
CREATE INDEX "factor_snapshots_ts_code_trade_date_idx" ON "factor_snapshots"("ts_code", "trade_date");

-- CreateIndex
CREATE INDEX "heatmap_snapshots_trade_date_group_by_idx" ON "heatmap_snapshots"("trade_date", "group_by");

-- CreateIndex
CREATE INDEX "heatmap_snapshots_ts_code_trade_date_idx" ON "heatmap_snapshots"("ts_code", "trade_date");

-- CreateIndex
CREATE INDEX "heatmap_snapshot_statuses_trade_date_idx" ON "heatmap_snapshot_statuses"("trade_date");

-- CreateIndex
CREATE INDEX "research_notes_user_id_created_at_idx" ON "research_notes"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "research_notes_user_id_ts_code_idx" ON "research_notes"("user_id", "ts_code");

-- CreateIndex
CREATE INDEX "research_notes_user_id_is_pinned_idx" ON "research_notes"("user_id", "is_pinned");

-- CreateIndex
CREATE INDEX "screener_strategies_user_id_idx" ON "screener_strategies"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "screener_strategies_user_id_name_key" ON "screener_strategies"("user_id", "name");

-- CreateIndex
CREATE INDEX "screener_subscriptions_user_id_idx" ON "screener_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "screener_subscriptions_status_frequency_idx" ON "screener_subscriptions"("status", "frequency");

-- CreateIndex
CREATE INDEX "screener_subscription_logs_subscription_id_created_at_idx" ON "screener_subscription_logs"("subscription_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "screener_subscription_logs_subscription_id_trade_date_idx" ON "screener_subscription_logs"("subscription_id", "trade_date");

-- CreateIndex
CREATE INDEX "strategies_user_id_updated_at_idx" ON "strategies"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "strategies_strategy_type_idx" ON "strategies"("strategy_type");

-- CreateIndex
CREATE INDEX "strategies_is_public_idx" ON "strategies"("is_public");

-- CreateIndex
CREATE UNIQUE INDEX "strategies_user_id_name_key" ON "strategies"("user_id", "name");

-- CreateIndex
CREATE INDEX "strategy_drafts_user_id_updated_at_idx" ON "strategy_drafts"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "strategy_drafts_user_id_name_key" ON "strategy_drafts"("user_id", "name");

-- CreateIndex
CREATE INDEX "stock_adjustment_factors_trade_date_idx" ON "stock_adjustment_factors"("trade_date");

-- CreateIndex
CREATE INDEX "balance_sheet_reports_ts_code_end_date_idx" ON "balance_sheet_reports"("ts_code", "end_date" DESC);

-- CreateIndex
CREATE INDEX "balance_sheet_reports_ts_code_report_type_end_date_idx" ON "balance_sheet_reports"("ts_code", "report_type", "end_date" DESC);

-- CreateIndex
CREATE INDEX "balance_sheet_reports_ann_date_idx" ON "balance_sheet_reports"("ann_date");

-- CreateIndex
CREATE INDEX "balance_sheet_reports_f_ann_date_idx" ON "balance_sheet_reports"("f_ann_date");

-- CreateIndex
CREATE INDEX "block_trade_daily_ts_code_idx" ON "block_trade_daily"("ts_code");

-- CreateIndex
CREATE INDEX "block_trade_daily_trade_date_idx" ON "block_trade_daily"("trade_date");

-- CreateIndex
CREATE UNIQUE INDEX "block_trade_daily_trade_date_ts_code_buyer_seller_key" ON "block_trade_daily"("trade_date", "ts_code", "buyer", "seller");

-- CreateIndex
CREATE INDEX "cashflow_reports_ts_code_end_date_idx" ON "cashflow_reports"("ts_code", "end_date" DESC);

-- CreateIndex
CREATE INDEX "cashflow_reports_ts_code_report_type_end_date_idx" ON "cashflow_reports"("ts_code", "report_type", "end_date" DESC);

-- CreateIndex
CREATE INDEX "cashflow_reports_ann_date_idx" ON "cashflow_reports"("ann_date");

-- CreateIndex
CREATE INDEX "cashflow_reports_f_ann_date_idx" ON "cashflow_reports"("f_ann_date");

-- CreateIndex
CREATE INDEX "convertible_bond_basic_stk_code_idx" ON "convertible_bond_basic"("stk_code");

-- CreateIndex
CREATE INDEX "convertible_bond_basic_list_date_idx" ON "convertible_bond_basic"("list_date");

-- CreateIndex
CREATE INDEX "convertible_bond_daily_prices_trade_date_idx" ON "convertible_bond_daily_prices"("trade_date");

-- CreateIndex
CREATE INDEX "stock_daily_prices_trade_date_idx" ON "stock_daily_prices"("trade_date");

-- CreateIndex
CREATE INDEX "stock_daily_prices_ts_code_trade_date_idx" ON "stock_daily_prices"("ts_code", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "stock_daily_valuation_metrics_trade_date_idx" ON "stock_daily_valuation_metrics"("trade_date");

-- CreateIndex
CREATE INDEX "stock_daily_valuation_metrics_ts_code_trade_date_idx" ON "stock_daily_valuation_metrics"("ts_code", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "financial_disclosure_schedules_end_date_idx" ON "financial_disclosure_schedules"("end_date");

-- CreateIndex
CREATE INDEX "stock_dividend_events_ann_date_idx" ON "stock_dividend_events"("ann_date");

-- CreateIndex
CREATE INDEX "stock_dividend_events_ts_code_ann_date_idx" ON "stock_dividend_events"("ts_code", "ann_date");

-- CreateIndex
CREATE INDEX "stock_dividend_events_end_date_idx" ON "stock_dividend_events"("end_date");

-- CreateIndex
CREATE INDEX "stock_dividend_events_ex_date_idx" ON "stock_dividend_events"("ex_date");

-- CreateIndex
CREATE INDEX "earnings_express_reports_ann_date_idx" ON "earnings_express_reports"("ann_date");

-- CreateIndex
CREATE INDEX "earnings_express_reports_ts_code_ann_date_idx" ON "earnings_express_reports"("ts_code", "ann_date" DESC);

-- CreateIndex
CREATE INDEX "financial_audit_opinions_end_date_idx" ON "financial_audit_opinions"("end_date");

-- CreateIndex
CREATE INDEX "financial_audit_opinions_ann_date_idx" ON "financial_audit_opinions"("ann_date");

-- CreateIndex
CREATE INDEX "financial_indicator_snapshots_ann_date_idx" ON "financial_indicator_snapshots"("ann_date");

-- CreateIndex
CREATE INDEX "financial_main_business_ts_code_idx" ON "financial_main_business"("ts_code");

-- CreateIndex
CREATE INDEX "financial_main_business_end_date_idx" ON "financial_main_business"("end_date");

-- CreateIndex
CREATE UNIQUE INDEX "financial_main_business_ts_code_end_date_bz_item_key" ON "financial_main_business"("ts_code", "end_date", "bz_item");

-- CreateIndex
CREATE INDEX "earnings_forecast_reports_end_date_idx" ON "earnings_forecast_reports"("end_date");

-- CreateIndex
CREATE INDEX "earnings_forecast_reports_ann_date_idx" ON "earnings_forecast_reports"("ann_date");

-- CreateIndex
CREATE INDEX "hk_hold_detail_trade_date_idx" ON "hk_hold_detail"("trade_date");

-- CreateIndex
CREATE INDEX "income_statement_reports_ts_code_end_date_idx" ON "income_statement_reports"("ts_code", "end_date" DESC);

-- CreateIndex
CREATE INDEX "income_statement_reports_ts_code_report_type_end_date_idx" ON "income_statement_reports"("ts_code", "report_type", "end_date" DESC);

-- CreateIndex
CREATE INDEX "income_statement_reports_ann_date_idx" ON "income_statement_reports"("ann_date");

-- CreateIndex
CREATE INDEX "income_statement_reports_f_ann_date_idx" ON "income_statement_reports"("f_ann_date");

-- CreateIndex
CREATE INDEX "sw_industry_classification_level_idx" ON "sw_industry_classification"("level");

-- CreateIndex
CREATE INDEX "sw_industry_classification_parent_code_idx" ON "sw_industry_classification"("parent_code");

-- CreateIndex
CREATE INDEX "index_daily_prices_trade_date_idx" ON "index_daily_prices"("trade_date");

-- CreateIndex
CREATE INDEX "index_daily_prices_ts_code_trade_date_idx" ON "index_daily_prices"("ts_code", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "index_daily_valuation_metrics_trade_date_idx" ON "index_daily_valuation_metrics"("trade_date");

-- CreateIndex
CREATE INDEX "sw_industry_members_ts_code_idx" ON "sw_industry_members"("ts_code");

-- CreateIndex
CREATE INDEX "sw_industry_members_l1_code_idx" ON "sw_industry_members"("l1_code");

-- CreateIndex
CREATE INDEX "sw_industry_members_is_new_idx" ON "sw_industry_members"("is_new");

-- CreateIndex
CREATE UNIQUE INDEX "sw_industry_members_l3_code_ts_code_in_date_key" ON "sw_industry_members"("l3_code", "ts_code", "in_date");

-- CreateIndex
CREATE INDEX "index_constituent_weights_index_code_trade_date_idx" ON "index_constituent_weights"("index_code", "trade_date");

-- CreateIndex
CREATE INDEX "index_constituent_weights_con_code_idx" ON "index_constituent_weights"("con_code");

-- CreateIndex
CREATE INDEX "margin_detail_trade_date_idx" ON "margin_detail"("trade_date");

-- CreateIndex
CREATE INDEX "margin_detail_ts_code_trade_date_idx" ON "margin_detail"("ts_code", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "stock_capital_flows_trade_date_idx" ON "stock_capital_flows"("trade_date");

-- CreateIndex
CREATE INDEX "sector_capital_flows_trade_date_content_type_idx" ON "sector_capital_flows"("trade_date", "content_type");

-- CreateIndex
CREATE INDEX "stock_monthly_prices_trade_date_idx" ON "stock_monthly_prices"("trade_date");

-- CreateIndex
CREATE INDEX "stock_pledge_statistics_end_date_idx" ON "stock_pledge_statistics"("end_date");

-- CreateIndex
CREATE INDEX "stock_repurchase_ts_code_idx" ON "stock_repurchase"("ts_code");

-- CreateIndex
CREATE INDEX "stock_repurchase_ann_date_idx" ON "stock_repurchase"("ann_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_repurchase_ts_code_ann_date_key" ON "stock_repurchase"("ts_code", "ann_date");

-- CreateIndex
CREATE INDEX "share_float_schedule_float_date_idx" ON "share_float_schedule"("float_date");

-- CreateIndex
CREATE UNIQUE INDEX "share_float_schedule_ts_code_float_date_holder_name_key" ON "share_float_schedule"("ts_code", "float_date", "holder_name");

-- CreateIndex
CREATE INDEX "stock_holder_number_end_date_idx" ON "stock_holder_number"("end_date");

-- CreateIndex
CREATE INDEX "stock_holder_number_ann_date_idx" ON "stock_holder_number"("ann_date");

-- CreateIndex
CREATE INDEX "stock_holder_trades_ts_code_idx" ON "stock_holder_trades"("ts_code");

-- CreateIndex
CREATE INDEX "stock_holder_trades_ann_date_idx" ON "stock_holder_trades"("ann_date");

-- CreateIndex
CREATE UNIQUE INDEX "stock_holder_trades_ts_code_ann_date_holder_name_in_de_key" ON "stock_holder_trades"("ts_code", "ann_date", "holder_name", "in_de");

-- CreateIndex
CREATE INDEX "stock_limit_prices_trade_date_idx" ON "stock_limit_prices"("trade_date");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_symbol_idx" ON "stock_basic_profiles"("symbol");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_name_idx" ON "stock_basic_profiles"("name");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_cnspell_idx" ON "stock_basic_profiles"("cnspell");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_exchange_idx" ON "stock_basic_profiles"("exchange");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_industry_idx" ON "stock_basic_profiles"("industry");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_area_idx" ON "stock_basic_profiles"("area");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_market_idx" ON "stock_basic_profiles"("market");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_is_hs_idx" ON "stock_basic_profiles"("is_hs");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_list_status_idx" ON "stock_basic_profiles"("list_status");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_list_status_exchange_market_idx" ON "stock_basic_profiles"("list_status", "exchange", "market");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_list_status_industry_area_idx" ON "stock_basic_profiles"("list_status", "industry", "area");

-- CreateIndex
CREATE INDEX "stock_basic_profiles_list_status_list_date_idx" ON "stock_basic_profiles"("list_status", "list_date");

-- CreateIndex
CREATE INDEX "stock_company_profiles_exchange_idx" ON "stock_company_profiles"("exchange");

-- CreateIndex
CREATE INDEX "stock_company_profiles_ann_date_idx" ON "stock_company_profiles"("ann_date");

-- CreateIndex
CREATE INDEX "stock_suspend_events_trade_date_idx" ON "stock_suspend_events"("trade_date");

-- CreateIndex
CREATE UNIQUE INDEX "tushare_sync_progress_task_key" ON "tushare_sync_progress"("task");

-- CreateIndex
CREATE INDEX "tushare_sync_retry_queue_status_next_retry_at_idx" ON "tushare_sync_retry_queue"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "tushare_sync_retry_queue_task_status_idx" ON "tushare_sync_retry_queue"("task", "status");

-- CreateIndex
CREATE INDEX "tushare_sync_logs_task_status_started_at_idx" ON "tushare_sync_logs"("task", "status", "started_at" DESC);

-- CreateIndex
CREATE INDEX "tushare_sync_logs_trade_date_idx" ON "tushare_sync_logs"("trade_date");

-- CreateIndex
CREATE INDEX "ths_index_boards_type_idx" ON "ths_index_boards"("type");

-- CreateIndex
CREATE INDEX "ths_index_boards_exchange_idx" ON "ths_index_boards"("exchange");

-- CreateIndex
CREATE INDEX "ths_index_boards_name_idx" ON "ths_index_boards"("name");

-- CreateIndex
CREATE INDEX "ths_index_members_ts_code_idx" ON "ths_index_members"("ts_code");

-- CreateIndex
CREATE INDEX "ths_index_members_con_code_idx" ON "ths_index_members"("con_code");

-- CreateIndex
CREATE INDEX "ths_index_members_con_code_is_new_idx" ON "ths_index_members"("con_code", "is_new");

-- CreateIndex
CREATE UNIQUE INDEX "ths_index_members_ts_code_con_code_key" ON "ths_index_members"("ts_code", "con_code");

-- CreateIndex
CREATE INDEX "top_ten_shareholder_snapshots_end_date_idx" ON "top_ten_shareholder_snapshots"("end_date");

-- CreateIndex
CREATE INDEX "top_ten_float_shareholder_snapshots_end_date_idx" ON "top_ten_float_shareholder_snapshots"("end_date");

-- CreateIndex
CREATE INDEX "top_inst_details_ts_code_idx" ON "top_inst_details"("ts_code");

-- CreateIndex
CREATE INDEX "top_inst_details_exalter_idx" ON "top_inst_details"("exalter");

-- CreateIndex
CREATE INDEX "top_list_daily_ts_code_idx" ON "top_list_daily"("ts_code");

-- CreateIndex
CREATE INDEX "exchange_trade_calendars_cal_date_is_open_idx" ON "exchange_trade_calendars"("cal_date", "is_open");

-- CreateIndex
CREATE INDEX "stock_weekly_prices_trade_date_idx" ON "stock_weekly_prices"("trade_date");

-- CreateIndex
CREATE UNIQUE INDEX "users_account_key" ON "users"("account");

-- CreateIndex
CREATE INDEX "watchlists_user_id_idx" ON "watchlists"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "watchlists_user_id_name_key" ON "watchlists"("user_id", "name");

-- CreateIndex
CREATE INDEX "watchlist_stocks_watchlist_id_sort_order_idx" ON "watchlist_stocks"("watchlist_id", "sort_order");

-- CreateIndex
CREATE INDEX "watchlist_stocks_ts_code_idx" ON "watchlist_stocks"("ts_code");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_stocks_watchlist_id_ts_code_key" ON "watchlist_stocks"("watchlist_id", "ts_code");

-- AddForeignKey
ALTER TABLE "backtest_walk_forward_windows" ADD CONSTRAINT "backtest_walk_forward_windows_wf_run_id_fkey" FOREIGN KEY ("wf_run_id") REFERENCES "backtest_walk_forward_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_notes" ADD CONSTRAINT "research_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screener_strategies" ADD CONSTRAINT "screener_strategies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screener_subscriptions" ADD CONSTRAINT "screener_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "strategy_drafts" ADD CONSTRAINT "strategy_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ths_index_members" ADD CONSTRAINT "ths_index_members_ts_code_fkey" FOREIGN KEY ("ts_code") REFERENCES "ths_index_boards"("ts_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_stocks" ADD CONSTRAINT "watchlist_stocks_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "watchlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
