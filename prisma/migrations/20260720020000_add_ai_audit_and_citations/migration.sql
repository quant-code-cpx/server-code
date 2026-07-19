-- Agent audit, immutable prompt/workflow versions, provenance sources and citations.
-- Full prompts, hidden reasoning and raw Tool/model payloads are intentionally not stored.

CREATE TYPE "ai_tool_call_status" AS ENUM (
  'PENDING', 'AUTHORIZING', 'RUNNING', 'RETRY_WAIT',
  'SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED'
);
CREATE TYPE "ai_model_call_status" AS ENUM (
  'PENDING', 'STREAMING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED'
);
CREATE TYPE "ai_version_status" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
CREATE TYPE "ai_audit_payload_mode" AS ENUM ('HASH_ONLY', 'ENCRYPTED_REF');
CREATE TYPE "ai_source_type" AS ENUM (
  'DATABASE', 'PROGRAM_CALCULATION', 'OFFICIAL', 'MEDIA', 'INSTITUTION', 'MODEL_INFERENCE'
);
CREATE TYPE "ai_search_fetch_status" AS ENUM ('METADATA_ONLY', 'FETCHED', 'BLOCKED', 'FAILED');
CREATE TYPE "ai_conclusion_level" AS ENUM ('FACT', 'PROGRAM_CALCULATION', 'MODEL_INFERENCE', 'SCENARIO');

CREATE TABLE "ai_prompt_versions" (
  "id" VARCHAR(32) NOT NULL,
  "prompt_key" VARCHAR(128) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ai_version_status" NOT NULL DEFAULT 'DRAFT',
  "template" TEXT NOT NULL,
  "input_schema" JSONB NOT NULL DEFAULT '{}',
  "output_schema" JSONB NOT NULL DEFAULT '{}',
  "content_hash" CHAR(64) NOT NULL,
  "created_by" INTEGER NOT NULL,
  "published_by" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "published_at" TIMESTAMPTZ(3),
  "retired_at" TIMESTAMPTZ(3),

  CONSTRAINT "ai_prompt_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_prompt_versions_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ai_prompt_versions_key_check" CHECK (NULLIF(BTRIM("prompt_key"), '') IS NOT NULL),
  CONSTRAINT "ai_prompt_versions_template_check" CHECK (NULLIF(BTRIM("template"), '') IS NOT NULL),
  CONSTRAINT "ai_prompt_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_prompt_versions_input_schema_check" CHECK (jsonb_typeof("input_schema") = 'object'),
  CONSTRAINT "ai_prompt_versions_output_schema_check" CHECK (jsonb_typeof("output_schema") = 'object'),
  CONSTRAINT "ai_prompt_versions_status_time_check" CHECK (
    ("status" = 'DRAFT' AND "published_by" IS NULL AND "published_at" IS NULL AND "retired_at" IS NULL)
    OR ("status" = 'PUBLISHED' AND "published_by" IS NOT NULL AND "published_at" IS NOT NULL AND "retired_at" IS NULL)
    OR ("status" = 'RETIRED' AND "published_by" IS NOT NULL AND "published_at" IS NOT NULL AND "retired_at" IS NOT NULL)
  )
);

