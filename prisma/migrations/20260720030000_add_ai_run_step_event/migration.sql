-- Agent Run/Step authority, durable replay events, lease and event outbox state.

CREATE TYPE "ai_agent_run_status" AS ENUM (
  'QUEUED', 'RUNNING', 'CANCEL_REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED'
);
CREATE TYPE "ai_agent_step_status" AS ENUM (
  'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'
);
CREATE TYPE "ai_agent_step_kind" AS ENUM ('PLAN', 'TOOL', 'MODEL', 'VALIDATION', 'WAIT', 'FINALIZE');
CREATE TYPE "ai_run_event_visibility" AS ENUM ('USER', 'OPERATOR', 'INTERNAL');
CREATE TYPE "ai_run_event_publish_status" AS ENUM ('PENDING', 'PUBLISHED', 'RETRY', 'DEAD');

CREATE TABLE "ai_agent_runs" (
  "id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "conversation_id" VARCHAR(32) NOT NULL,
  "trigger_message_id" VARCHAR(32) NOT NULL,
  "response_message_id" VARCHAR(32) NOT NULL,
  "client_request_id" VARCHAR(128) NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "trace_id" VARCHAR(128) NOT NULL,
  "status" "ai_agent_run_status" NOT NULL DEFAULT 'QUEUED',
  "status_version" INTEGER NOT NULL DEFAULT 1,
  "workflow_version_id" VARCHAR(32) NOT NULL,
  "prompt_version_id" VARCHAR(32) NOT NULL,
  "tool_policy_version" VARCHAR(40) NOT NULL,
  "model_policy" "ai_model_policy" NOT NULL DEFAULT 'AUTO',
  "preferred_model" VARCHAR(128),
  "input_snapshot" JSONB NOT NULL DEFAULT '{}',
  "budget" JSONB NOT NULL DEFAULT '{}',
  "result_summary" JSONB,
  "error_code" INTEGER,
  "error_class" VARCHAR(128),
  "error_message" VARCHAR(1000),
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 1,
  "next_event_sequence" BIGINT NOT NULL DEFAULT 1,
  "checkpoint" JSONB NOT NULL DEFAULT '{}',
  "checkpoint_version" INTEGER NOT NULL DEFAULT 0,
  "cancel_requested_at" TIMESTAMPTZ(3),
  "cancel_requested_by" INTEGER,
  "cancel_reason" VARCHAR(500),
  "lease_owner" VARCHAR(128),
  "lease_expires_at" TIMESTAMPTZ(3),
  "heartbeat_at" TIMESTAMPTZ(3),
  "deadline_at" TIMESTAMPTZ(3) NOT NULL,
  "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "ended_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_agent_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_agent_runs_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_agent_runs_status_version_check" CHECK ("status_version" >= 1),
  CONSTRAINT "ai_agent_runs_attempt_check" CHECK ("attempt" >= 0 AND "max_attempts" >= 1 AND "attempt" <= "max_attempts"),
  CONSTRAINT "ai_agent_runs_sequence_check" CHECK ("next_event_sequence" >= 1),
  CONSTRAINT "ai_agent_runs_checkpoint_version_check" CHECK ("checkpoint_version" >= 0),
  CONSTRAINT "ai_agent_runs_json_check" CHECK (
    jsonb_typeof("input_snapshot") = 'object'
    AND jsonb_typeof("budget") = 'object'
    AND jsonb_typeof("checkpoint") = 'object'
    AND ("result_summary" IS NULL OR jsonb_typeof("result_summary") = 'object')
  ),
  CONSTRAINT "ai_agent_runs_model_policy_check" CHECK (
    ("model_policy" = 'AUTO') OR NULLIF(BTRIM("preferred_model"), '') IS NOT NULL
  ),
  CONSTRAINT "ai_agent_runs_lease_pair_check" CHECK (
    ("lease_owner" IS NULL) = ("lease_expires_at" IS NULL)
    AND ("lease_owner" IS NULL) = ("heartbeat_at" IS NULL)
  ),
  CONSTRAINT "ai_agent_runs_cancel_owner_check" CHECK (
    "cancel_requested_by" IS NULL OR "cancel_requested_by" = "user_id"
  ),
  CONSTRAINT "ai_agent_runs_deadline_check" CHECK ("deadline_at" > "queued_at"),
  CONSTRAINT "ai_agent_runs_status_time_check" CHECK (
    ("status" = 'QUEUED' AND "started_at" IS NULL AND "ended_at" IS NULL
      AND "cancel_requested_at" IS NULL AND "lease_owner" IS NULL)
    OR ("status" = 'RUNNING' AND "started_at" IS NOT NULL AND "ended_at" IS NULL
      AND "cancel_requested_at" IS NULL AND "lease_owner" IS NOT NULL)
    OR ("status" = 'CANCEL_REQUESTED' AND "started_at" IS NOT NULL AND "ended_at" IS NULL
      AND "cancel_requested_at" IS NOT NULL AND "lease_owner" IS NOT NULL)
    OR ("status" IN ('COMPLETED', 'FAILED') AND "started_at" IS NOT NULL AND "ended_at" IS NOT NULL
      AND "lease_owner" IS NULL)
    OR ("status" = 'CANCELLED' AND "ended_at" IS NOT NULL AND "cancel_requested_at" IS NOT NULL
      AND "lease_owner" IS NULL)
  ),
  CONSTRAINT "ai_agent_runs_completion_check" CHECK (
    "status" <> 'COMPLETED' OR "result_summary" IS NOT NULL
  ),
  CONSTRAINT "ai_agent_runs_failure_check" CHECK (
    "status" <> 'FAILED' OR NULLIF(BTRIM("error_class"), '') IS NOT NULL
  )
);

