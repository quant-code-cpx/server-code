-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TushareSyncTask" ADD VALUE 'FINA_INDICATOR';
ALTER TYPE "TushareSyncTask" ADD VALUE 'DIVIDEND';
ALTER TYPE "TushareSyncTask" ADD VALUE 'TOP10_HOLDERS';
ALTER TYPE "TushareSyncTask" ADD VALUE 'TOP10_FLOAT_HOLDERS';

-- CreateTable
CREATE TABLE "dividend" (
    "ts_code" VARCHAR(16) NOT NULL,
    "end_date" DATE,
    "ann_date" DATE NOT NULL,
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

    CONSTRAINT "dividend_pkey" PRIMARY KEY ("ts_code","ann_date")
);

-- CreateTable
CREATE TABLE "fina_indicator" (
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

    CONSTRAINT "fina_indicator_pkey" PRIMARY KEY ("ts_code","end_date")
);

-- CreateTable
CREATE TABLE "top10_holders" (
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE,
    "end_date" DATE NOT NULL,
    "holder_name" VARCHAR(128) NOT NULL,
    "hold_amount" DOUBLE PRECISION,
    "hold_ratio" DOUBLE PRECISION,
    "holder_type" VARCHAR(32),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "top10_holders_pkey" PRIMARY KEY ("ts_code","end_date","holder_name")
);

-- CreateTable
CREATE TABLE "top10_float_holders" (
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE,
    "end_date" DATE NOT NULL,
    "holder_name" VARCHAR(128) NOT NULL,
    "hold_amount" DOUBLE PRECISION,
    "hold_ratio" DOUBLE PRECISION,
    "holder_type" VARCHAR(32),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "top10_float_holders_pkey" PRIMARY KEY ("ts_code","end_date","holder_name")
);

-- CreateIndex
CREATE INDEX "dividend_end_date_idx" ON "dividend"("end_date");

-- CreateIndex
CREATE INDEX "dividend_ex_date_idx" ON "dividend"("ex_date");

-- CreateIndex
CREATE INDEX "fina_indicator_ann_date_idx" ON "fina_indicator"("ann_date");

-- CreateIndex
CREATE INDEX "top10_holders_end_date_idx" ON "top10_holders"("end_date");

-- CreateIndex
CREATE INDEX "top10_float_holders_end_date_idx" ON "top10_float_holders"("end_date");
