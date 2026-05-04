-- Create price_alert_trigger_history table
CREATE TABLE IF NOT EXISTS "price_alert_trigger_history" (
  "id"            SERIAL        PRIMARY KEY,
  "rule_id"       INTEGER       NOT NULL,
  "user_id"       INTEGER       NOT NULL,
  "ts_code"       VARCHAR(20)   NOT NULL,
  "stock_name"    VARCHAR(100),
  "rule_type"     VARCHAR(30)   NOT NULL,
  "threshold"     DOUBLE PRECISION,
  "actual_value"  DOUBLE PRECISION NOT NULL,
  "close_price"   DOUBLE PRECISION,
  "pct_chg"       DOUBLE PRECISION,
  "trade_date"    VARCHAR(8)    NOT NULL,
  "source_type"   VARCHAR(30),
  "source_name"   VARCHAR(100),
  "scan_batch_id" VARCHAR(36),
  "triggered_at"  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT "price_alert_trigger_history_rule_id_fkey"
    FOREIGN KEY ("rule_id") REFERENCES "price_alert_rules"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "price_alert_trigger_history_user_id_triggered_at_idx"
  ON "price_alert_trigger_history" ("user_id", "triggered_at" DESC);

CREATE INDEX IF NOT EXISTS "price_alert_trigger_history_rule_id_triggered_at_idx"
  ON "price_alert_trigger_history" ("rule_id", "triggered_at" DESC);

CREATE INDEX IF NOT EXISTS "price_alert_trigger_history_trade_date_idx"
  ON "price_alert_trigger_history" ("trade_date");
