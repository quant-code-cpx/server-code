-- Durable, owner-scoped Agent schedules. PostgreSQL unique keys are the final
-- deduplication boundary; scheduler leases only reduce competing work.

CREATE TYPE "ai_scheduled_task_trigger" AS ENUM ('CRON', 'ONE_TIME', 'STRUCTURED_CONDITION');
CREATE TYPE "ai_scheduled_task_status" AS ENUM ('ACTIVE', 'PAUSED', 'DELETED');
CREATE TYPE "ai_task_execution_status" AS ENUM ('PENDING', 'DEFERRED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED');

CREATE TABLE "ai_scheduled_tasks" (
  "id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "client_request_id" VARCHAR(128),
  "name" VARCHAR(160) NOT NULL,
  "status" "ai_scheduled_task_status" NOT NULL DEFAULT 'ACTIVE',
  "version" INTEGER NOT NULL DEFAULT 1,
  "trigger" "ai_scheduled_task_trigger" NOT NULL,
  "cron_expression" VARCHAR(128),
  "time_zone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
  "one_time_at" TIMESTAMPTZ(3),
  "condition" JSONB,
  "trading_day_only" BOOLEAN NOT NULL DEFAULT false,
  "prompt" TEXT NOT NULL,
  "input" JSONB NOT NULL DEFAULT '{}',
  "allowed_capabilities" JSONB NOT NULL DEFAULT '[]',
  "required_watermarks" JSONB NOT NULL DEFAULT '[]',
  "workflow_key" VARCHAR(128) NOT NULL,
  "workflow_version" INTEGER NOT NULL,
  "workflow_content_hash" CHAR(64) NOT NULL,
  "prompt_key" VARCHAR(128) NOT NULL,
  "prompt_version" INTEGER NOT NULL,
  "prompt_content_hash" CHAR(64) NOT NULL,
  "model_policy" "ai_model_policy" NOT NULL DEFAULT 'AUTO',
  "preferred_model" VARCHAR(128),
  "max_cost_cny" DECIMAL(18,8) NOT NULL,
  "next_run_at" TIMESTAMPTZ(3),
  "lease_owner" VARCHAR(128),
  "lease_expires_at" TIMESTAMPTZ(3),
  "paused_at" TIMESTAMPTZ(3),
  "deleted_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_scheduled_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_scheduled_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_scheduled_tasks_trigger_shape_check" CHECK (
    ("trigger" = 'CRON' AND "cron_expression" IS NOT NULL AND "one_time_at" IS NULL AND "condition" IS NULL)
    OR ("trigger" = 'ONE_TIME' AND "cron_expression" IS NULL AND "one_time_at" IS NOT NULL AND "condition" IS NULL)
    OR ("trigger" = 'STRUCTURED_CONDITION' AND "cron_expression" IS NULL AND "one_time_at" IS NULL AND "condition" IS NOT NULL)
  ),
  CONSTRAINT "ai_scheduled_tasks_model_policy_check" CHECK (
    ("model_policy" = 'AUTO' AND "preferred_model" IS NULL)
    OR ("model_policy" = 'MANUAL' AND "preferred_model" IS NOT NULL)
  ),
  CONSTRAINT "ai_scheduled_tasks_cost_check" CHECK ("max_cost_cny" > 0),
  CONSTRAINT "ai_scheduled_tasks_version_check" CHECK ("version" >= 1)
);

CREATE TABLE "ai_task_executions" (
  "id" VARCHAR(32) NOT NULL,
  "task_id" VARCHAR(32) NOT NULL,
  "user_id" INTEGER NOT NULL,
  "request_key" VARCHAR(160) NOT NULL,
  "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
  "status" "ai_task_execution_status" NOT NULL DEFAULT 'PENDING',
  "task_snapshot" JSONB NOT NULL,
  "gate_evidence" JSONB NOT NULL DEFAULT '{}',
  "run_id" VARCHAR(32),
  "lease_owner" VARCHAR(128),
  "lease_expires_at" TIMESTAMPTZ(3),
  "error_code" INTEGER,
  "error_message" VARCHAR(1000),
  "cost_cny" DECIMAL(18,8),
  "queued_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3),
  "ended_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_task_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_task_executions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "ai_scheduled_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_task_executions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_task_executions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ai_agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ai_task_executions_status_times_check" CHECK (
    ("status" IN ('PENDING', 'DEFERRED', 'QUEUED') AND "ended_at" IS NULL)
    OR ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED'))
  )
);

CREATE UNIQUE INDEX "ai_task_executions_run_id_key" ON "ai_task_executions"("run_id");
CREATE UNIQUE INDEX "ai_scheduled_tasks_user_client_request_key" ON "ai_scheduled_tasks"("user_id", "client_request_id");
CREATE UNIQUE INDEX "ai_task_executions_task_scheduled_for_key" ON "ai_task_executions"("task_id", "scheduled_for");
CREATE UNIQUE INDEX "ai_task_executions_task_request_key" ON "ai_task_executions"("task_id", "request_key");
CREATE INDEX "ai_scheduled_tasks_user_status_cursor_idx" ON "ai_scheduled_tasks"("user_id", "status", "updated_at" DESC, "id" DESC);
CREATE INDEX "ai_scheduled_tasks_due_idx" ON "ai_scheduled_tasks"("status", "next_run_at", "id");
CREATE INDEX "ai_scheduled_tasks_lease_idx" ON "ai_scheduled_tasks"("lease_expires_at", "id");
CREATE INDEX "ai_task_executions_task_cursor_idx" ON "ai_task_executions"("task_id", "created_at" DESC, "id" DESC);
CREATE INDEX "ai_task_executions_reconcile_idx" ON "ai_task_executions"("status", "lease_expires_at", "id");
CREATE INDEX "ai_task_executions_user_status_idx" ON "ai_task_executions"("user_id", "status", "created_at" DESC, "id" DESC);
