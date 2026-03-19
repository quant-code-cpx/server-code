-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DEACTIVATED', 'DELETED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "StockExchange" AS ENUM ('SSE', 'SZSE', 'BSE', 'HKEX');

-- CreateEnum
CREATE TYPE "StockListStatus" AS ENUM ('L', 'D', 'P');

-- CreateEnum
CREATE TYPE "MoneyflowContentType" AS ENUM ('行业', '概念', '地域');

-- CreateEnum
CREATE TYPE "TushareSyncTask" AS ENUM ('STOCK_BASIC', 'STOCK_COMPANY', 'TRADE_CAL', 'DAILY', 'WEEKLY', 'MONTHLY', 'ADJ_FACTOR', 'DAILY_BASIC', 'MONEYFLOW_DC', 'MONEYFLOW_IND_DC', 'MONEYFLOW_MKT_DC', 'EXPRESS');

-- CreateEnum
CREATE TYPE "TushareSyncStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

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
CREATE TABLE "stock_basic" (
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

    CONSTRAINT "stock_basic_pkey" PRIMARY KEY ("ts_code")
);

-- CreateTable
CREATE TABLE "stock_company" (
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

    CONSTRAINT "stock_company_pkey" PRIMARY KEY ("ts_code")
);

-- CreateTable
CREATE TABLE "trade_cal" (
    "exchange" "StockExchange" NOT NULL,
    "cal_date" DATE NOT NULL,
    "is_open" CHAR(1),
    "pretrade_date" DATE,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_cal_pkey" PRIMARY KEY ("exchange","cal_date")
);

-- CreateTable
CREATE TABLE "daily" (
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

    CONSTRAINT "daily_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "weekly" (
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

    CONSTRAINT "weekly_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "monthly" (
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

    CONSTRAINT "monthly_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "adj_factor" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "adj_factor" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adj_factor_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "daily_basic" (
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

    CONSTRAINT "daily_basic_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "moneyflow_dc" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "name" VARCHAR(64),
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
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moneyflow_dc_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "moneyflow_ind_dc" (
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

    CONSTRAINT "moneyflow_ind_dc_pkey" PRIMARY KEY ("ts_code","trade_date","content_type")
);

-- CreateTable
CREATE TABLE "moneyflow_mkt_dc" (
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

    CONSTRAINT "moneyflow_mkt_dc_pkey" PRIMARY KEY ("trade_date")
);

-- CreateTable
CREATE TABLE "express" (
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
    "update_flag" DATE,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "express_pkey" PRIMARY KEY ("ts_code","end_date","ann_date")
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

-- CreateIndex
CREATE UNIQUE INDEX "users_account_key" ON "users"("account");

-- CreateIndex
CREATE INDEX "stock_basic_symbol_idx" ON "stock_basic"("symbol");

-- CreateIndex
CREATE INDEX "stock_basic_name_idx" ON "stock_basic"("name");

-- CreateIndex
CREATE INDEX "stock_basic_exchange_idx" ON "stock_basic"("exchange");

-- CreateIndex
CREATE INDEX "stock_basic_industry_idx" ON "stock_basic"("industry");

-- CreateIndex
CREATE INDEX "stock_basic_list_status_idx" ON "stock_basic"("list_status");

-- CreateIndex
CREATE INDEX "stock_company_exchange_idx" ON "stock_company"("exchange");

-- CreateIndex
CREATE INDEX "stock_company_ann_date_idx" ON "stock_company"("ann_date");

-- CreateIndex
CREATE INDEX "trade_cal_cal_date_is_open_idx" ON "trade_cal"("cal_date", "is_open");

-- CreateIndex
CREATE INDEX "daily_trade_date_idx" ON "daily"("trade_date");

-- CreateIndex
CREATE INDEX "weekly_trade_date_idx" ON "weekly"("trade_date");

-- CreateIndex
CREATE INDEX "monthly_trade_date_idx" ON "monthly"("trade_date");

-- CreateIndex
CREATE INDEX "adj_factor_trade_date_idx" ON "adj_factor"("trade_date");

-- CreateIndex
CREATE INDEX "daily_basic_trade_date_idx" ON "daily_basic"("trade_date");

-- CreateIndex
CREATE INDEX "moneyflow_dc_trade_date_idx" ON "moneyflow_dc"("trade_date");

-- CreateIndex
CREATE INDEX "moneyflow_ind_dc_trade_date_content_type_idx" ON "moneyflow_ind_dc"("trade_date", "content_type");

-- CreateIndex
CREATE INDEX "express_ann_date_idx" ON "express"("ann_date");

-- CreateIndex
CREATE INDEX "tushare_sync_logs_task_status_started_at_idx" ON "tushare_sync_logs"("task", "status", "started_at" DESC);

-- CreateIndex
CREATE INDEX "tushare_sync_logs_trade_date_idx" ON "tushare_sync_logs"("trade_date");
