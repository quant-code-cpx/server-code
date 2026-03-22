-- Broaden dividend row identity so multiple events sharing the same ts_code + ann_date are preserved.
-- Existing dividend data is known to be sparse/incomplete, so the application layer will rebuild it from Tushare after deploy.

ALTER TABLE "stock_dividend_events"
  ADD COLUMN IF NOT EXISTS "id" BIGSERIAL;

ALTER TABLE "stock_dividend_events"
  DROP CONSTRAINT IF EXISTS "dividend_pkey";

ALTER TABLE "stock_dividend_events"
  ADD CONSTRAINT "stock_dividend_events_pkey" PRIMARY KEY ("id");

CREATE INDEX IF NOT EXISTS "stock_dividend_events_ann_date_idx"
  ON "stock_dividend_events"("ann_date");

CREATE INDEX IF NOT EXISTS "stock_dividend_events_ts_code_ann_date_idx"
  ON "stock_dividend_events"("ts_code", "ann_date");
