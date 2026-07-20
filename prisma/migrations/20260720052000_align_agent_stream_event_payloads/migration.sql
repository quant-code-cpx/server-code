-- 对齐 Batch 014 公共 SSE 契约：
-- 1. agent.started 使用 workflowKey/workflowVersion，不暴露内部 FK。
-- 2. 恢复被通用审计 sanitizer 误脱敏的 token usage 数值。
ALTER TABLE "ai_run_events" DISABLE TRIGGER "ai_run_events_integrity_trigger";

UPDATE "ai_run_events" AS event
SET "payload" = jsonb_build_object(
  'workflowKey', workflow."workflow_key",
  'workflowVersion', workflow."version",
  'modelPolicy', run."model_policy"
)
FROM "ai_agent_runs" AS run
JOIN "ai_workflow_versions" AS workflow ON workflow."id" = run."workflow_version_id"
WHERE event."run_id" = run."id"
  AND event."event_type" = 'agent.started';

WITH usage AS (
  SELECT
    event."id" AS "event_id",
    coalesce(sum(call."input_tokens"), 0)::int AS "input_tokens",
    coalesce(sum(call."output_tokens"), 0)::int AS "output_tokens"
  FROM "ai_run_events" AS event
  LEFT JOIN "ai_model_calls" AS call ON call."run_id" = event."run_id"
  WHERE event."event_type" = 'agent.completed'
  GROUP BY event."id"
)
UPDATE "ai_run_events" AS event
SET "payload" = jsonb_set(
  jsonb_set(
    jsonb_set(event."payload", '{usage,inputTokens}', to_jsonb(usage."input_tokens"), true),
    '{usage,outputTokens}', to_jsonb(usage."output_tokens"), true
  ),
  '{usage,totalTokens}', to_jsonb(usage."input_tokens" + usage."output_tokens"), true
)
FROM usage
WHERE event."id" = usage."event_id";

ALTER TABLE "ai_run_events" ENABLE TRIGGER "ai_run_events_integrity_trigger";

ALTER TABLE "ai_agent_runs" DISABLE TRIGGER "ai_agent_runs_status_transition_trigger";

WITH usage AS (
  SELECT
    run."id" AS "run_id",
    coalesce(sum(call."input_tokens"), 0)::int AS "input_tokens",
    coalesce(sum(call."output_tokens"), 0)::int AS "output_tokens"
  FROM "ai_agent_runs" AS run
  LEFT JOIN "ai_model_calls" AS call ON call."run_id" = run."id"
  WHERE run."status" = 'COMPLETED'
  GROUP BY run."id"
)
UPDATE "ai_agent_runs" AS run
SET "result_summary" = jsonb_set(
  jsonb_set(run."result_summary", '{budget,inputTokens}', to_jsonb(usage."input_tokens"), true),
  '{budget,outputTokens}', to_jsonb(usage."output_tokens"), true
)
FROM usage
WHERE run."id" = usage."run_id"
  AND run."result_summary" ? 'budget';

ALTER TABLE "ai_agent_runs" ENABLE TRIGGER "ai_agent_runs_status_transition_trigger";