CREATE TABLE "ai_agent_steps" (
  "id" VARCHAR(32) NOT NULL,
  "run_id" VARCHAR(32) NOT NULL,
  "parent_step_id" VARCHAR(32),
  "step_key" VARCHAR(128) NOT NULL,
  "kind" "ai_agent_step_kind" NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "status" "ai_agent_step_status" NOT NULL DEFAULT 'PENDING',
  "input_summary" JSONB NOT NULL DEFAULT '{}',
  "input_hash" CHAR(64) NOT NULL,
  "output_summary" JSONB,
  "output_hash" CHAR(64),
  "error_code" INTEGER,
  "error_class" VARCHAR(128),
  "error_message" VARCHAR(1000),
  "started_at" TIMESTAMPTZ(3),
  "ended_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_agent_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_agent_steps_ordinal_check" CHECK ("ordinal" >= 0),
  CONSTRAINT "ai_agent_steps_attempt_check" CHECK ("attempt" >= 1),
  CONSTRAINT "ai_agent_steps_key_check" CHECK (NULLIF(BTRIM("step_key"), '') IS NOT NULL),
  CONSTRAINT "ai_agent_steps_input_hash_check" CHECK ("input_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_agent_steps_output_hash_check" CHECK ("output_hash" IS NULL OR "output_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ai_agent_steps_json_check" CHECK (
    jsonb_typeof("input_summary") = 'object'
    AND ("output_summary" IS NULL OR jsonb_typeof("output_summary") = 'object')
  ),
  CONSTRAINT "ai_agent_steps_status_time_check" CHECK (
    ("status" = 'PENDING' AND "started_at" IS NULL AND "ended_at" IS NULL)
    OR ("status" = 'RUNNING' AND "started_at" IS NOT NULL AND "ended_at" IS NULL)
    OR ("status" IN ('COMPLETED', 'FAILED') AND "started_at" IS NOT NULL AND "ended_at" IS NOT NULL)
    OR ("status" IN ('CANCELLED', 'SKIPPED') AND "ended_at" IS NOT NULL)
  ),
  CONSTRAINT "ai_agent_steps_completion_check" CHECK (
    "status" <> 'COMPLETED' OR ("output_summary" IS NOT NULL AND "output_hash" IS NOT NULL)
  ),
  CONSTRAINT "ai_agent_steps_failure_check" CHECK (
    "status" <> 'FAILED' OR NULLIF(BTRIM("error_class"), '') IS NOT NULL
  )
);

CREATE TABLE "ai_run_events" (
  "id" BIGSERIAL NOT NULL,
  "public_id" VARCHAR(32) NOT NULL,
  "run_id" VARCHAR(32) NOT NULL,
  "step_id" VARCHAR(32),
  "sequence" BIGINT NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "visibility" "ai_run_event_visibility" NOT NULL DEFAULT 'USER',
  "trace_id" VARCHAR(128) NOT NULL,
  "payload" JSONB NOT NULL,
  "publish_status" "ai_run_event_publish_status" NOT NULL DEFAULT 'PENDING',
  "publish_attempts" INTEGER NOT NULL DEFAULT 0,
  "next_publish_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publish_lease_owner" VARCHAR(128),
  "publish_lease_expires_at" TIMESTAMPTZ(3),
  "published_at" TIMESTAMPTZ(3),
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_run_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_run_events_sequence_check" CHECK ("sequence" >= 1),
  CONSTRAINT "ai_run_events_type_check" CHECK (NULLIF(BTRIM("event_type"), '') IS NOT NULL),
  CONSTRAINT "ai_run_events_trace_check" CHECK (NULLIF(BTRIM("trace_id"), '') IS NOT NULL),
  CONSTRAINT "ai_run_events_payload_check" CHECK (
    jsonb_typeof("payload") = 'object' AND "payload" ->> 'schemaVersion' = '1.0'
  ),
  CONSTRAINT "ai_run_events_publish_attempts_check" CHECK ("publish_attempts" >= 0),
  CONSTRAINT "ai_run_events_publish_lease_pair_check" CHECK (
    ("publish_lease_owner" IS NULL) = ("publish_lease_expires_at" IS NULL)
  ),
  CONSTRAINT "ai_run_events_published_time_check" CHECK (
    ("publish_status" = 'PUBLISHED') = ("published_at" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "ai_agent_runs_user_client_request_key"
  ON "ai_agent_runs"("user_id", "client_request_id");
CREATE INDEX "ai_agent_runs_conversation_created_idx"
  ON "ai_agent_runs"("conversation_id", "created_at" DESC, "id" DESC);
CREATE INDEX "ai_agent_runs_user_status_created_idx"
  ON "ai_agent_runs"("user_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "ai_agent_runs_lease_created_idx"
  ON "ai_agent_runs"("lease_expires_at", "created_at");
CREATE INDEX "ai_agent_runs_claimable_idx"
  ON "ai_agent_runs"("lease_expires_at", "created_at")
  WHERE "status" IN ('QUEUED', 'RUNNING', 'CANCEL_REQUESTED');
CREATE INDEX "ai_agent_runs_deadline_status_idx"
  ON "ai_agent_runs"("deadline_at", "status");

CREATE UNIQUE INDEX "ai_agent_steps_run_key_attempt_key"
  ON "ai_agent_steps"("run_id", "step_key", "attempt");
CREATE UNIQUE INDEX "ai_agent_steps_id_run_key"
  ON "ai_agent_steps"("id", "run_id");
CREATE INDEX "ai_agent_steps_run_ordinal_idx"
  ON "ai_agent_steps"("run_id", "ordinal", "id");
CREATE INDEX "ai_agent_steps_run_status_updated_idx"
  ON "ai_agent_steps"("run_id", "status", "updated_at");

CREATE UNIQUE INDEX "ai_run_events_public_id_key" ON "ai_run_events"("public_id");
CREATE UNIQUE INDEX "ai_run_events_run_sequence_key" ON "ai_run_events"("run_id", "sequence");
CREATE INDEX "ai_run_events_run_sequence_idx" ON "ai_run_events"("run_id", "sequence");
CREATE INDEX "ai_run_events_run_occurred_idx" ON "ai_run_events"("run_id", "occurred_at", "id");
CREATE INDEX "ai_run_events_cleanup_idx" ON "ai_run_events"("occurred_at", "id");
CREATE INDEX "ai_run_events_publish_idx" ON "ai_run_events"("publish_status", "next_publish_at", "id");

ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_trigger_message_id_fkey"
  FOREIGN KEY ("trigger_message_id") REFERENCES "ai_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_response_message_id_fkey"
  FOREIGN KEY ("response_message_id") REFERENCES "ai_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_workflow_version_id_fkey"
  FOREIGN KEY ("workflow_version_id") REFERENCES "ai_workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ai_agent_runs"
  ADD CONSTRAINT "ai_agent_runs_prompt_version_id_fkey"
  FOREIGN KEY ("prompt_version_id") REFERENCES "ai_prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "ai_agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ai_agent_steps"
  ADD CONSTRAINT "ai_agent_steps_parent_step_id_run_id_fkey"
  FOREIGN KEY ("parent_step_id", "run_id") REFERENCES "ai_agent_steps"("id", "run_id")
  ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "ai_run_events"
  ADD CONSTRAINT "ai_run_events_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "ai_agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ai_run_events"
  ADD CONSTRAINT "ai_run_events_step_id_run_id_fkey"
  FOREIGN KEY ("step_id", "run_id") REFERENCES "ai_agent_steps"("id", "run_id")
  ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ai_tool_calls" WHERE "run_id" IS NULL OR "step_id" IS NULL) THEN
    RAISE EXCEPTION 'Batch 005 requires ai_tool_calls.run_id/step_id backfill before migration';
  END IF;
  IF EXISTS (SELECT 1 FROM "ai_model_calls" WHERE "run_id" IS NULL) THEN
    RAISE EXCEPTION 'Batch 005 requires ai_model_calls.run_id backfill before migration';
  END IF;
END;
$$;

ALTER TABLE "ai_tool_calls"
  ALTER COLUMN "run_id" SET NOT NULL,
  ALTER COLUMN "step_id" SET NOT NULL;
ALTER TABLE "ai_model_calls" ALTER COLUMN "run_id" SET NOT NULL;

ALTER TABLE "ai_tool_calls"
  ADD CONSTRAINT "ai_tool_calls_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "ai_agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ai_tool_calls"
  ADD CONSTRAINT "ai_tool_calls_step_id_run_id_fkey"
  FOREIGN KEY ("step_id", "run_id") REFERENCES "ai_agent_steps"("id", "run_id")
  ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ai_model_calls"
  ADD CONSTRAINT "ai_model_calls_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "ai_agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE "ai_model_calls"
  ADD CONSTRAINT "ai_model_calls_step_id_run_id_fkey"
  FOREIGN KEY ("step_id", "run_id") REFERENCES "ai_agent_steps"("id", "run_id")
  ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

CREATE FUNCTION "validate_ai_agent_run_owner"() RETURNS trigger AS $$
DECLARE
  conversation_owner INTEGER;
  trigger_owner INTEGER;
  trigger_conversation VARCHAR(32);
  trigger_role "ai_message_role";
  response_owner INTEGER;
  response_conversation VARCHAR(32);
  response_role "ai_message_role";
  workflow_status "ai_version_status";
  prompt_status "ai_version_status";
BEGIN
  SELECT "user_id" INTO conversation_owner
    FROM "ai_conversations" WHERE "id" = NEW."conversation_id" AND "status" <> 'DELETED';
  SELECT "user_id", "conversation_id", "role"
    INTO trigger_owner, trigger_conversation, trigger_role
    FROM "ai_messages" WHERE "id" = NEW."trigger_message_id";
  SELECT "user_id", "conversation_id", "role"
    INTO response_owner, response_conversation, response_role
    FROM "ai_messages" WHERE "id" = NEW."response_message_id";
  SELECT "status" INTO workflow_status FROM "ai_workflow_versions" WHERE "id" = NEW."workflow_version_id";
  SELECT "status" INTO prompt_status FROM "ai_prompt_versions" WHERE "id" = NEW."prompt_version_id";

  IF conversation_owner IS NULL OR conversation_owner <> NEW."user_id"
    OR trigger_owner <> NEW."user_id" OR response_owner <> NEW."user_id"
    OR trigger_conversation <> NEW."conversation_id" OR response_conversation <> NEW."conversation_id"
    OR trigger_role <> 'USER' OR response_role <> 'ASSISTANT'
  THEN
    RAISE EXCEPTION 'AI Agent Run owner/message scope mismatch' USING ERRCODE = 'check_violation';
  END IF;
  IF workflow_status <> 'PUBLISHED' OR prompt_status <> 'PUBLISHED' THEN
    RAISE EXCEPTION 'AI Agent Run requires published workflow and prompt versions' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_agent_runs_owner_trigger"
  BEFORE INSERT OR UPDATE OF "user_id", "conversation_id", "trigger_message_id", "response_message_id",
    "workflow_version_id", "prompt_version_id"
  ON "ai_agent_runs"
  FOR EACH ROW EXECUTE FUNCTION "validate_ai_agent_run_owner"();

CREATE FUNCTION "validate_ai_agent_run_transition"() RETURNS trigger AS $$
BEGIN
  IF OLD."user_id" <> NEW."user_id"
    OR OLD."conversation_id" <> NEW."conversation_id"
    OR OLD."trigger_message_id" <> NEW."trigger_message_id"
    OR OLD."response_message_id" <> NEW."response_message_id"
    OR OLD."client_request_id" <> NEW."client_request_id"
    OR OLD."request_hash" <> NEW."request_hash"
    OR OLD."trace_id" <> NEW."trace_id"
    OR OLD."workflow_version_id" <> NEW."workflow_version_id"
    OR OLD."prompt_version_id" <> NEW."prompt_version_id"
    OR OLD."tool_policy_version" <> NEW."tool_policy_version"
    OR OLD."model_policy" <> NEW."model_policy"
    OR OLD."preferred_model" IS DISTINCT FROM NEW."preferred_model"
    OR OLD."input_snapshot" IS DISTINCT FROM NEW."input_snapshot"
    OR OLD."budget" IS DISTINCT FROM NEW."budget"
    OR OLD."max_attempts" <> NEW."max_attempts"
    OR OLD."deadline_at" <> NEW."deadline_at"
  THEN
    RAISE EXCEPTION 'AI Agent Run immutable identity/config cannot change' USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'terminal AI Agent Run is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."status_version" < OLD."status_version" OR NEW."status_version" > OLD."status_version" + 1 THEN
    RAISE EXCEPTION 'invalid AI Agent Run status version' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."status" <> OLD."status" THEN
    IF NEW."status_version" <> OLD."status_version" + 1 OR NOT (
      (OLD."status" = 'QUEUED' AND NEW."status" IN ('RUNNING', 'CANCELLED'))
      OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('CANCEL_REQUESTED', 'COMPLETED', 'FAILED'))
      OR (OLD."status" = 'CANCEL_REQUESTED' AND NEW."status" = 'CANCELLED')
    ) THEN
      RAISE EXCEPTION 'invalid AI Agent Run transition: % -> %', OLD."status", NEW."status"
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."status_version" = OLD."status_version" + 1 THEN
    IF NEW."attempt" <> OLD."attempt" + 1 OR NEW."lease_owner" IS NOT DISTINCT FROM OLD."lease_owner" THEN
      RAISE EXCEPTION 'status version without transition is reserved for lease takeover'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_agent_runs_status_transition_trigger"
  BEFORE UPDATE ON "ai_agent_runs"
  FOR EACH ROW EXECUTE FUNCTION "validate_ai_agent_run_transition"();

CREATE FUNCTION "validate_ai_agent_step_transition"() RETURNS trigger AS $$
BEGIN
  IF OLD."run_id" <> NEW."run_id" OR OLD."parent_step_id" IS DISTINCT FROM NEW."parent_step_id"
    OR OLD."step_key" <> NEW."step_key" OR OLD."kind" <> NEW."kind"
    OR OLD."ordinal" <> NEW."ordinal" OR OLD."attempt" <> NEW."attempt"
    OR OLD."input_summary" IS DISTINCT FROM NEW."input_summary" OR OLD."input_hash" <> NEW."input_hash"
  THEN
    RAISE EXCEPTION 'AI Agent Step immutable identity/input cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED') THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'terminal AI Agent Step is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
    (OLD."status" = 'PENDING' AND NEW."status" IN ('RUNNING', 'CANCELLED', 'SKIPPED'))
    OR (OLD."status" = 'RUNNING' AND NEW."status" IN ('COMPLETED', 'FAILED', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'invalid AI Agent Step transition: % -> %', OLD."status", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_agent_steps_status_transition_trigger"
  BEFORE UPDATE ON "ai_agent_steps"
  FOR EACH ROW EXECUTE FUNCTION "validate_ai_agent_step_transition"();

CREATE FUNCTION "validate_ai_run_event"() RETURNS trigger AS $$
DECLARE
  run_status "ai_agent_run_status";
  next_sequence BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AI Run Event cannot be deleted' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW."public_id" <> OLD."public_id" OR NEW."run_id" <> OLD."run_id"
      OR NEW."step_id" IS DISTINCT FROM OLD."step_id" OR NEW."sequence" <> OLD."sequence"
      OR NEW."event_type" <> OLD."event_type" OR NEW."visibility" <> OLD."visibility"
      OR NEW."trace_id" <> OLD."trace_id" OR NEW."payload" IS DISTINCT FROM OLD."payload"
      OR NEW."occurred_at" <> OLD."occurred_at"
    THEN
      RAISE EXCEPTION 'AI Run Event business content is append-only' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD."publish_status" IN ('PUBLISHED', 'DEAD') AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION 'terminal AI Run Event publish state is immutable' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT "status", "next_event_sequence" INTO run_status, next_sequence
    FROM "ai_agent_runs" WHERE "id" = NEW."run_id";
  IF run_status IS NULL OR run_status IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'cannot append event to missing or terminal AI Agent Run' USING ERRCODE = 'check_violation';
  END IF;
  IF next_sequence <> NEW."sequence" + 1 THEN
    RAISE EXCEPTION 'AI Run Event sequence was not allocated by Run counter' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_run_events_integrity_trigger"
  BEFORE INSERT OR UPDATE OR DELETE ON "ai_run_events"
  FOR EACH ROW EXECUTE FUNCTION "validate_ai_run_event"();
