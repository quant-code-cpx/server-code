ALTER TABLE "ai_model_providers"
ADD COLUMN "provider_id" VARCHAR(128);

UPDATE "ai_model_providers"
SET "provider_id" = "id"
WHERE "provider_id" IS NULL;

ALTER TABLE "ai_model_providers"
ALTER COLUMN "provider_id" SET NOT NULL;

DROP INDEX IF EXISTS "ai_model_providers_model_key";

CREATE INDEX "ai_model_providers_provider_id_idx"
ON "ai_model_providers"("provider_id");
