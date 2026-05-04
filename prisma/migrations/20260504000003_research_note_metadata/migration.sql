-- Research note metadata used by the P0 note-list/search contract.
ALTER TABLE "research_notes"
  ADD COLUMN IF NOT EXISTS "word_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "version_count" INTEGER NOT NULL DEFAULT 1;

UPDATE "research_notes"
SET "word_count" = COALESCE(char_length("content"), 0)
WHERE "word_count" = 0;

CREATE INDEX IF NOT EXISTS "research_notes_user_id_updated_at_idx"
  ON "research_notes"("user_id", "updated_at" DESC);