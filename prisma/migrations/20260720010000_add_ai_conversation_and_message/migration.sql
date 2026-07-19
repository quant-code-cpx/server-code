-- Agent conversation/message persistence. Historical messages are append-only;
-- user deletion uses a later explicit privacy lifecycle instead of FK cascade.

CREATE TYPE "ai_conversation_status" AS ENUM ('ACTIVE', 'ARCHIVED', 'DELETED');
CREATE TYPE "ai_message_role" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');
CREATE TYPE "ai_message_status" AS ENUM ('PENDING', 'STREAMING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "ai_model_policy" AS ENUM ('AUTO', 'MANUAL');

CREATE TABLE "ai_conversations" (
  "id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "status" "ai_conversation_status" NOT NULL DEFAULT 'ACTIVE',
  "model_policy" "ai_model_policy" NOT NULL DEFAULT 'AUTO',
  "preferred_model" VARCHAR(128),
  "client_request_id" VARCHAR(128),
  "summary_version" INTEGER NOT NULL DEFAULT 0,
  "status_version" INTEGER NOT NULL DEFAULT 1,
  "message_count" INTEGER NOT NULL DEFAULT 0,
  "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "archived_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),

  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_conversations_summary_version_check" CHECK ("summary_version" >= 0),
  CONSTRAINT "ai_conversations_status_version_check" CHECK ("status_version" >= 1),
  CONSTRAINT "ai_conversations_message_count_check" CHECK ("message_count" >= 0),
  CONSTRAINT "ai_conversations_archive_state_check" CHECK (
    ("status" = 'ARCHIVED' AND "archived_at" IS NOT NULL)
    OR ("status" <> 'ARCHIVED')
  ),
  CONSTRAINT "ai_conversations_delete_state_check" CHECK (
    ("status" = 'DELETED' AND "deleted_at" IS NOT NULL)
    OR ("status" <> 'DELETED')
  )
);

CREATE TABLE "ai_messages" (
  "id" VARCHAR(32) NOT NULL,
  "conversation_id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "role" "ai_message_role" NOT NULL,
  "status" "ai_message_status" NOT NULL DEFAULT 'PENDING',
  "content_text" TEXT,
  "content_blocks" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "content_schema_version" INTEGER NOT NULL DEFAULT 1,
  "attachments" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "safety_labels" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "parent_message_id" VARCHAR(32),
  "version" INTEGER NOT NULL DEFAULT 1,
  "client_request_id" VARCHAR(128),
  "model_name" VARCHAR(128),
  "token_count" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),

  CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_messages_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ai_messages_content_schema_version_check" CHECK ("content_schema_version" >= 1),
  CONSTRAINT "ai_messages_token_count_check" CHECK ("token_count" IS NULL OR "token_count" >= 0),
  CONSTRAINT "ai_messages_content_blocks_array_check" CHECK (jsonb_typeof("content_blocks") = 'array'),
  CONSTRAINT "ai_messages_attachments_array_check" CHECK (jsonb_typeof("attachments") = 'array'),
  CONSTRAINT "ai_messages_safety_labels_array_check" CHECK (jsonb_typeof("safety_labels") = 'array'),
  CONSTRAINT "ai_messages_completed_content_check" CHECK (
    "status" <> 'COMPLETED'
    OR NULLIF(BTRIM("content_text"), '') IS NOT NULL
    OR jsonb_array_length("content_blocks") > 0
  )
);

CREATE UNIQUE INDEX "ai_conversations_user_client_request_key"
  ON "ai_conversations"("user_id", "client_request_id");
CREATE INDEX "ai_conversations_user_status_cursor_idx"
  ON "ai_conversations"("user_id", "status", "last_message_at" DESC, "id" DESC);

CREATE UNIQUE INDEX "ai_messages_conversation_client_request_key"
  ON "ai_messages"("conversation_id", "client_request_id");
CREATE UNIQUE INDEX "ai_messages_parent_version_key"
  ON "ai_messages"("parent_message_id", "version");
CREATE INDEX "ai_messages_conversation_cursor_idx"
  ON "ai_messages"("conversation_id", "created_at", "id");
CREATE INDEX "ai_messages_user_cursor_idx"
  ON "ai_messages"("user_id", "created_at" DESC, "id" DESC);

ALTER TABLE "ai_conversations"
  ADD CONSTRAINT "ai_conversations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_messages"
  ADD CONSTRAINT "ai_messages_parent_message_id_fkey"
  FOREIGN KEY ("parent_message_id") REFERENCES "ai_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "protect_completed_ai_message"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'COMPLETED' AND (
    NEW."conversation_id" IS DISTINCT FROM OLD."conversation_id"
    OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
    OR NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."content_text" IS DISTINCT FROM OLD."content_text"
    OR NEW."content_blocks" IS DISTINCT FROM OLD."content_blocks"
    OR NEW."content_schema_version" IS DISTINCT FROM OLD."content_schema_version"
    OR NEW."parent_message_id" IS DISTINCT FROM OLD."parent_message_id"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."client_request_id" IS DISTINCT FROM OLD."client_request_id"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'completed AI message content and identity are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_messages_completed_immutable_trigger"
  BEFORE UPDATE ON "ai_messages"
  FOR EACH ROW EXECUTE FUNCTION "protect_completed_ai_message"();
