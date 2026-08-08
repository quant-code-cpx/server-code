WITH "enabled_deployments" AS (
  SELECT
    deployment.*,
    connection."connection_key",
    connection."adapter_kind",
    connection."base_url",
    connection."encrypted_api_key"
  FROM "ai_model_deployments" AS deployment
  INNER JOIN "ai_model_connections" AS connection
    ON connection."id" = deployment."connection_id"
  WHERE deployment."enabled" = true
    AND connection."enabled" = true
)
INSERT INTO "ai_model_config_versions" (
  "id",
  "status",
  "deployment_ids",
  "snapshot",
  "created_at"
)
SELECT
  'modelcfg_bootstrap_v2_20260807',
  'ACTIVE',
  array_agg(deployment."id" ORDER BY deployment."priority", deployment."id"),
  jsonb_agg(
    jsonb_build_object(
      'deploymentId', deployment."id",
      'connectionId', deployment."connection_id",
      'connectionKey', deployment."connection_key",
      'adapterKind', deployment."adapter_kind",
      'baseUrl', deployment."base_url",
      'encryptedApiKey', deployment."encrypted_api_key",
      'modelId', deployment."model_id",
      'displayName', deployment."display_name",
      'priority', deployment."priority",
      'costTier', deployment."cost_tier",
      'contextWindow', deployment."context_window",
      'maxOutputTokens', deployment."max_output_tokens",
      'capabilities', to_jsonb(deployment."capabilities"),
      'reasoningMode', deployment."reasoning_mode",
      'reasoningEfforts', to_jsonb(deployment."reasoning_efforts"),
      'defaultReasoningEffort', deployment."default_reasoning_effort",
      'reasoningBudgetTokens', deployment."reasoning_budget_tokens",
      'dataClasses', to_jsonb(deployment."data_classes"),
      'timeoutMs', deployment."timeout_ms",
      'maxRetries', deployment."max_retries",
      'retryBaseMs', deployment."retry_base_ms"
    )
    ORDER BY deployment."priority", deployment."id"
  ),
  CURRENT_TIMESTAMP
FROM "enabled_deployments" AS deployment
WHERE NOT EXISTS (
  SELECT 1
  FROM "ai_model_config_versions"
  WHERE "status" = 'ACTIVE'
)
HAVING count(*) > 0
ON CONFLICT ("id") DO NOTHING;
