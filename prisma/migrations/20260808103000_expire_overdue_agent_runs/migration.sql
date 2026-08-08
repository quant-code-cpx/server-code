-- 允许系统在 Worker 尚未领取时，将超过 deadline 的 QUEUED Run 可靠终止为 FAILED。
CREATE OR REPLACE FUNCTION "validate_ai_agent_run_transition"() RETURNS trigger AS $$
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
      (OLD."status" = 'QUEUED' AND NEW."status" IN ('RUNNING', 'FAILED', 'CANCELLED'))
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
