-- Batch 019: versioned conversation summaries and explicit user memories.
-- Raw messages stay immutable; summaries are derived and memories require confirmation.

CREATE TYPE "ai_memory_category" AS ENUM ('PREFERENCE', 'PROFILE', 'CONSTRAINT', 'DOMAIN_FACT');
CREATE TYPE "ai_memory_sensitivity" AS ENUM ('NORMAL', 'PERSONAL', 'FINANCIAL');
CREATE TYPE "ai_memory_status" AS ENUM ('CANDIDATE', 'CONFIRMED', 'REVOKED', 'EXPIRED');

ALTER TABLE "ai_conversations"
  ADD COLUMN "current_summary_id" VARCHAR(32);

CREATE TABLE "ai_conversation_summaries" (
  "id" VARCHAR(32) NOT NULL,
  "conversation_id" VARCHAR(32) NOT NULL,
  "from_message_id" VARCHAR(32) NOT NULL,
  "through_message_id" VARCHAR(32) NOT NULL,
  "version" INTEGER NOT NULL,
  "summary_text" TEXT NOT NULL,
  "facts" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "source_message_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "prompt_version_id" VARCHAR(32) NOT NULL,
  "model_name" VARCHAR(128) NOT NULL,
  "source_token_count" INTEGER NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_conversation_summaries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_conversation_summaries_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ai_conversation_summaries_text_check" CHECK (NULLIF(BTRIM("summary_text"), '') IS NOT NULL),
  CONSTRAINT "ai_conversation_summaries_facts_array_check" CHECK (jsonb_typeof("facts") = 'array'),
  CONSTRAINT "ai_conversation_summaries_source_ids_array_check" CHECK (jsonb_typeof("source_message_ids") = 'array'),
  CONSTRAINT "ai_conversation_summaries_source_token_count_check" CHECK ("source_token_count" >= 0),
  CONSTRAINT "ai_conversation_summaries_content_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "ai_user_memories" (
  "id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "category" "ai_memory_category" NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "value" JSONB NOT NULL,
  "sensitivity" "ai_memory_sensitivity" NOT NULL DEFAULT 'NORMAL',
  "status" "ai_memory_status" NOT NULL DEFAULT 'CANDIDATE',
  "source_conversation_id" VARCHAR(32),
  "source_message_id" VARCHAR(32),
  "confidence" DECIMAL(5,4) NOT NULL DEFAULT 1,
  "version" INTEGER NOT NULL DEFAULT 1,
  "valid_from" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "revoked_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ai_user_memories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_user_memories_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_.-]{1,127}$'),
  CONSTRAINT "ai_user_memories_value_check" CHECK ("value" <> 'null'::jsonb),
  CONSTRAINT "ai_user_memories_confidence_check" CHECK ("confidence" >= 0 AND "confidence" <= 1),
  CONSTRAINT "ai_user_memories_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ai_user_memories_expiry_check" CHECK ("expires_at" IS NULL OR "expires_at" > "valid_from"),
  CONSTRAINT "ai_user_memories_source_check" CHECK ("source_message_id" IS NULL OR "source_conversation_id" IS NOT NULL),
  CONSTRAINT "ai_user_memories_status_check" CHECK (
    ("status" = 'CANDIDATE' AND "confirmed_at" IS NULL AND "revoked_at" IS NULL AND "deleted_at" IS NULL)
    OR ("status" = 'CONFIRMED' AND "confirmed_at" IS NOT NULL AND "revoked_at" IS NULL AND "deleted_at" IS NULL)
    OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL)
    OR ("status" = 'EXPIRED' AND "expires_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ai_conversations_current_summary_key"
  ON "ai_conversations"("current_summary_id");
CREATE UNIQUE INDEX "ai_conversation_summaries_conversation_version_key"
  ON "ai_conversation_summaries"("conversation_id", "version");
CREATE UNIQUE INDEX "ai_conversation_summaries_range_prompt_key"
  ON "ai_conversation_summaries"("conversation_id", "through_message_id", "prompt_version_id");
CREATE INDEX "ai_conversation_summaries_conversation_created_idx"
  ON "ai_conversation_summaries"("conversation_id", "created_at" DESC);

CREATE UNIQUE INDEX "ai_user_memories_active_key"
  ON "ai_user_memories"("user_id", "category", "key")
  WHERE "status" = 'CONFIRMED' AND "deleted_at" IS NULL;
CREATE INDEX "ai_user_memories_user_status_updated_idx"
  ON "ai_user_memories"("user_id", "status", "updated_at" DESC, "id" DESC);
CREATE INDEX "ai_user_memories_source_idx"
  ON "ai_user_memories"("source_conversation_id", "source_message_id");

ALTER TABLE "ai_conversation_summaries"
  ADD CONSTRAINT "ai_conversation_summaries_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_conversation_summaries"
  ADD CONSTRAINT "ai_conversation_summaries_from_message_id_fkey"
  FOREIGN KEY ("from_message_id") REFERENCES "ai_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_conversation_summaries"
  ADD CONSTRAINT "ai_conversation_summaries_through_message_id_fkey"
  FOREIGN KEY ("through_message_id") REFERENCES "ai_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_conversation_summaries"
  ADD CONSTRAINT "ai_conversation_summaries_prompt_version_id_fkey"
  FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_conversations"
  ADD CONSTRAINT "ai_conversations_current_summary_id_fkey"
  FOREIGN KEY ("current_summary_id") REFERENCES "ai_conversation_summaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_user_memories"
  ADD CONSTRAINT "ai_user_memories_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_user_memories"
  ADD CONSTRAINT "ai_user_memories_source_conversation_id_fkey"
  FOREIGN KEY ("source_conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_user_memories"
  ADD CONSTRAINT "ai_user_memories_source_message_id_fkey"
  FOREIGN KEY ("source_message_id") REFERENCES "ai_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
