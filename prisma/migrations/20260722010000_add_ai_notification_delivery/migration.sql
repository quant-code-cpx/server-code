-- Durable Agent notification channels and delivery outbox. Secrets are encrypted
-- application-side before they reach ai_notification_channels.encrypted_config.

CREATE TYPE "ai_notification_channel_type" AS ENUM ('IN_APP', 'WEBHOOK');
CREATE TYPE "ai_notification_channel_status" AS ENUM ('ACTIVE', 'DISABLED', 'DELETED');
CREATE TYPE "ai_notification_delivery_status" AS ENUM ('PENDING', 'SENDING', 'DELIVERED', 'RETRY', 'FAILED', 'SUPPRESSED');
CREATE TYPE "ai_notification_delivery_attempt_status" AS ENUM ('DELIVERED', 'RETRY', 'FAILED', 'SUPPRESSED');

CREATE TABLE "ai_notification_channels" (
  "id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "type" "ai_notification_channel_type" NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "encrypted_config" TEXT,
  "config_key_version" INTEGER,
  "config_fingerprint" CHAR(64),
  "status" "ai_notification_channel_status" NOT NULL DEFAULT 'ACTIVE',
  "verified_at" TIMESTAMPTZ(3),
  "last_four" VARCHAR(16),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "ai_notification_channels_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_notification_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_notification_channels_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ai_notification_channels_external_config_check" CHECK (
    ("type" = 'IN_APP' AND "encrypted_config" IS NULL AND "config_key_version" IS NULL)
    OR ("type" = 'WEBHOOK' AND "encrypted_config" IS NOT NULL AND "config_key_version" IS NOT NULL)
  )
);

CREATE TABLE "ai_notification_deliveries" (
  "id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "channel_id" VARCHAR(32) NOT NULL,
  "execution_id" VARCHAR(32),
  "run_id" VARCHAR(32),
  "idempotency_key" VARCHAR(128) NOT NULL,
  "payload" JSONB NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "status" "ai_notification_delivery_status" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" VARCHAR(128),
  "lease_expires_at" TIMESTAMPTZ(3),
  "provider_message_id" VARCHAR(256),
  "error_class" VARCHAR(64),
  "error_message" VARCHAR(512),
  "delivered_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_notification_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_notification_deliveries_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "ai_notification_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_notification_deliveries_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "ai_task_executions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_notification_deliveries_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_notification_deliveries_attempt_check" CHECK ("attempt" >= 0 AND "max_attempts" >= 1 AND "attempt" <= "max_attempts"),
  CONSTRAINT "ai_notification_deliveries_run_or_execution_check" CHECK ("run_id" IS NOT NULL OR "execution_id" IS NOT NULL)
);

CREATE TABLE "ai_notification_delivery_attempts" (
  "id" BIGSERIAL NOT NULL,
  "delivery_id" VARCHAR(32) NOT NULL,
  "attempt" INTEGER NOT NULL,
  "status" "ai_notification_delivery_attempt_status" NOT NULL,
  "provider_message_id" VARCHAR(256),
  "http_status" INTEGER,
  "error_class" VARCHAR(64),
  "error_message" VARCHAR(512),
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_notification_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_notification_delivery_attempts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "ai_notification_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "notifications" ADD COLUMN "delivery_id" VARCHAR(32);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "ai_notification_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "notifications_delivery_id_key" ON "notifications"("delivery_id");
CREATE INDEX "ai_notification_channels_user_status_cursor_idx" ON "ai_notification_channels"("user_id", "status", "created_at" DESC, "id" DESC);
CREATE UNIQUE INDEX "ai_notification_deliveries_channel_idempotency_key" ON "ai_notification_deliveries"("channel_id", "idempotency_key");
CREATE INDEX "ai_notification_deliveries_due_idx" ON "ai_notification_deliveries"("status", "next_attempt_at", "id");
CREATE INDEX "ai_notification_deliveries_user_cursor_idx" ON "ai_notification_deliveries"("user_id", "created_at" DESC, "id" DESC);
CREATE INDEX "ai_notification_deliveries_run_idx" ON "ai_notification_deliveries"("run_id", "id");
CREATE UNIQUE INDEX "ai_notification_delivery_attempts_delivery_attempt_key" ON "ai_notification_delivery_attempts"("delivery_id", "attempt");
CREATE INDEX "ai_notification_delivery_attempts_delivery_idx" ON "ai_notification_delivery_attempts"("delivery_id", "started_at" DESC);
