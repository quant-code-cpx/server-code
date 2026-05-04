-- Add lifecycle fields to backtest_runs
ALTER TABLE "backtest_runs"
  ADD COLUMN IF NOT EXISTS "starred"    BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "archived"   BOOLEAN   NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "note"       TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;

-- Add jobId and deletedAt to backtest_walk_forward_runs
ALTER TABLE "backtest_walk_forward_runs"
  ADD COLUMN IF NOT EXISTS "job_id"     VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
