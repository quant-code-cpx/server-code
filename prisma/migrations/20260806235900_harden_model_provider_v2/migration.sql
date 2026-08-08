UPDATE "ai_model_deployments" SET "capabilities" = ARRAY[]::TEXT[] WHERE "capabilities" IS NULL;
UPDATE "ai_model_deployments" SET "reasoning_efforts" = ARRAY[]::TEXT[] WHERE "reasoning_efforts" IS NULL;
UPDATE "ai_model_deployments" SET "data_classes" = ARRAY[]::TEXT[] WHERE "data_classes" IS NULL;
UPDATE "ai_model_config_versions" SET "deployment_ids" = ARRAY[]::TEXT[] WHERE "deployment_ids" IS NULL;

ALTER TABLE "ai_model_deployments" ALTER COLUMN "capabilities" SET NOT NULL;
ALTER TABLE "ai_model_deployments" ALTER COLUMN "reasoning_efforts" SET NOT NULL;
ALTER TABLE "ai_model_deployments" ALTER COLUMN "data_classes" SET NOT NULL;
ALTER TABLE "ai_model_config_versions" ALTER COLUMN "deployment_ids" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ai_model_config_versions_single_active_key"
  ON "ai_model_config_versions"("status") WHERE "status" = 'ACTIVE';
