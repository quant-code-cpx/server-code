-- CreateEnum
CREATE TYPE "EventSignalRuleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DELETED');

-- CreateTable
CREATE TABLE "event_signal_rules" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "event_type" VARCHAR(32) NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "signal_type" VARCHAR(8) NOT NULL DEFAULT 'WATCH',
    "status" "EventSignalRuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_signal_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_signals" (
    "id" SERIAL NOT NULL,
    "rule_id" INTEGER NOT NULL,
    "ts_code" VARCHAR(16) NOT NULL,
    "stock_name" VARCHAR(64),
    "event_date" DATE NOT NULL,
    "signal_type" VARCHAR(8) NOT NULL,
    "event_detail" JSONB NOT NULL DEFAULT '{}',
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_signals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_signal_rules_user_id_idx" ON "event_signal_rules"("user_id");

-- CreateIndex
CREATE INDEX "event_signal_rules_status_event_type_idx" ON "event_signal_rules"("status", "event_type");

-- CreateIndex
CREATE INDEX "event_signals_rule_id_idx" ON "event_signals"("rule_id");

-- CreateIndex
CREATE INDEX "event_signals_ts_code_idx" ON "event_signals"("ts_code");

-- CreateIndex
CREATE INDEX "event_signals_triggered_at_idx" ON "event_signals"("triggered_at");

-- AddForeignKey
ALTER TABLE "event_signals" ADD CONSTRAINT "event_signals_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "event_signal_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
