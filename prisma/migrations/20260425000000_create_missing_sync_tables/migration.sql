-- Restore tables that exist in the current Prisma datamodel and development
-- database, but were never created by the checked-in migration chain.
--
-- This migration intentionally predates
-- 20260426000002_backfill_valuation_daily_medians so a fresh database can run
-- the valuation backfill only after valuation_daily_medians exists. Every
-- CREATE is idempotent because existing databases already contain these tables.

CREATE TABLE IF NOT EXISTS "valuation_daily_medians" (
    "trade_date" DATE NOT NULL,
    "scope" VARCHAR(64) NOT NULL,
    "pe_ttm_median" DOUBLE PRECISION,
    "pb_median" DOUBLE PRECISION,
    "stock_count" INTEGER,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "valuation_daily_medians_pkey" PRIMARY KEY ("trade_date", "scope")
);

CREATE INDEX IF NOT EXISTS "valuation_daily_medians_scope_trade_date_idx"
    ON "valuation_daily_medians"("scope", "trade_date" DESC);

CREATE TABLE IF NOT EXISTS "cyq_chips" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "percent" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cyq_chips_pkey" PRIMARY KEY ("ts_code", "trade_date", "price")
);

CREATE INDEX IF NOT EXISTS "cyq_chips_trade_date_idx"
    ON "cyq_chips"("trade_date");
CREATE INDEX IF NOT EXISTS "cyq_chips_ts_code_trade_date_idx"
    ON "cyq_chips"("ts_code", "trade_date" DESC);

CREATE TABLE IF NOT EXISTS "cyq_perf" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "his_low" DOUBLE PRECISION,
    "his_high" DOUBLE PRECISION,
    "cost_5pct" DOUBLE PRECISION,
    "cost_15pct" DOUBLE PRECISION,
    "cost_50pct" DOUBLE PRECISION,
    "cost_85pct" DOUBLE PRECISION,
    "cost_95pct" DOUBLE PRECISION,
    "weight_avg" DOUBLE PRECISION,
    "winner_rate" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cyq_perf_pkey" PRIMARY KEY ("ts_code", "trade_date")
);

CREATE INDEX IF NOT EXISTS "cyq_perf_trade_date_idx"
    ON "cyq_perf"("trade_date");
CREATE INDEX IF NOT EXISTS "cyq_perf_ts_code_trade_date_idx"
    ON "cyq_perf"("ts_code", "trade_date" DESC);

CREATE TABLE IF NOT EXISTS "limit_list_d" (
    "trade_date" DATE NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "industry" VARCHAR(32),
    "name" VARCHAR(32),
    "close" DOUBLE PRECISION,
    "pct_chg" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "limit_amount" DOUBLE PRECISION,
    "float_mv" DOUBLE PRECISION,
    "total_mv" DOUBLE PRECISION,
    "turnover_ratio" DOUBLE PRECISION,
    "fd_amount" DOUBLE PRECISION,
    "first_time" VARCHAR(8),
    "last_time" VARCHAR(8),
    "open_times" INTEGER,
    "strth" DOUBLE PRECISION,
    "limit" VARCHAR(2),
    "up_stat" VARCHAR(16),
    "limit_times" INTEGER,
    "connected" BOOLEAN,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "limit_list_d_pkey" PRIMARY KEY ("trade_date", "ts_code")
);

CREATE INDEX IF NOT EXISTS "limit_list_d_trade_date_idx"
    ON "limit_list_d"("trade_date");
CREATE INDEX IF NOT EXISTS "limit_list_d_ts_code_trade_date_idx"
    ON "limit_list_d"("ts_code", "trade_date" DESC);

CREATE TABLE IF NOT EXISTS "fund_adj" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "adj_factor" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fund_adj_pkey" PRIMARY KEY ("ts_code", "trade_date")
);

CREATE INDEX IF NOT EXISTS "fund_adj_trade_date_idx"
    ON "fund_adj"("trade_date");
CREATE INDEX IF NOT EXISTS "fund_adj_ts_code_trade_date_idx"
    ON "fund_adj"("ts_code", "trade_date" DESC);

CREATE TABLE IF NOT EXISTS "fund_portfolio" (
    "ts_code" VARCHAR(16) NOT NULL,
    "ann_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "symbol" VARCHAR(16) NOT NULL,
    "mkv" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "stk_mkv_ratio" DOUBLE PRECISION,
    "stk_float_ratio" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fund_portfolio_pkey" PRIMARY KEY ("ts_code", "end_date", "symbol")
);

CREATE INDEX IF NOT EXISTS "fund_portfolio_end_date_idx"
    ON "fund_portfolio"("end_date");
CREATE INDEX IF NOT EXISTS "fund_portfolio_ts_code_end_date_idx"
    ON "fund_portfolio"("ts_code", "end_date" DESC);