CREATE TABLE "ai_workflow_versions" (
  "id" VARCHAR(32) NOT NULL,
  "workflow_key" VARCHAR(128) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ai_version_status" NOT NULL DEFAULT 'DRAFT',
  "definition" JSONB NOT NULL,
  "tool_allowlist" JSONB NOT NULL DEFAULT '[]',
  "input_schema" JSONB NOT NULL DEFAULT '{}',
  "output_schema" JSONB NOT NULL DEFAULT '{}',
  "content_hash" CHAR(64) NOT NULL,
  "created_by" INTEGER NOT NULL,
  "published_by" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "published_at" TIMESTAMPTZ(3),
  "retired_at" TIMESTAMPTZ(3),

  CONSTRAINT "ai_workflow_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_workflow_versions_version_check" CHECK ("version" >= 1),
  CONSTRAINT "ai_workflow_versions_key_check" CHECK (NULLIF(BTRIM("workflow_key"), '') IS NOT NULL),
  CONSTRAINT "ai_workflow_versions_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_workflow_versions_definition_check" CHECK (jsonb_typeof("definition") = 'object'),
  CONSTRAINT "ai_workflow_versions_tool_allowlist_check" CHECK (jsonb_typeof("tool_allowlist") = 'array'),
  CONSTRAINT "ai_workflow_versions_input_schema_check" CHECK (jsonb_typeof("input_schema") = 'object'),
  CONSTRAINT "ai_workflow_versions_output_schema_check" CHECK (jsonb_typeof("output_schema") = 'object'),
  CONSTRAINT "ai_workflow_versions_status_time_check" CHECK (
    ("status" = 'DRAFT' AND "published_by" IS NULL AND "published_at" IS NULL AND "retired_at" IS NULL)
    OR ("status" = 'PUBLISHED' AND "published_by" IS NOT NULL AND "published_at" IS NOT NULL AND "retired_at" IS NULL)
    OR ("status" = 'RETIRED' AND "published_by" IS NOT NULL AND "published_at" IS NOT NULL AND "retired_at" IS NOT NULL)
  )
);

