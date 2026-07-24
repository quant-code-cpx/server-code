WITH ranked_history AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY rule_id, trade_date, ts_code
      ORDER BY triggered_at ASC, id ASC
    ) AS duplicate_rank
  FROM price_alert_trigger_history
)
DELETE FROM price_alert_trigger_history AS history
USING ranked_history
WHERE history.id = ranked_history.id
  AND ranked_history.duplicate_rank > 1;

WITH rule_trigger_stats AS (
  SELECT
    rule_id,
    (
      COUNT(DISTINCT scan_batch_id) FILTER (WHERE scan_batch_id IS NOT NULL)
      + COUNT(DISTINCT trade_date) FILTER (WHERE scan_batch_id IS NULL)
    )::integer AS trigger_count,
    MAX(triggered_at) AS last_triggered_at
  FROM price_alert_trigger_history
  GROUP BY rule_id
)
UPDATE price_alert_rules AS rule
SET
  trigger_count = stats.trigger_count,
  last_triggered_at = stats.last_triggered_at
FROM rule_trigger_stats AS stats
WHERE rule.id = stats.rule_id;

CREATE UNIQUE INDEX "price_alert_trigger_history_rule_id_trade_date_ts_code_key"
ON "price_alert_trigger_history"("rule_id", "trade_date", "ts_code");
