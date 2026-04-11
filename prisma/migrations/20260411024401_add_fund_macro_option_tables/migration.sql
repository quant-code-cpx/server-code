-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TushareSyncTask" ADD VALUE 'FUND_BASIC';
ALTER TYPE "TushareSyncTask" ADD VALUE 'FUND_NAV';
ALTER TYPE "TushareSyncTask" ADD VALUE 'FUND_DAILY';
ALTER TYPE "TushareSyncTask" ADD VALUE 'CN_CPI';
ALTER TYPE "TushareSyncTask" ADD VALUE 'CN_PPI';
ALTER TYPE "TushareSyncTask" ADD VALUE 'CN_GDP';
ALTER TYPE "TushareSyncTask" ADD VALUE 'SHIBOR';
ALTER TYPE "TushareSyncTask" ADD VALUE 'OPT_BASIC';
ALTER TYPE "TushareSyncTask" ADD VALUE 'OPT_DAILY';

-- CreateTable
CREATE TABLE "fund_basic" (
    "ts_code" VARCHAR(16) NOT NULL,
    "name" VARCHAR(100),
    "management" VARCHAR(100),
    "custodian" VARCHAR(100),
    "fund_type" VARCHAR(20),
    "found_date" DATE,
    "due_date" DATE,
    "list_date" DATE,
    "issue_date" DATE,
    "delist_date" DATE,
    "issue_amount" DOUBLE PRECISION,
    "m_fee" DOUBLE PRECISION,
    "c_fee" DOUBLE PRECISION,
    "duration_year" DOUBLE PRECISION,
    "p_value" DOUBLE PRECISION,
    "min_amount" DOUBLE PRECISION,
    "exp_return" DOUBLE PRECISION,
    "benchmark" TEXT,
    "status" VARCHAR(4),
    "invest_type" VARCHAR(40),
    "type" VARCHAR(40),
    "trustee" VARCHAR(100),
    "purc_startdate" DATE,
    "redm_startdate" DATE,
    "market" VARCHAR(4),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_basic_pkey" PRIMARY KEY ("ts_code")
);