CREATE TABLE "ai_tool_calls" (
  "id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "scope_id" VARCHAR(64) NOT NULL,
  "run_id" VARCHAR(32),
  "step_id" VARCHAR(32),
  "logical_node_key" VARCHAR(128) NOT NULL,
  "invocation_index" INTEGER NOT NULL DEFAULT 0,
  "tool_name" VARCHAR(96) NOT NULL,
  "tool_version" VARCHAR(40) NOT NULL,
  "status" "ai_tool_call_status" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 1,
  "payload_mode" "ai_audit_payload_mode" NOT NULL DEFAULT 'HASH_ONLY',
  "input_summary" JSONB NOT NULL DEFAULT '{}',
  "input_hash" CHAR(64) NOT NULL,
  "input_ref" VARCHAR(500),
  "output_summary" JSONB,
  "output_hash" CHAR(64),
  "output_ref" VARCHAR(500),
  "data_as_of" DATE,
  "data_through" DATE,
  "market_timezone" VARCHAR(64),
  "data_version" VARCHAR(160),
  "quality_flags" JSONB NOT NULL DEFAULT '[]',
  "source_tasks" JSONB NOT NULL DEFAULT '[]',
  "row_count" INTEGER,
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "error_code" INTEGER,
  "error_class" VARCHAR(128),
  "error_message" VARCHAR(1000),
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  "duration_ms" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ai_tool_calls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_tool_calls_invocation_index_check" CHECK ("invocation_index" >= 0),
  CONSTRAINT "ai_tool_calls_attempt_count_check" CHECK ("attempt_count" >= 1),
  CONSTRAINT "ai_tool_calls_input_hash_check" CHECK ("input_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_tool_calls_output_hash_check" CHECK ("output_hash" IS NULL OR "output_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_tool_calls_input_summary_check" CHECK (jsonb_typeof("input_summary") = 'object'),
  CONSTRAINT "ai_tool_calls_output_summary_check" CHECK ("output_summary" IS NULL OR jsonb_typeof("output_summary") IN ('object', 'array')),
  CONSTRAINT "ai_tool_calls_quality_flags_check" CHECK (jsonb_typeof("quality_flags") = 'array'),
  CONSTRAINT "ai_tool_calls_source_tasks_check" CHECK (jsonb_typeof("source_tasks") = 'array'),
  CONSTRAINT "ai_tool_calls_row_count_check" CHECK ("row_count" IS NULL OR "row_count" >= 0),
  CONSTRAINT "ai_tool_calls_duration_check" CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0),
  CONSTRAINT "ai_tool_calls_data_range_check" CHECK (
    "data_as_of" IS NULL OR "data_through" IS NULL OR "data_as_of" <= "data_through"
  ),
  CONSTRAINT "ai_tool_calls_payload_ref_check" CHECK (
    ("input_ref" IS NULL AND "output_ref" IS NULL) OR "payload_mode" = 'ENCRYPTED_REF'
  ),
  CONSTRAINT "ai_tool_calls_terminal_time_check" CHECK (
    (("status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED')) AND "finished_at" IS NOT NULL)
    OR (("status" NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED')) AND "finished_at" IS NULL)
  ),
  CONSTRAINT "ai_tool_calls_success_output_check" CHECK ("status" <> 'SUCCEEDED' OR "output_hash" IS NOT NULL),
  CONSTRAINT "ai_tool_calls_failure_error_check" CHECK (
    "status" NOT IN ('FAILED', 'REJECTED') OR NULLIF(BTRIM("error_class"), '') IS NOT NULL
  )
);

CREATE TABLE "ai_model_calls" (
  "id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "scope_id" VARCHAR(64) NOT NULL,
  "run_id" VARCHAR(32),
  "step_id" VARCHAR(32),
  "prompt_version_id" VARCHAR(32) NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "model" VARCHAR(128) NOT NULL,
  "purpose" VARCHAR(32) NOT NULL,
  "provider_request_id" VARCHAR(160),
  "status" "ai_model_call_status" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 1,
  "payload_mode" "ai_audit_payload_mode" NOT NULL DEFAULT 'HASH_ONLY',
  "request_summary" JSONB NOT NULL DEFAULT '{}',
  "request_hash" CHAR(64) NOT NULL,
  "request_ref" VARCHAR(500),
  "output_summary" JSONB,
  "response_hash" CHAR(64),
  "response_ref" VARCHAR(500),
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "cached_tokens" INTEGER,
  "reasoning_tokens" INTEGER,
  "cost" DECIMAL(18,8),
  "cost_currency" CHAR(3),
  "cost_estimated" BOOLEAN NOT NULL DEFAULT false,
  "latency_ms" INTEGER,
  "finish_reason" VARCHAR(80),
  "error_code" INTEGER,
  "error_class" VARCHAR(128),
  "error_message" VARCHAR(1000),
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ai_model_calls_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_model_calls_attempt_count_check" CHECK ("attempt_count" >= 1),
  CONSTRAINT "ai_model_calls_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_model_calls_response_hash_check" CHECK ("response_hash" IS NULL OR "response_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_model_calls_request_summary_check" CHECK (jsonb_typeof("request_summary") = 'object'),
  CONSTRAINT "ai_model_calls_output_summary_check" CHECK ("output_summary" IS NULL OR jsonb_typeof("output_summary") IN ('object', 'array')),
  CONSTRAINT "ai_model_calls_token_check" CHECK (
    ("input_tokens" IS NULL OR "input_tokens" >= 0)
    AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
    AND ("cached_tokens" IS NULL OR "cached_tokens" >= 0)
    AND ("reasoning_tokens" IS NULL OR "reasoning_tokens" >= 0)
  ),
  CONSTRAINT "ai_model_calls_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0),
  CONSTRAINT "ai_model_calls_cost_currency_pair_check" CHECK (("cost" IS NULL) = ("cost_currency" IS NULL)),
  CONSTRAINT "ai_model_calls_currency_check" CHECK ("cost_currency" IS NULL OR "cost_currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ai_model_calls_latency_check" CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0),
  CONSTRAINT "ai_model_calls_payload_ref_check" CHECK (
    ("request_ref" IS NULL AND "response_ref" IS NULL) OR "payload_mode" = 'ENCRYPTED_REF'
  ),
  CONSTRAINT "ai_model_calls_terminal_time_check" CHECK (
    (("status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) AND "finished_at" IS NOT NULL)
    OR (("status" NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) AND "finished_at" IS NULL)
  ),
  CONSTRAINT "ai_model_calls_success_output_check" CHECK ("status" <> 'SUCCEEDED' OR "response_hash" IS NOT NULL),
  CONSTRAINT "ai_model_calls_failure_error_check" CHECK (
    "status" <> 'FAILED' OR NULLIF(BTRIM("error_class"), '') IS NOT NULL
  )
);

CREATE TABLE "ai_search_sources" (
  "id" VARCHAR(32) NOT NULL,
  "first_seen_user_id" INTEGER NOT NULL,
  "first_seen_run_id" VARCHAR(32),
  "source_type" "ai_source_type" NOT NULL,
  "canonical_url" VARCHAR(4096) NOT NULL,
  "canonical_url_hash" CHAR(64) NOT NULL,
  "canonicalization_version" VARCHAR(40) NOT NULL,
  "title" VARCHAR(1000) NOT NULL,
  "publisher" VARCHAR(500),
  "author" VARCHAR(500),
  "published_at" TIMESTAMPTZ(3),
  "fetched_at" TIMESTAMPTZ(3) NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "object_ref" VARCHAR(500),
  "mime_type" VARCHAR(128),
  "language" VARCHAR(32),
  "license" VARCHAR(200),
  "robots_status" VARCHAR(32),
  "fetch_status" "ai_search_fetch_status" NOT NULL DEFAULT 'METADATA_ONLY',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_search_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_search_sources_url_check" CHECK (NULLIF(BTRIM("canonical_url"), '') IS NOT NULL),
  CONSTRAINT "ai_search_sources_title_check" CHECK (NULLIF(BTRIM("title"), '') IS NOT NULL),
  CONSTRAINT "ai_search_sources_url_hash_check" CHECK ("canonical_url_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_search_sources_content_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_search_sources_metadata_check" CHECK (jsonb_typeof("metadata") = 'object')
);

CREATE TABLE "ai_citations" (
  "id" BIGSERIAL NOT NULL,
  "public_id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "message_id" VARCHAR(32) NOT NULL,
  "block_id" VARCHAR(128) NOT NULL,
  "claim_key" VARCHAR(128) NOT NULL,
  "conclusion_level" "ai_conclusion_level" NOT NULL,
  "source_type" "ai_source_type" NOT NULL,
  "search_source_id" VARCHAR(32),
  "tool_call_id" VARCHAR(32),
  "source_title" VARCHAR(1000) NOT NULL,
  "canonical_url" VARCHAR(4096),
  "publisher" VARCHAR(500),
  "source_published_at" TIMESTAMPTZ(3),
  "retrieved_at" TIMESTAMPTZ(3) NOT NULL,
  "locator" JSONB NOT NULL,
  "start_offset" INTEGER,
  "end_offset" INTEGER,
  "content_hash" CHAR(64) NOT NULL,
  "quote_hash" CHAR(64),
  "citation_key_hash" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_citations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_citations_source_check" CHECK (
    ("search_source_id" IS NOT NULL)::integer + ("tool_call_id" IS NOT NULL)::integer = 1
  ),
  CONSTRAINT "ai_citations_offset_check" CHECK (
    ("start_offset" IS NULL AND "end_offset" IS NULL)
    OR ("start_offset" >= 0 AND "end_offset" > "start_offset")
  ),
  CONSTRAINT "ai_citations_locator_check" CHECK (jsonb_typeof("locator") = 'object' AND "locator" <> '{}'::jsonb),
  CONSTRAINT "ai_citations_block_check" CHECK (NULLIF(BTRIM("block_id"), '') IS NOT NULL),
  CONSTRAINT "ai_citations_claim_check" CHECK (NULLIF(BTRIM("claim_key"), '') IS NOT NULL),
  CONSTRAINT "ai_citations_title_check" CHECK (NULLIF(BTRIM("source_title"), '') IS NOT NULL),
  CONSTRAINT "ai_citations_content_hash_check" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_citations_quote_hash_check" CHECK ("quote_hash" IS NULL OR "quote_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_citations_key_hash_check" CHECK ("citation_key_hash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "ai_prompt_versions_status_key_version_idx"
  ON "ai_prompt_versions"("status", "prompt_key", "version" DESC);
CREATE UNIQUE INDEX "ai_prompt_versions_key_version_key"
  ON "ai_prompt_versions"("prompt_key", "version");
CREATE UNIQUE INDEX "ai_prompt_versions_key_content_hash_key"
  ON "ai_prompt_versions"("prompt_key", "content_hash");

CREATE INDEX "ai_workflow_versions_status_key_version_idx"
  ON "ai_workflow_versions"("status", "workflow_key", "version" DESC);
CREATE UNIQUE INDEX "ai_workflow_versions_key_version_key"
  ON "ai_workflow_versions"("workflow_key", "version");
CREATE UNIQUE INDEX "ai_workflow_versions_key_content_hash_key"
  ON "ai_workflow_versions"("workflow_key", "content_hash");

CREATE INDEX "ai_tool_calls_run_started_idx" ON "ai_tool_calls"("run_id", "started_at");
CREATE INDEX "ai_tool_calls_user_scope_started_idx" ON "ai_tool_calls"("user_id", "scope_id", "started_at");
CREATE INDEX "ai_tool_calls_status_started_idx" ON "ai_tool_calls"("status", "started_at");
CREATE UNIQUE INDEX "ai_tool_calls_scope_node_invocation_key"
  ON "ai_tool_calls"("user_id", "scope_id", "logical_node_key", "invocation_index");

CREATE INDEX "ai_model_calls_run_started_idx" ON "ai_model_calls"("run_id", "started_at");
CREATE INDEX "ai_model_calls_user_scope_started_idx" ON "ai_model_calls"("user_id", "scope_id", "started_at");
CREATE INDEX "ai_model_calls_provider_model_started_idx" ON "ai_model_calls"("provider", "model", "started_at");
CREATE INDEX "ai_model_calls_status_started_idx" ON "ai_model_calls"("status", "started_at");
CREATE UNIQUE INDEX "ai_model_calls_scope_model_attempt_key"
  ON "ai_model_calls"("user_id", "scope_id", "provider", "model", "purpose", "attempt_count");

CREATE INDEX "ai_search_sources_url_fetched_idx" ON "ai_search_sources"("canonical_url_hash", "fetched_at" DESC);
CREATE INDEX "ai_search_sources_type_fetched_idx" ON "ai_search_sources"("source_type", "fetched_at" DESC);
CREATE UNIQUE INDEX "ai_search_sources_url_content_hash_key"
  ON "ai_search_sources"("canonical_url_hash", "content_hash");

CREATE UNIQUE INDEX "ai_citations_public_id_key" ON "ai_citations"("public_id");
CREATE INDEX "ai_citations_message_id_idx" ON "ai_citations"("message_id", "id");
CREATE INDEX "ai_citations_search_source_idx" ON "ai_citations"("search_source_id");
CREATE INDEX "ai_citations_tool_call_idx" ON "ai_citations"("tool_call_id");
CREATE INDEX "ai_citations_user_created_idx" ON "ai_citations"("user_id", "created_at" DESC);
CREATE UNIQUE INDEX "ai_citations_message_key_hash_key"
  ON "ai_citations"("message_id", "citation_key_hash");

ALTER TABLE "ai_model_calls"
  ADD CONSTRAINT "ai_model_calls_prompt_version_id_fkey"
  FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_citations"
  ADD CONSTRAINT "ai_citations_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "ai_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_citations"
  ADD CONSTRAINT "ai_citations_search_source_id_fkey"
  FOREIGN KEY ("search_source_id") REFERENCES "ai_search_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ai_citations"
  ADD CONSTRAINT "ai_citations_tool_call_id_fkey"
  FOREIGN KEY ("tool_call_id") REFERENCES "ai_tool_calls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "protect_published_ai_version"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'published AI version cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'RETIRED' THEN
    RAISE EXCEPTION 'retired AI version is immutable' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" = 'PUBLISHED' THEN
    IF NEW."status" <> 'RETIRED'
      OR NEW."retired_at" IS NULL
      OR (to_jsonb(NEW) - ARRAY['status', 'updated_at', 'retired_at'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'updated_at', 'retired_at'])
    THEN
      RAISE EXCEPTION 'published AI version content is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'PUBLISHED') THEN
    RAISE EXCEPTION 'invalid AI version status transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_prompt_versions_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "ai_prompt_versions"
  FOR EACH ROW EXECUTE FUNCTION "protect_published_ai_version"();
CREATE TRIGGER "ai_workflow_versions_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "ai_workflow_versions"
  FOR EACH ROW EXECUTE FUNCTION "protect_published_ai_version"();

CREATE FUNCTION "validate_ai_tool_call_transition"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REJECTED') THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'terminal AI tool call is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('AUTHORIZING', 'RUNNING', 'FAILED', 'CANCELLED', 'REJECTED'))
    OR (OLD."status" = 'AUTHORIZING' AND NEW."status" IN ('RUNNING', 'FAILED', 'CANCELLED', 'REJECTED'))
    OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
    OR (OLD."status" = 'RETRY_WAIT' AND NEW."status" IN ('RUNNING', 'FAILED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid AI tool call status transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_tool_calls_status_transition_trigger"
  BEFORE UPDATE ON "ai_tool_calls"
  FOR EACH ROW EXECUTE FUNCTION "validate_ai_tool_call_transition"();

CREATE FUNCTION "validate_ai_model_call_transition"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'terminal AI model call is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" = OLD."status" THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('STREAMING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
    OR (OLD."status" = 'STREAMING' AND NEW."status" IN ('RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED'))
    OR (OLD."status" = 'RETRY_WAIT' AND NEW."status" IN ('PENDING', 'STREAMING', 'FAILED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid AI model call status transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_model_calls_status_transition_trigger"
  BEFORE UPDATE ON "ai_model_calls"
  FOR EACH ROW EXECUTE FUNCTION "validate_ai_model_call_transition"();

CREATE FUNCTION "validate_ai_citation"() RETURNS trigger AS $$
DECLARE
  owner_user_id INTEGER;
  source_content_hash CHAR(64);
  source_kind "ai_source_type";
  source_url VARCHAR(4096);
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'AI citation is append-only' USING ERRCODE = 'check_violation';
  END IF;

  SELECT "user_id" INTO owner_user_id FROM "ai_messages" WHERE "id" = NEW."message_id";
  IF owner_user_id IS NULL OR owner_user_id <> NEW."user_id" THEN
    RAISE EXCEPTION 'AI citation message owner mismatch' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."search_source_id" IS NOT NULL THEN
    SELECT "content_hash", "source_type", "canonical_url"
      INTO source_content_hash, source_kind, source_url
      FROM "ai_search_sources" WHERE "id" = NEW."search_source_id";
    IF source_content_hash IS NULL
      OR source_content_hash <> NEW."content_hash"
      OR source_kind <> NEW."source_type"
      OR source_url IS DISTINCT FROM NEW."canonical_url"
    THEN
      RAISE EXCEPTION 'AI citation search source snapshot mismatch' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    SELECT "user_id", "output_hash"
      INTO owner_user_id, source_content_hash
      FROM "ai_tool_calls" WHERE "id" = NEW."tool_call_id";
    IF owner_user_id IS NULL
      OR owner_user_id <> NEW."user_id"
      OR source_content_hash IS NULL
      OR source_content_hash <> NEW."content_hash"
      OR NEW."canonical_url" IS NOT NULL
    THEN
      RAISE EXCEPTION 'AI citation tool source snapshot mismatch' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_citations_integrity_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "ai_citations"
  FOR EACH ROW EXECUTE FUNCTION "validate_ai_citation"();
