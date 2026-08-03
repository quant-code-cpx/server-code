-- B0: 条件订阅正确性基线。
-- 先扩展结构与回填历史记录；保留 legacy filters，避免存量订阅中断。

CREATE TYPE "subscription_rule_type" AS ENUM ('STOCK_SCREENING', 'FACTOR_SCREENING', 'SIGNAL_EVENT', 'COMPOSITE');
CREATE TYPE "subscription_run_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED_DATA_NOT_READY');
CREATE TYPE "subscription_hit_kind" AS ENUM ('ENTER', 'EXIT', 'EVENT');

ALTER TABLE "screener_subscriptions"
  ADD COLUMN "rule_type" "subscription_rule_type" NOT NULL DEFAULT 'STOCK_SCREENING',
  ADD COLUMN "rule_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "rule_spec" JSONB,
  ADD COLUMN "trigger_spec" JSONB,
  ADD COLUMN "notification_spec" JSONB,
  ADD COLUMN "rule_fingerprint" VARCHAR(64),
  ADD COLUMN "last_evaluated_trade_date" VARCHAR(8),
  ADD COLUMN "last_claimed_trade_date" VARCHAR(8);

ALTER TABLE "screener_subscription_logs"
  ADD COLUMN "run_key" VARCHAR(160),
  ADD COLUMN "job_id" VARCHAR(100),
  ADD COLUMN "attempt_token" VARCHAR(36),
  ADD COLUMN "rule_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "status" "subscription_run_status" NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN "trigger_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "data_versions" JSONB,
  ADD COLUMN "warning_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "error_code" VARCHAR(50),
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "finished_at" TIMESTAMP(3);

-- 初始表的这些列为 NOT NULL 但没有数据库默认值；B0 在 claim 阶段先创建 RUNNING log。
ALTER TABLE "screener_subscription_logs"
  ALTER COLUMN "match_count" SET DEFAULT 0,
  ALTER COLUMN "new_entry_count" SET DEFAULT 0,
  ALTER COLUMN "exit_count" SET DEFAULT 0,
  ALTER COLUMN "execution_ms" SET DEFAULT 0,
  ALTER COLUMN "success" SET DEFAULT false;

-- 存量 legacy filters 双读前先补齐冻结的 B0 rule/trigger 协议。
-- rule_fingerprint 使用应用层的 canonical JSON + SHA-256；不能用 PostgreSQL 的非等价
-- JSON 文本序列化伪造，故 legacy 行保留 NULL，避免写入一个看似有效但不能重算的错误指纹。
UPDATE "screener_subscriptions"
SET
  "rule_spec" = COALESCE(
    "rule_spec",
    jsonb_build_object(
      'type', 'STOCK_SCREENING',
      'version', 1,
      'universe', jsonb_build_object(
        'type', 'ALL_A',
        'excludeSt', true,
        'excludeSuspended', true,
        'excludeBse', false
      ),
      'filters', "filters"
    )
  ),
  "trigger_spec" = COALESCE(
    "trigger_spec",
    jsonb_build_object(
      'mode', 'ENTER',
      'notifyOnInitialMatch', false,
      'eventWindow', 'CURRENT_TRADE_DATE',
      'cooldownTradingDays', 0,
      'maxHitsPerNotification', 20
    )
  ),
  "notification_spec" = COALESCE(
    "notification_spec",
    jsonb_build_object('inApp', true, 'maxHitsPerNotification', 20)
  )
WHERE "rule_spec" IS NULL
   OR "trigger_spec" IS NULL
   OR "notification_spec" IS NULL;

-- 旧表的数组列虽有 DEFAULT，但未声明 NOT NULL；先清理历史 NULL，
-- 使 Prisma 的必填数组语义与物理表一致，避免日志查询时解包 NULL。
UPDATE "screener_subscriptions"
SET "last_match_codes" = ARRAY[]::TEXT[]
WHERE "last_match_codes" IS NULL;

UPDATE "screener_subscription_logs"
SET
  "new_entry_codes" = COALESCE("new_entry_codes", ARRAY[]::TEXT[]),
  "exit_codes" = COALESCE("exit_codes", ARRAY[]::TEXT[])
WHERE "new_entry_codes" IS NULL OR "exit_codes" IS NULL;

ALTER TABLE "screener_subscriptions"
  ALTER COLUMN "last_match_codes" SET NOT NULL;
ALTER TABLE "screener_subscription_logs"
  ALTER COLUMN "new_entry_codes" SET NOT NULL,
  ALTER COLUMN "exit_codes" SET NOT NULL;

-- 旧状态没有独立 claim 水位时，以已评估交易日作为保守初值。
UPDATE "screener_subscriptions"
SET "last_claimed_trade_date" = "last_evaluated_trade_date"
WHERE "last_claimed_trade_date" IS NULL
  AND "last_evaluated_trade_date" IS NOT NULL;

-- 历史记录以 legacy key 保留：新 runKey 的唯一约束不会因旧系统同日重跑而失败。
UPDATE "screener_subscription_logs"
SET
  "run_key" = 'legacy:' || "id"::text,
  "status" = CASE WHEN "success" THEN 'SUCCESS'::"subscription_run_status" ELSE 'FAILED'::"subscription_run_status" END,
  "trigger_count" = "new_entry_count" + "exit_count",
  "started_at" = "created_at",
  "finished_at" = "created_at"
WHERE "run_key" IS NULL;

CREATE UNIQUE INDEX "screener_subscription_logs_run_key_key"
  ON "screener_subscription_logs"("run_key");
CREATE INDEX "screener_subscriptions_user_id_rule_type_idx"
  ON "screener_subscriptions"("user_id", "rule_type");
CREATE INDEX "screener_subscriptions_rule_fingerprint_idx"
  ON "screener_subscriptions"("rule_fingerprint");

CREATE TABLE "screener_subscription_hits" (
  "id" BIGSERIAL NOT NULL,
  "subscription_id" INTEGER NOT NULL,
  "log_id" INTEGER NOT NULL,
  "trade_date" VARCHAR(8) NOT NULL,
  "event_trade_date" VARCHAR(8),
  "ts_code" VARCHAR(16) NOT NULL,
  "kind" "subscription_hit_kind" NOT NULL,
  "event_key" VARCHAR(160) NOT NULL,
  "evidence" JSONB NOT NULL,
  "notified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "screener_subscription_hits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "screener_subscription_hits_subscription_id_trade_date_ts_code_kind_event_key_key"
  ON "screener_subscription_hits"("subscription_id", "trade_date", "ts_code", "kind", "event_key");
CREATE INDEX "screener_subscription_hits_log_id_id_idx"
  ON "screener_subscription_hits"("log_id", "id");
CREATE INDEX "screener_subscription_hits_subscription_id_trade_date_idx"
  ON "screener_subscription_hits"("subscription_id", "trade_date");

ALTER TABLE "screener_subscription_logs"
  ADD CONSTRAINT "screener_subscription_logs_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "screener_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "screener_subscription_hits"
  ADD CONSTRAINT "screener_subscription_hits_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "screener_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "screener_subscription_hits"
  ADD CONSTRAINT "screener_subscription_hits_log_id_fkey"
  FOREIGN KEY ("log_id") REFERENCES "screener_subscription_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
