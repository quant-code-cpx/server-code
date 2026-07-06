-- Optimize slow dashboard APIs:
-- 1) Precompute all-market valuation medians for market/valuation and market/valuation-trend.
-- 2) Add an index for latest sync-log lookups by task.

SET statement_timeout = 0;

INSERT INTO valuation_daily_medians (trade_date, scope, pe_ttm_median, pb_median, stock_count, computed_at)
SELECT
  db.trade_date,
  '__ALL__' AS scope,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db.pe_ttm) AS pe_ttm_median,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db.pb) AS pb_median,
  COUNT(*)::int AS stock_count,
  NOW() AS computed_at
FROM stock_daily_valuation_metrics db
WHERE db.pe_ttm > 0 AND db.pe_ttm < 1000
  AND db.pb > 0
GROUP BY db.trade_date
ON CONFLICT (trade_date, scope) DO UPDATE SET
  pe_ttm_median = EXCLUDED.pe_ttm_median,
  pb_median = EXCLUDED.pb_median,
  stock_count = EXCLUDED.stock_count,
  computed_at = EXCLUDED.computed_at;

CREATE INDEX IF NOT EXISTS "tushare_sync_logs_task_started_at_idx"
  ON "tushare_sync_logs"("task", "started_at" DESC);