CREATE INDEX IF NOT EXISTS "fund_portfolio_symbol_end_date_idx"
    ON "fund_portfolio"("symbol", "end_date" DESC);

CREATE TABLE IF NOT EXISTS "fund_share" (
    "ts_code" VARCHAR(16) NOT NULL,
    "trade_date" DATE NOT NULL,
    "fd_share" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fund_share_pkey" PRIMARY KEY ("ts_code", "trade_date")
);

CREATE INDEX IF NOT EXISTS "fund_share_trade_date_idx"
    ON "fund_share"("trade_date");
CREATE INDEX IF NOT EXISTS "fund_share_ts_code_trade_date_idx"
    ON "fund_share"("ts_code", "trade_date" DESC);

CREATE TABLE IF NOT EXISTS "ths_daily" (
    "ts_code" VARCHAR(24) NOT NULL,
    "trade_date" DATE NOT NULL,
    "close" DOUBLE PRECISION,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "pre_close" DOUBLE PRECISION,
    "avg_price" DOUBLE PRECISION,
    "change" DOUBLE PRECISION,
    "pct_chg" DOUBLE PRECISION,
    "vol" DOUBLE PRECISION,
    "turnover_rate" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ths_daily_pkey" PRIMARY KEY ("ts_code", "trade_date")
);

CREATE INDEX IF NOT EXISTS "ths_daily_trade_date_idx"
    ON "ths_daily"("trade_date");
CREATE INDEX IF NOT EXISTS "ths_daily_ts_code_trade_date_idx"
    ON "ths_daily"("ts_code", "trade_date" DESC);

CREATE TABLE IF NOT EXISTS "daily_info" (
    "trade_date" DATE NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "ts_name" VARCHAR(32),
    "com_count" INTEGER,
    "total_share" DOUBLE PRECISION,
    "float_share" DOUBLE PRECISION,
    "total_mv" DOUBLE PRECISION,
    "float_mv" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION,
    "vol" DOUBLE PRECISION,
    "trans_count" INTEGER,
    "pe" DOUBLE PRECISION,
    "tr" DOUBLE PRECISION,
    "exchange" VARCHAR(8),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_info_pkey" PRIMARY KEY ("trade_date", "ts_code")
);

CREATE INDEX IF NOT EXISTS "daily_info_trade_date_idx"
    ON "daily_info"("trade_date");

CREATE TABLE IF NOT EXISTS "ggt_daily" (
    "trade_date" DATE NOT NULL,
    "buy_amount" DOUBLE PRECISION,
    "buy_volume" DOUBLE PRECISION,
    "sell_amount" DOUBLE PRECISION,
    "sell_volume" DOUBLE PRECISION,
    "net_amount" DOUBLE PRECISION,
    "net_volume" DOUBLE PRECISION,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ggt_daily_pkey" PRIMARY KEY ("trade_date")
);

-- Existing databases may contain tables created outside the migration chain.
-- Recreate missing primary keys explicitly without changing existing data.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'valuation_daily_medians_pkey') THEN
        ALTER TABLE "valuation_daily_medians" ADD CONSTRAINT "valuation_daily_medians_pkey" PRIMARY KEY ("trade_date", "scope");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cyq_chips_pkey') THEN
        ALTER TABLE "cyq_chips" ADD CONSTRAINT "cyq_chips_pkey" PRIMARY KEY ("ts_code", "trade_date", "price");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cyq_perf_pkey') THEN
        ALTER TABLE "cyq_perf" ADD CONSTRAINT "cyq_perf_pkey" PRIMARY KEY ("ts_code", "trade_date");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'limit_list_d_pkey') THEN
        ALTER TABLE "limit_list_d" ADD CONSTRAINT "limit_list_d_pkey" PRIMARY KEY ("trade_date", "ts_code");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_adj_pkey') THEN
        ALTER TABLE "fund_adj" ADD CONSTRAINT "fund_adj_pkey" PRIMARY KEY ("ts_code", "trade_date");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_portfolio_pkey') THEN
        ALTER TABLE "fund_portfolio" ADD CONSTRAINT "fund_portfolio_pkey" PRIMARY KEY ("ts_code", "end_date", "symbol");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fund_share_pkey') THEN
        ALTER TABLE "fund_share" ADD CONSTRAINT "fund_share_pkey" PRIMARY KEY ("ts_code", "trade_date");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ths_daily_pkey') THEN
        ALTER TABLE "ths_daily" ADD CONSTRAINT "ths_daily_pkey" PRIMARY KEY ("ts_code", "trade_date");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_info_pkey') THEN
        ALTER TABLE "daily_info" ADD CONSTRAINT "daily_info_pkey" PRIMARY KEY ("trade_date", "ts_code");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ggt_daily_pkey') THEN
        ALTER TABLE "ggt_daily" ADD CONSTRAINT "ggt_daily_pkey" PRIMARY KEY ("trade_date");
    END IF;
END $$;