-- CreateTable
CREATE TABLE "fund_daily" (
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

    CONSTRAINT "fund_daily_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateTable
CREATE TABLE "fund_nav" (
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE,
    "nav_date" DATE NOT NULL,
    "unit_nav" DOUBLE PRECISION,
    "accum_nav" DOUBLE PRECISION,
    "accum_div" DOUBLE PRECISION,
    "net_asset" DOUBLE PRECISION,
    "total_netasset" DOUBLE PRECISION,
    "adj_nav" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_nav_pkey" PRIMARY KEY ("ts_code","nav_date")
);

-- CreateTable
CREATE TABLE "macro_cpi" (
    "month" VARCHAR(8) NOT NULL,
    "nt_val" DOUBLE PRECISION,
    "nt_yoy" DOUBLE PRECISION,
    "nt_mom" DOUBLE PRECISION,
    "nt_accu" DOUBLE PRECISION,
    "town_val" DOUBLE PRECISION,
    "town_yoy" DOUBLE PRECISION,
    "town_mom" DOUBLE PRECISION,
    "town_accu" DOUBLE PRECISION,
    "cnt_val" DOUBLE PRECISION,
    "cnt_yoy" DOUBLE PRECISION,
    "cnt_mom" DOUBLE PRECISION,
    "cnt_accu" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "macro_cpi_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "macro_ppi" (
    "month" VARCHAR(8) NOT NULL,
    "ppi_yoy" DOUBLE PRECISION,
    "ppi_mp_yoy" DOUBLE PRECISION,
    "ppi_mp_qm_yoy" DOUBLE PRECISION,
    "ppi_mp_rm_yoy" DOUBLE PRECISION,
    "ppi_mp_p_yoy" DOUBLE PRECISION,
    "ppi_cg_yoy" DOUBLE PRECISION,
    "ppi_cg_f_yoy" DOUBLE PRECISION,
    "ppi_cg_c_yoy" DOUBLE PRECISION,
    "ppi_cg_adu_yoy" DOUBLE PRECISION,
    "ppi_cg_dcg_yoy" DOUBLE PRECISION,
    "ppi_mom" DOUBLE PRECISION,
    "ppi_mp_mom" DOUBLE PRECISION,
    "ppi_mp_qm_mom" DOUBLE PRECISION,
    "ppi_mp_rm_mom" DOUBLE PRECISION,
    "ppi_mp_p_mom" DOUBLE PRECISION,
    "ppi_cg_mom" DOUBLE PRECISION,
    "ppi_cg_f_mom" DOUBLE PRECISION,
    "ppi_cg_c_mom" DOUBLE PRECISION,
    "ppi_cg_adu_mom" DOUBLE PRECISION,
    "ppi_cg_dcg_mom" DOUBLE PRECISION,
    "ppi_accu" DOUBLE PRECISION,
    "ppi_mp_accu" DOUBLE PRECISION,
    "ppi_mp_qm_accu" DOUBLE PRECISION,
    "ppi_mp_rm_accu" DOUBLE PRECISION,
    "ppi_mp_p_accu" DOUBLE PRECISION,
    "ppi_cg_accu" DOUBLE PRECISION,
    "ppi_cg_f_accu" DOUBLE PRECISION,
    "ppi_cg_c_accu" DOUBLE PRECISION,
    "ppi_cg_adu_accu" DOUBLE PRECISION,
    "ppi_cg_dcg_accu" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "macro_ppi_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "macro_gdp" (
    "quarter" VARCHAR(8) NOT NULL,
    "gdp" DOUBLE PRECISION,
    "gdp_yoy" DOUBLE PRECISION,
    "pi" DOUBLE PRECISION,
    "pi_yoy" DOUBLE PRECISION,
    "si" DOUBLE PRECISION,
    "si_yoy" DOUBLE PRECISION,
    "ti" DOUBLE PRECISION,
    "ti_yoy" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "macro_gdp_pkey" PRIMARY KEY ("quarter")
);

-- CreateTable
CREATE TABLE "macro_shibor" (
    "date" DATE NOT NULL,
    "on" DOUBLE PRECISION,
    "1w" DOUBLE PRECISION,
    "2w" DOUBLE PRECISION,
    "1m" DOUBLE PRECISION,
    "3m" DOUBLE PRECISION,
    "6m" DOUBLE PRECISION,
    "9m" DOUBLE PRECISION,
    "1y" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "macro_shibor_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "opt_basic" (
    "ts_code" VARCHAR(30) NOT NULL,
    "exchange" VARCHAR(10),
    "name" VARCHAR(100),
    "per_unit" VARCHAR(20),
    "opt_code" VARCHAR(30),
    "opt_type" VARCHAR(10),
    "call_put" VARCHAR(4),
    "exercise_type" VARCHAR(10),
    "exercise_price" DOUBLE PRECISION,
    "s_month" VARCHAR(10),
    "maturity_date" DATE,
    "list_price" DOUBLE PRECISION,
    "list_date" DATE,
    "delist_date" DATE,
    "last_edate" DATE,
    "last_ddate" DATE,
    "quote_unit" VARCHAR(20),
    "min_price_chg" VARCHAR(20),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opt_basic_pkey" PRIMARY KEY ("ts_code")
);

-- CreateTable
CREATE TABLE "opt_daily" (
    "ts_code" VARCHAR(30) NOT NULL,
    "trade_date" DATE NOT NULL,
    "exchange" VARCHAR(10),
    "pre_settle" DOUBLE PRECISION,
    "pre_close" DOUBLE PRECISION,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "close" DOUBLE PRECISION,
    "settle" DOUBLE PRECISION,
    "vol" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "oi" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opt_daily_pkey" PRIMARY KEY ("ts_code","trade_date")
);

-- CreateIndex
CREATE INDEX "fund_daily_trade_date_idx" ON "fund_daily"("trade_date");

-- CreateIndex
CREATE INDEX "fund_daily_ts_code_trade_date_idx" ON "fund_daily"("ts_code", "trade_date" DESC);

-- CreateIndex
CREATE INDEX "fund_nav_nav_date_idx" ON "fund_nav"("nav_date");

-- CreateIndex
CREATE INDEX "fund_nav_ts_code_nav_date_idx" ON "fund_nav"("ts_code", "nav_date" DESC);

-- CreateIndex
CREATE INDEX "macro_shibor_date_idx" ON "macro_shibor"("date" DESC);

-- CreateIndex
CREATE INDEX "opt_basic_exchange_idx" ON "opt_basic"("exchange");

-- CreateIndex
CREATE INDEX "opt_basic_call_put_idx" ON "opt_basic"("call_put");

-- CreateIndex
CREATE INDEX "opt_daily_trade_date_idx" ON "opt_daily"("trade_date");

-- CreateIndex
CREATE INDEX "opt_daily_exchange_trade_date_idx" ON "opt_daily"("exchange", "trade_date");
