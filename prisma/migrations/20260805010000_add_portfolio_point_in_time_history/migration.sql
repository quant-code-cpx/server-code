-- Expand-first: immutable holding events and rebuildable point-in-time snapshots.
CREATE TABLE "portfolio_holding_events" (
    "id" TEXT NOT NULL,
    "portfolio_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "holding_id" TEXT,
    "ts_code" VARCHAR(16) NOT NULL,
    "action" VARCHAR(24) NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "price" DECIMAL(20,4),
    "before_quantity" INTEGER NOT NULL,
    "after_quantity" INTEGER NOT NULL,
    "before_avg_cost" DECIMAL(20,4),
    "after_avg_cost" DECIMAL(20,4),
    "effective_date" DATE NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "metadata" JSONB,
    CONSTRAINT "portfolio_holding_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "portfolio_daily_snapshots" (
    "portfolio_id" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "total_assets" DECIMAL(24,4) NOT NULL,
    "market_value" DECIMAL(24,4) NOT NULL,
    "cash" DECIMAL(24,4) NOT NULL,
    "nav" DECIMAL(20,8) NOT NULL,
    "daily_return" DOUBLE PRECISION,
    "benchmark_code" VARCHAR(16) NOT NULL,
    "benchmark_nav" DECIMAL(20,8),
    "benchmark_return" DOUBLE PRECISION,
    "source_event_through" TIMESTAMPTZ(3),
    "algorithm_version" VARCHAR(64) NOT NULL,
    "quality_flags" JSONB NOT NULL DEFAULT '[]',
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "portfolio_daily_snapshots_pkey" PRIMARY KEY ("portfolio_id", "trade_date")
);

CREATE TABLE "portfolio_position_snapshots" (
    "portfolio_id" TEXT NOT NULL,
    "trade_date" DATE NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "avg_cost" DECIMAL(20,4) NOT NULL,
    "close" DECIMAL(20,4),
    "price_date" DATE,
    "market_value" DECIMAL(24,4),
    "weight" DOUBLE PRECISION,
    "algorithm_version" VARCHAR(64) NOT NULL,
    "quality_flags" JSONB NOT NULL DEFAULT '[]',
    CONSTRAINT "portfolio_position_snapshots_pkey" PRIMARY KEY ("portfolio_id", "trade_date", "ts_code")
);

CREATE UNIQUE INDEX "portfolio_holding_events_user_id_idempotency_key_key"
ON "portfolio_holding_events"("user_id", "idempotency_key");
CREATE INDEX "portfolio_holding_events_portfolio_id_effective_date_occurred_at_idx"
ON "portfolio_holding_events"("portfolio_id", "effective_date", "occurred_at");
CREATE INDEX "portfolio_daily_snapshots_trade_date_idx" ON "portfolio_daily_snapshots"("trade_date");
CREATE INDEX "portfolio_position_snapshots_portfolio_id_ts_code_trade_date_idx"
ON "portfolio_position_snapshots"("portfolio_id", "ts_code", "trade_date");

ALTER TABLE "portfolio_holding_events"
ADD CONSTRAINT "portfolio_holding_events_portfolio_id_fkey"
FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_daily_snapshots"
ADD CONSTRAINT "portfolio_daily_snapshots_portfolio_id_fkey"
FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "portfolio_position_snapshots"
ADD CONSTRAINT "portfolio_position_snapshots_portfolio_id_fkey"
FOREIGN KEY ("portfolio_id") REFERENCES "portfolios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing trade logs are not assumed complete. Seed only a migration-day opening state.
INSERT INTO "portfolio_holding_events" (
    "id", "portfolio_id", "user_id", "holding_id", "ts_code", "action",
    "quantity_delta", "price", "before_quantity", "after_quantity",
    "before_avg_cost", "after_avg_cost", "effective_date", "idempotency_key", "source", "metadata"
)
SELECT
    'mig_' || md5(h."id" || ':' || to_char(c.coverage_start, 'YYYYMMDD')),
    h."portfolioId", p."userId", h."id", h."tsCode", 'OPENING_SNAPSHOT',
    h."quantity", h."avgCost", 0, h."quantity", NULL, h."avgCost", c.coverage_start,
    'migration:opening:' || h."id" || ':' || to_char(c.coverage_start, 'YYYYMMDD'), 'MIGRATION',
    jsonb_build_object('coverageStart', to_char(c.coverage_start, 'YYYY-MM-DD'), 'stockName', h."stockName")
FROM "portfolio_holdings" h
JOIN "portfolios" p ON p."id" = h."portfolioId"
CROSS JOIN (
    SELECT COALESCE(MAX("trade_date"), CURRENT_DATE) AS coverage_start
    FROM "stock_daily_prices"
    WHERE "trade_date" <= CURRENT_DATE
) c
ON CONFLICT ("user_id", "idempotency_key") DO NOTHING;
