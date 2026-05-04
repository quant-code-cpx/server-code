-- Add soft-delete column to research_notes
ALTER TABLE "research_notes" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;

-- Index for trash queries
CREATE INDEX IF NOT EXISTS "research_notes_user_id_deleted_at_idx"
  ON "research_notes" ("user_id", "deleted_at");
