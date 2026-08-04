-- B3: 技术事件订阅的日级可审计快照与稀疏事件事实表。
CREATE TABLE "technical_signal_daily_snapshots" (
  "id" BIGSERIAL NOT NULL,
  "ts_code" VARCHAR(16) NOT NULL,
  "trade_date" VARCHAR(8) NOT NULL,
  "catalog_version" VARCHAR(40) NOT NULL,
  "bullish_count" INTEGER NOT NULL,
  "bearish_count" INTEGER NOT NULL,
  "total_score" DECIMAL(10,4),
  "metrics" JSONB NOT NULL,
  "data_versions" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "technical_signal_daily_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "technical_signal_daily_snapshots_ts_code_trade_date_catalog_version_key"
  ON "technical_signal_daily_snapshots"("ts_code", "trade_date", "catalog_version");
CREATE INDEX "technical_signal_daily_snapshots_trade_date_bullish_count_idx"
  ON "technical_signal_daily_snapshots"("trade_date", "bullish_count");

CREATE TABLE "technical_signal_events" (
  "id" BIGSERIAL NOT NULL,
  "ts_code" VARCHAR(16) NOT NULL,
  "trade_date" VARCHAR(8) NOT NULL,
  "metric_id" VARCHAR(50) NOT NULL,
  "semantics_version" VARCHAR(30) NOT NULL,
  "event_type" VARCHAR(40) NOT NULL,
  "direction" VARCHAR(10),
  "strength" DECIMAL(10,4),
  "event_key" VARCHAR(160) NOT NULL,
  "evidence" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "technical_signal_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "technical_signal_events_ts_code_trade_date_event_key_key"
  ON "technical_signal_events"("ts_code", "trade_date", "event_key");
CREATE INDEX "technical_signal_events_trade_date_metric_id_event_type_idx"
  ON "technical_signal_events"("trade_date", "metric_id", "event_type");
CREATE INDEX "technical_signal_events_ts_code_trade_date_idx"
  ON "technical_signal_events"("ts_code", "trade_date" DESC);
