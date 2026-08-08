CREATE TABLE IF NOT EXISTS "ai_model_connections" (
  "id" VARCHAR(128) NOT NULL,
  "connection_key" VARCHAR(128) NOT NULL,
  "adapter_kind" VARCHAR(48) NOT NULL,
  "display_name" VARCHAR(128) NOT NULL,
  "base_url" VARCHAR(2048) NOT NULL,
  "encrypted_api_key" TEXT,
  "api_key_last_four" CHAR(4),
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "config_version" INTEGER NOT NULL DEFAULT 1,
  "last_probe_status" VARCHAR(32),
  "last_probe_at" TIMESTAMPTZ(3),
  "last_probe_duration_ms" INTEGER,
  "last_probe_steps" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_model_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_model_connections_connection_key_key"
  ON "ai_model_connections"("connection_key");
CREATE INDEX IF NOT EXISTS "ai_model_connections_enabled_adapter_idx"
  ON "ai_model_connections"("enabled", "adapter_kind");

CREATE TABLE IF NOT EXISTS "ai_model_deployments" (
  "id" VARCHAR(128) NOT NULL,
  "connection_id" VARCHAR(128) NOT NULL,
  "model_id" VARCHAR(256) NOT NULL,
  "display_name" VARCHAR(128) NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "cost_tier" VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  "context_window" INTEGER NOT NULL,
  "max_output_tokens" INTEGER NOT NULL,
  "capabilities" TEXT[],
  "reasoning_mode" VARCHAR(24) NOT NULL DEFAULT 'AUTO',
  "reasoning_efforts" TEXT[],
  "default_reasoning_effort" VARCHAR(64),
  "reasoning_budget_tokens" INTEGER,
  "data_classes" TEXT[],
  "timeout_ms" INTEGER NOT NULL DEFAULT 120000,
  "max_retries" INTEGER NOT NULL DEFAULT 2,
  "retry_base_ms" INTEGER NOT NULL DEFAULT 200,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "config_version" INTEGER NOT NULL DEFAULT 1,
  "last_probe_status" VARCHAR(32),
  "last_probe_at" TIMESTAMPTZ(3),
  "last_probe_duration_ms" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_model_deployments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_model_deployments_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "ai_model_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ai_model_deployments_connection_model_key"
  ON "ai_model_deployments"("connection_id", "model_id");
CREATE INDEX IF NOT EXISTS "ai_model_deployments_enabled_priority_idx"
  ON "ai_model_deployments"("enabled", "priority", "id");

CREATE TABLE IF NOT EXISTS "ai_model_probes" (
  "id" VARCHAR(128) NOT NULL,
  "target_type" VARCHAR(24) NOT NULL,
  "target_id" VARCHAR(128) NOT NULL,
  "level" VARCHAR(32) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "steps" JSONB NOT NULL,
  "provider_request_id" VARCHAR(256),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_model_probes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_model_probes_target_created_idx"
  ON "ai_model_probes"("target_type", "target_id", "created_at");

CREATE TABLE IF NOT EXISTS "ai_model_config_versions" (
  "id" VARCHAR(128) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "deployment_ids" TEXT[],
  "snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_model_config_versions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ai_model_config_versions_status_created_idx"
  ON "ai_model_config_versions"("status", "created_at");

INSERT INTO "ai_model_connections" (
  "id", "connection_key", "adapter_kind", "display_name", "base_url",
  "encrypted_api_key", "api_key_last_four", "enabled", "last_probe_status",
  "created_at", "updated_at"
)
SELECT DISTINCT ON ("provider_id")
  md5('legacy-connection:' || "provider_id"),
  "provider_id",
  CASE WHEN "kind" = 'openai-compatible' THEN 'openai-chat-compatible' ELSE "kind" END,
  "display_name",
  COALESCE("base_url", ''),
  "encrypted_api_key",
  "api_key_last_four",
  "enabled",
  'MIGRATED_UNVERIFIED',
  "created_at",
  "updated_at"
FROM "ai_model_providers"
ORDER BY "provider_id", "updated_at" DESC
ON CONFLICT ("connection_key") DO NOTHING;

INSERT INTO "ai_model_deployments" (
  "id", "connection_id", "model_id", "display_name", "priority", "cost_tier",
  "context_window", "max_output_tokens", "capabilities", "reasoning_mode",
  "reasoning_efforts", "data_classes", "timeout_ms", "max_retries", "retry_base_ms",
  "enabled", "last_probe_status", "created_at", "updated_at"
)
SELECT
  "id",
  md5('legacy-connection:' || "provider_id"),
  "model",
  "display_name" || ' · ' || "model",
  "priority",
  "cost_tier",
  "context_window",
  "max_output_tokens",
  "capabilities",
  'AUTO',
  "reasoning_efforts",
  "data_classes",
  "timeout_ms",
  "max_retries",
  "retry_base_ms",
  "enabled",
  'MIGRATED_UNVERIFIED',
  "created_at",
  "updated_at"
FROM "ai_model_providers"
ON CONFLICT ("connection_id", "model_id") DO NOTHING;
