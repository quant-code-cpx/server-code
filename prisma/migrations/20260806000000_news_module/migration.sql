CREATE TYPE "news_content_type" AS ENUM ('NOTICE', 'NEWS', 'FLASH');
CREATE TYPE "news_source_type" AS ENUM ('REGULATOR', 'EXCHANGE', 'COMPANY', 'MEDIA', 'INSTITUTION', 'AGGREGATOR', 'OTHER');
CREATE TYPE "news_published_precision" AS ENUM ('SECOND', 'MINUTE', 'DATE', 'UNKNOWN');
CREATE TYPE "news_ingestion_run_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED');
CREATE TYPE "news_ingestion_trigger" AS ENUM ('SCHEDULED', 'MANUAL', 'BOOTSTRAP', 'RETRY');
CREATE TYPE "news_ingestion_operation" AS ENUM ('POLL_FEED', 'BACKFILL_SECURITY_NOTICES');

CREATE TYPE "news_circuit_state" AS ENUM ('CLOSED', 'OPEN', 'HALF_OPEN');
CREATE TYPE "news_entity_match_method" AS ENUM ('PROVIDER_CODE', 'DIRECT_CODE', 'EXACT_NAME', 'MANUAL');

CREATE TABLE "news_articles" (
  "id" VARCHAR(32) NOT NULL,
  "identity_hash" CHAR(64) NOT NULL,
  "canonical_url" VARCHAR(4096),
  "canonical_url_hash" CHAR(64),
  "alternate_urls" JSONB NOT NULL DEFAULT '[]',
  "content_type" "news_content_type" NOT NULL,
  "source_type" "news_source_type" NOT NULL,
  "publisher" VARCHAR(256),
  "title" VARCHAR(1000) NOT NULL,
  "excerpt" TEXT,
  "published_at" TIMESTAMPTZ(3),
  "published_date" DATE,
  "published_precision" "news_published_precision" NOT NULL,
  "language" VARCHAR(16),
  "source_country" VARCHAR(64),
  "current_revision" INTEGER NOT NULL DEFAULT 1,
  "current_content_hash" CHAR(64) NOT NULL,
  "quality_flags" JSONB NOT NULL DEFAULT '[]',
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "timeline_sort_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "news_articles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "news_article_revisions" (
  "id" BIGSERIAL NOT NULL,
  "article_id" VARCHAR(32) NOT NULL,
  "revision" INTEGER NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "raw_payload_hash" CHAR(64) NOT NULL,
  "normalizer_version" VARCHAR(40) NOT NULL,
  "content_type" "news_content_type" NOT NULL,
  "source_type" "news_source_type" NOT NULL,
  "canonical_url" VARCHAR(4096),
  "alternate_urls" JSONB NOT NULL DEFAULT '[]',
  "title" VARCHAR(1000) NOT NULL,
  "excerpt" TEXT,
  "publisher" VARCHAR(256),
  "published_at" TIMESTAMPTZ(3),
  "published_date" DATE,
  "published_precision" "news_published_precision" NOT NULL,
  "language" VARCHAR(16),
  "source_country" VARCHAR(64),
  "quality_flags" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "news_article_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "news_provider_items" (
  "id" BIGSERIAL NOT NULL,
  "provider_key" VARCHAR(32) NOT NULL,
  "feed_key" VARCHAR(96) NOT NULL,
  "upstream_id" VARCHAR(256) NOT NULL,
  "article_id" VARCHAR(32) NOT NULL,
  "source_discovered_at" TIMESTAMPTZ(3),
  "raw_payload_hash" CHAR(64) NOT NULL,
  "source_metadata" JSONB NOT NULL DEFAULT '{}',
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
  "retrieved_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "news_provider_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "news_security_links" (
  "article_id" VARCHAR(32) NOT NULL,
  "ts_code" VARCHAR(16) NOT NULL,
  "match_method" "news_entity_match_method" NOT NULL,
  "confidence" DECIMAL(5,4) NOT NULL,
  "evidence" VARCHAR(256),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "news_security_links_pkey" PRIMARY KEY ("article_id", "ts_code")
);

CREATE TABLE "news_ingestion_cursors" (
  "id" BIGSERIAL NOT NULL,
  "provider_key" VARCHAR(32) NOT NULL,
  "feed_key" VARCHAR(96) NOT NULL,
  "partition_key" VARCHAR(128) NOT NULL DEFAULT 'default',
  "provider_cursor" JSONB,
  "watermark_at" TIMESTAMPTZ(3),
  "last_successful_at" TIMESTAMPTZ(3),
  "last_attempt_at" TIMESTAMPTZ(3),
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "news_ingestion_cursors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "news_feed_health" (
    "provider_key" VARCHAR(32) NOT NULL,
    "feed_key" VARCHAR(96) NOT NULL,
    "last_successful_at" TIMESTAMPTZ(3),
    "data_through" TIMESTAMPTZ(3),
    "last_attempt_at" TIMESTAMPTZ(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_run_status" "news_ingestion_run_status",
    "potentially_truncated" BOOLEAN NOT NULL DEFAULT false,
    "circuit_state" "news_circuit_state" NOT NULL DEFAULT 'CLOSED',
    "warning_since" JSONB NOT NULL DEFAULT '{}',
    "last_public_error_code" VARCHAR(64),
    "last_public_error_message" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "news_feed_health_pkey" PRIMARY KEY ("provider_key", "feed_key")
);

CREATE TABLE "news_ingestion_commands" (
  "id" VARCHAR(32) NOT NULL,
  "client_request_id" UUID NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "requested_by_user_id" INTEGER NOT NULL,
  "operation" "news_ingestion_operation" NOT NULL,
  "request_spec" JSONB NOT NULL,
  "status" "news_ingestion_run_status" NOT NULL,
  "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  CONSTRAINT "news_ingestion_commands_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "news_ingestion_runs" (
  "id" VARCHAR(32) NOT NULL,
  "command_id" VARCHAR(32),
  "idempotency_key" VARCHAR(200) NOT NULL,
  "operation" "news_ingestion_operation" NOT NULL,
  "provider_key" VARCHAR(32) NOT NULL,
  "feed_key" VARCHAR(96) NOT NULL,
  "partition_key" VARCHAR(128) NOT NULL,
  "trigger" "news_ingestion_trigger" NOT NULL,
  "status" "news_ingestion_run_status" NOT NULL,
  "fetched_count" INTEGER NOT NULL DEFAULT 0,
  "inserted_count" INTEGER NOT NULL DEFAULT 0,
  "revised_count" INTEGER NOT NULL DEFAULT 0,
  "duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "quarantined_count" INTEGER NOT NULL DEFAULT 0,
  "potentially_truncated" BOOLEAN NOT NULL DEFAULT false,
  "data_through_before" TIMESTAMPTZ(3),
  "data_through_after" TIMESTAMPTZ(3),
  "error_code" VARCHAR(64),
  "error_message" VARCHAR(500),
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "news_ingestion_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "news_quarantine_items" (
  "id" BIGSERIAL NOT NULL,
  "run_id" VARCHAR(32) NOT NULL,
  "item_key_hash" CHAR(64) NOT NULL,
  "raw_payload_hash" CHAR(64) NOT NULL,
  "error_code" VARCHAR(64) NOT NULL,
  "error_message" VARCHAR(500) NOT NULL,
  "field_manifest" JSONB NOT NULL DEFAULT '{}',
  "sanitized_payload" JSONB,
  "retryable" BOOLEAN NOT NULL DEFAULT false,
  "resolved_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "news_quarantine_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "news_articles_identity_hash_key" ON "news_articles"("identity_hash");
CREATE INDEX "news_articles_published_id_idx" ON "news_articles"("published_at" DESC, "id" DESC);
CREATE INDEX "news_articles_date_id_idx" ON "news_articles"("published_date" DESC, "id" DESC);
CREATE INDEX "news_articles_timeline_cursor_idx" ON "news_articles"("timeline_sort_at" DESC, "first_seen_at" DESC, "id" DESC);
CREATE INDEX "news_articles_type_seen_idx" ON "news_articles"("content_type", "first_seen_at" DESC);
CREATE INDEX "news_articles_source_seen_idx" ON "news_articles"("source_type", "first_seen_at" DESC);
CREATE INDEX "news_articles_url_hash_idx" ON "news_articles"("canonical_url_hash");
CREATE INDEX "news_article_revisions_created_idx" ON "news_article_revisions"("article_id", "created_at" DESC);
CREATE UNIQUE INDEX "news_article_revisions_number_key" ON "news_article_revisions"("article_id", "revision");
CREATE UNIQUE INDEX "news_article_revisions_content_key" ON "news_article_revisions"("article_id", "content_hash");
CREATE INDEX "news_provider_items_article_idx" ON "news_provider_items"("article_id");
CREATE INDEX "news_provider_items_feed_retrieved_idx" ON "news_provider_items"("provider_key", "feed_key", "retrieved_at" DESC);
CREATE UNIQUE INDEX "news_provider_items_upstream_key" ON "news_provider_items"("provider_key", "feed_key", "upstream_id");
CREATE INDEX "news_security_links_code_article_idx" ON "news_security_links"("ts_code", "article_id");
CREATE INDEX "news_ingestion_cursors_success_idx" ON "news_ingestion_cursors"("last_successful_at");

CREATE INDEX "news_feed_health_success_idx" ON "news_feed_health"("last_successful_at");
CREATE UNIQUE INDEX "news_ingestion_cursors_partition_key" ON "news_ingestion_cursors"("provider_key", "feed_key", "partition_key");
CREATE INDEX "news_ingestion_commands_actor_accepted_idx" ON "news_ingestion_commands"("requested_by_user_id", "accepted_at" DESC);
CREATE INDEX "news_ingestion_commands_status_accepted_idx" ON "news_ingestion_commands"("status", "accepted_at");
CREATE UNIQUE INDEX "news_ingestion_commands_actor_request_key" ON "news_ingestion_commands"("requested_by_user_id", "client_request_id");
CREATE UNIQUE INDEX "news_ingestion_runs_idempotency_key" ON "news_ingestion_runs"("idempotency_key");
CREATE INDEX "news_ingestion_runs_command_created_idx" ON "news_ingestion_runs"("command_id", "created_at");
CREATE INDEX "news_ingestion_runs_feed_created_idx" ON "news_ingestion_runs"("provider_key", "feed_key", "created_at" DESC);
CREATE INDEX "news_ingestion_runs_status_created_idx" ON "news_ingestion_runs"("status", "created_at" DESC);
CREATE INDEX "news_quarantine_items_error_created_idx" ON "news_quarantine_items"("error_code", "created_at" DESC);
CREATE UNIQUE INDEX "news_quarantine_items_run_item_key" ON "news_quarantine_items"("run_id", "item_key_hash");

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE INDEX "news_articles_search_trgm_idx"
  ON "news_articles"
  USING GIN (("title" || ' ' || COALESCE("excerpt", '')) public.gin_trgm_ops);

ALTER TABLE "news_article_revisions" ADD CONSTRAINT "news_article_revisions_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "news_provider_items" ADD CONSTRAINT "news_provider_items_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "news_security_links" ADD CONSTRAINT "news_security_links_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "news_security_links" ADD CONSTRAINT "news_security_links_ts_code_fkey" FOREIGN KEY ("ts_code") REFERENCES "stock_basic_profiles"("ts_code") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "news_ingestion_commands" ADD CONSTRAINT "news_ingestion_commands_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "news_ingestion_runs" ADD CONSTRAINT "news_ingestion_runs_command_id_fkey" FOREIGN KEY ("command_id") REFERENCES "news_ingestion_commands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "news_quarantine_items" ADD CONSTRAINT "news_quarantine_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "news_ingestion_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
