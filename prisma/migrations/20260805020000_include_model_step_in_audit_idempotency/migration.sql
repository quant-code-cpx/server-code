-- Model calls are idempotent within a workflow step. Different steps may use
-- the same provider, model, purpose and attempt number in one run.
DROP INDEX "ai_model_calls_scope_model_attempt_key";

CREATE UNIQUE INDEX "ai_model_calls_scope_step_model_attempt_key"
  ON "ai_model_calls"("user_id", "scope_id", "step_id", "provider", "model", "purpose", "attempt_count");
