-- Backfill valuation_daily_medians with pre-computed per-industry daily PE/PB medians.
-- This table is used by the industry-rotation/valuation API to avoid expensive
-- PERCENTILE_CONT aggregations over millions of raw stock rows at query time.
-- After this migration, syncDailyBasic will keep the table updated incrementally.
--
-- NOTE: This INSERT may take ~60s on large datasets. statement_timeout is disabled
-- for this session to allow the backfill to complete.

SET statement_timeout = 0;

INSERT INTO valuation_daily_medians (trade_date, scope, pe_ttm_median, pb_median, stock_count, computed_at)
SELECT
  db.trade_date,
  sb.industry AS scope,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db.pe_ttm) AS pe_ttm_median,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY db.pb) AS pb_median,
  COUNT(*)::int AS stock_count,
  NOW() AS computed_at
FROM stock_daily_valuation_metrics db
JOIN stock_basic_profiles sb ON sb.ts_code = db.ts_code
WHERE sb.list_status = 'L'
  AND sb.industry IS NOT NULL
  AND sb.industry != ''
  AND db.pe_ttm > 0 AND db.pe_ttm < 1000
  AND db.pb > 0
GROUP BY db.trade_date, sb.industry
ON CONFLICT (trade_date, scope) DO UPDATE SET
  pe_ttm_median = EXCLUDED.pe_ttm_median,
  pb_median = EXCLUDED.pb_median,
  stock_count = EXCLUDED.stock_count,
  computed_at = EXCLUDED.computed_at;
