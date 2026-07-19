-- Durable Agent queue intent. BullMQ only transports immutable identifiers;
-- PostgreSQL remains the authority and can rebuild Redis after loss.

CREATE TYPE "ai_job_outbox_status" AS ENUM ('PENDING', 'PUBLISHED', 'RETRY', 'DEAD');

CREATE TABLE "ai_job_outbox" (
  "id" BIGSERIAL NOT NULL,
  "aggregate_id" VARCHAR(32) NOT NULL,
  "kind" VARCHAR(64) NOT NULL,
  "status" "ai_job_outbox_status" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload_hash" CHAR(64) NOT NULL,
  "published_at" TIMESTAMPTZ(3),
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_job_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_job_outbox_kind_check" CHECK (NULLIF(BTRIM("kind"), '') IS NOT NULL),
  CONSTRAINT "ai_job_outbox_attempt_check" CHECK ("attempt" >= 0),
  CONSTRAINT "ai_job_outbox_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_job_outbox_published_time_check" CHECK (
    ("status" = 'PUBLISHED') = ("published_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ai_job_outbox_kind_aggregate_key"
  ON "ai_job_outbox"("kind", "aggregate_id");
CREATE INDEX "ai_job_outbox_publish_idx"
  ON "ai_job_outbox"("status", "next_attempt_at", "id");
