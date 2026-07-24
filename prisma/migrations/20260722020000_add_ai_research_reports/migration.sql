-- Batch 022: versioned Agent research reports and linked investment journals.
CREATE TYPE "ai_research_report_status" AS ENUM ('QUEUED', 'GENERATING', 'COMPLETED', 'FAILED', 'DELETED');

ALTER TABLE "research_notes"
  ADD COLUMN "decision" TEXT,
  ADD COLUMN "outcome" TEXT,
  ADD COLUMN "review_at" TIMESTAMPTZ(3),
  ADD COLUMN "risks" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "source_report_id" VARCHAR(32),
  ADD COLUMN "source_run_id" VARCHAR(32),
  ADD COLUMN "thesis" TEXT;

CREATE TABLE "ai_research_reports" (
  "id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "conversation_id" VARCHAR(32) NOT NULL,
  "run_id" VARCHAR(32) NOT NULL,
  "message_id" VARCHAR(32) NOT NULL,
  "message_version" INTEGER NOT NULL,
  "client_request_id" VARCHAR(128) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" "ai_research_report_status" NOT NULL DEFAULT 'QUEUED',
  "title" VARCHAR(200) NOT NULL,
  "summary" TEXT NOT NULL,
  "content_text" TEXT,
  "content_blocks" JSONB NOT NULL DEFAULT '[]',
  "citation_manifest" JSONB NOT NULL DEFAULT '[]',
  "manifest" JSONB NOT NULL DEFAULT '{}',
  "content_hash" CHAR(64) NOT NULL,
  "data_as_of" DATE,
  "renderer_version" VARCHAR(64) NOT NULL DEFAULT 'agent-html-v1',
  "storage_key" VARCHAR(512),
  "storage_hash" CHAR(64),
  "file_size" INTEGER,
  "render_attempts" INTEGER NOT NULL DEFAULT 0,
  "error_message" VARCHAR(1000),
  "rendered_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "storage_deleted_at" TIMESTAMPTZ(3),
  "cleanup_attempts" INTEGER NOT NULL DEFAULT 0,
  "cleanup_error" VARCHAR(1000),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_research_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_research_reports_storage_key_key" ON "ai_research_reports"("storage_key");
CREATE UNIQUE INDEX "ai_research_reports_user_client_request_key" ON "ai_research_reports"("user_id", "client_request_id");
CREATE UNIQUE INDEX "ai_research_reports_source_version_key" ON "ai_research_reports"("user_id", "run_id", "message_id", "version");
CREATE INDEX "ai_research_reports_user_status_cursor_idx" ON "ai_research_reports"("user_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "ai_research_reports_render_queue_idx" ON "ai_research_reports"("status", "created_at", "id");
CREATE INDEX "ai_research_reports_cleanup_queue_idx" ON "ai_research_reports"("status", "storage_deleted_at", "id");
CREATE UNIQUE INDEX "research_notes_source_report_id_key" ON "research_notes"("source_report_id");
CREATE INDEX "research_notes_user_id_source_run_id_idx" ON "research_notes"("user_id", "source_run_id");

ALTER TABLE "ai_research_reports"
  ADD CONSTRAINT "ai_research_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_research_reports_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_research_reports_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ai_research_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "research_notes"
  ADD CONSTRAINT "research_notes_source_run_id_fkey" FOREIGN KEY ("source_run_id") REFERENCES "ai_agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "research_notes_source_report_id_fkey" FOREIGN KEY ("source_report_id") REFERENCES "ai_research_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
