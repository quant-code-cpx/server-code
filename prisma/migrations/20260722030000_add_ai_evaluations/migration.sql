-- Batch 025: versioned, reproducible Agent evaluation runs and per-case results.
CREATE TYPE "ai_evaluation_run_status" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "ai_evaluation_runs" (
  "id" VARCHAR(32) NOT NULL,
  "requested_by_user_id" INTEGER NOT NULL,
  "client_request_id" VARCHAR(128) NOT NULL,
  "dataset_id" VARCHAR(64) NOT NULL,
  "dataset_version" VARCHAR(64) NOT NULL,
  "dataset_hash" CHAR(64) NOT NULL,
  "workflow_version" VARCHAR(128) NOT NULL,
  "prompt_version" VARCHAR(128) NOT NULL,
  "model_version" VARCHAR(128) NOT NULL,
  "provider" VARCHAR(64) NOT NULL,
  "policy" JSONB NOT NULL DEFAULT '{}',
  "status" "ai_evaluation_run_status" NOT NULL DEFAULT 'RUNNING',
  "gate_passed" BOOLEAN,
  "total_cases" INTEGER NOT NULL DEFAULT 0,
  "passed_cases" INTEGER NOT NULL DEFAULT 0,
  "failed_cases" INTEGER NOT NULL DEFAULT 0,
  "total_cost" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "cost_currency" CHAR(3) NOT NULL DEFAULT 'CNY',
  "summary" JSONB,
  "artifact_ref" VARCHAR(512),
  "error_message" VARCHAR(1000),
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ai_evaluation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_evaluation_results" (
  "id" VARCHAR(32) NOT NULL,
  "evaluation_run_id" VARCHAR(32) NOT NULL,
  "case_id" VARCHAR(128) NOT NULL,
  "case_hash" CHAR(64) NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "fact_score" DECIMAL(8,6) NOT NULL,
  "citation_coverage" DECIMAL(8,6) NOT NULL,
  "tool_trace_match" BOOLEAN NOT NULL,
  "latency_ms" INTEGER NOT NULL,
  "cost" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "cost_currency" CHAR(3) NOT NULL DEFAULT 'CNY',
  "failures" JSONB NOT NULL DEFAULT '[]',
  "evidence_summary" JSONB,
  "artifact_ref" VARCHAR(512),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_evaluation_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_evaluation_runs_requester_client_request_key"
  ON "ai_evaluation_runs"("requested_by_user_id", "client_request_id");
CREATE INDEX "ai_evaluation_runs_dataset_created_idx"
  ON "ai_evaluation_runs"("dataset_id", "dataset_version", "created_at" DESC, "id" DESC);
CREATE INDEX "ai_evaluation_runs_status_created_idx"
  ON "ai_evaluation_runs"("status", "created_at", "id");
CREATE UNIQUE INDEX "ai_evaluation_results_run_case_key"
  ON "ai_evaluation_results"("evaluation_run_id", "case_id");
CREATE INDEX "ai_evaluation_results_case_created_idx"
  ON "ai_evaluation_results"("case_id", "created_at");

ALTER TABLE "ai_evaluation_results"
  ADD CONSTRAINT "ai_evaluation_results_evaluation_run_id_fkey"
  FOREIGN KEY ("evaluation_run_id") REFERENCES "ai_evaluation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
