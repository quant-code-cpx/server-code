CREATE TABLE "ai_model_providers" (
    "id" VARCHAR(128) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "display_name" VARCHAR(128) NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "cost_tier" VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
    "base_url" VARCHAR(2048),
    "encrypted_api_key" TEXT,
    "api_key_last_four" CHAR(4),
    "context_window" INTEGER NOT NULL,
    "max_output_tokens" INTEGER NOT NULL,
    "capabilities" TEXT[] NOT NULL,
    "reasoning_efforts" TEXT[] NOT NULL,
    "data_classes" TEXT[] NOT NULL,
    "timeout_ms" INTEGER NOT NULL DEFAULT 120000,
    "max_retries" INTEGER NOT NULL DEFAULT 2,
    "retry_base_ms" INTEGER NOT NULL DEFAULT 200,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_model_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_model_providers_model_key" ON "ai_model_providers"("model");
CREATE INDEX "ai_model_providers_enabled_priority_idx" ON "ai_model_providers"("enabled", "priority", "id");
