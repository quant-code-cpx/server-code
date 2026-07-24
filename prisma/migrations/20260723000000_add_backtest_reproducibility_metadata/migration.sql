ALTER TABLE "backtest_runs"
  ADD COLUMN IF NOT EXISTS "engine_version" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "data_contract_version" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "universe_policy_version" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "financial_as_of_policy_version" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "adjustment_policy_version" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "reproducibility_status" VARCHAR(32) NOT NULL DEFAULT 'LEGACY_UNVERIFIED',
  ADD COLUMN IF NOT EXISTS "reproducibility_manifest" JSONB,
  ADD COLUMN IF NOT EXISTS "quality_flags" JSONB NOT NULL DEFAULT '["LEGACY_UNVERIFIED"]'::jsonb;

UPDATE "backtest_runs"
SET
  "reproducibility_status" = 'LEGACY_UNVERIFIED',
  "quality_flags" = '["LEGACY_UNVERIFIED"]'::jsonb
WHERE "engine_version" IS NULL;

ALTER TABLE "financial_indicator_snapshots"
  ADD COLUMN IF NOT EXISTS "id" BIGSERIAL,
  ADD COLUMN IF NOT EXISTS "update_flag" VARCHAR(8);

ALTER TABLE "financial_indicator_snapshots"
  DROP CONSTRAINT IF EXISTS "financial_indicator_snapshots_pkey";

ALTER TABLE "financial_indicator_snapshots"
  ADD CONSTRAINT "financial_indicator_snapshots_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX IF NOT EXISTS "financial_indicator_snapshots_revision_key"
  ON "financial_indicator_snapshots" (
    "ts_code",
    "end_date",
    COALESCE("ann_date", DATE '0001-01-01'),
    COALESCE("update_flag", '')
  );

CREATE INDEX IF NOT EXISTS "stock_basic_profiles_list_date_delist_date_idx"
  ON "stock_basic_profiles" ("list_date", "delist_date");

CREATE INDEX IF NOT EXISTS "sw_industry_members_l3_code_in_date_out_date_idx"
  ON "sw_industry_members" ("l3_code", "in_date", "out_date");

CREATE INDEX IF NOT EXISTS "financial_indicator_snapshots_ts_code_ann_date_end_date_idx"
  ON "financial_indicator_snapshots" ("ts_code", "ann_date" DESC, "end_date" DESC);
