-- CreateEnum
CREATE TYPE "price_alert_rule_type" AS ENUM ('PCT_CHANGE_UP', 'PCT_CHANGE_DOWN', 'PRICE_ABOVE', 'PRICE_BELOW', 'LIMIT_UP', 'LIMIT_DOWN');

-- CreateEnum
CREATE TYPE "price_alert_rule_status" AS ENUM ('ACTIVE', 'PAUSED', 'DELETED');

-- CreateEnum
CREATE TYPE "market_anomaly_type" AS ENUM ('VOLUME_SURGE', 'CONSECUTIVE_LIMIT_UP', 'LARGE_NET_INFLOW');

-- CreateTable
CREATE TABLE "price_alert_rules" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "stock_name" VARCHAR(64),
    "rule_type" "price_alert_rule_type" NOT NULL,
    "threshold" DOUBLE PRECISION,
    "memo" VARCHAR(256),
    "status" "price_alert_rule_status" NOT NULL DEFAULT 'ACTIVE',
    "last_triggered_at" TIMESTAMP(3),
    "trigger_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_anomalies" (
    "id" SERIAL NOT NULL,
    "trade_date" DATE NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "stock_name" VARCHAR(64),
    "anomaly_type" "market_anomaly_type" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_anomalies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_alert_rules_user_id_status_idx" ON "price_alert_rules"("user_id", "status");

-- CreateIndex
CREATE INDEX "price_alert_rules_ts_code_status_idx" ON "price_alert_rules"("ts_code", "status");

-- CreateIndex
CREATE INDEX "market_anomalies_trade_date_idx" ON "market_anomalies"("trade_date");

-- CreateIndex
CREATE INDEX "market_anomalies_anomaly_type_trade_date_idx" ON "market_anomalies"("anomaly_type", "trade_date");

-- CreateIndex
CREATE UNIQUE INDEX "market_anomalies_trade_date_ts_code_anomaly_type_key" ON "market_anomalies"("trade_date", "ts_code", "anomaly_type");
